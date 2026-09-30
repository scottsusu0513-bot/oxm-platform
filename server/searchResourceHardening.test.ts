/**
 * Batch 3.6：搜尋資源強化——真的走本機測試資料庫與 tRPC router（不呼叫 OpenAI：
 * 這裡的搜尋都不帶會觸發 AI 的條件，或直接呼叫 db.searchFactories）。
 *   - 單一 HTTP 批次內 factory.search 數量上限（真的起 Express＋tRPC 送 HTTP）
 *   - LIKE 萬用字元跳脫（%、_、!）；一般中文／英文關鍵字結果不變
 *   - page 上限
 *   - 候選上限 300：真的建立 305 間符合條件的工廠，確認每一間都翻得到、total 一致
 *   - 搜尋專用連線池：SESSION max_execution_time、逾時由 MySQL 端中止且連線可重用
 *   - 正式環境 log 不含使用者關鍵字（結構性保證）
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import * as db from "./db";
import { appRouter, FACTORY_SEARCH_MAX_PAGE } from "./routers";
import type { TrpcContext } from "./_core/context";
import { searchBatchGuard, countSearchCalls, MAX_SEARCH_CALLS_PER_BATCH } from "./_core/searchBatchGuard";
import { MAX_SEARCH_CALLS_PER_BATCH as SHARED_MAX, SEARCH_PROCEDURE_PATH } from "../shared/searchBatch";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const runTag = runId.replace(/_/g, "");
// 產業名稱不含 % _ !，才能驗證跳脫（搜尋也會比對產業 JSON）
const LIKE_IND = `SRHLIKE${runTag}`;
const BULK_IND = `SRHBULK${runTag}`;
const BULK_KW = `bulk${runId.replace(/_/g, "")}`;
const BULK_COUNT = 305;
const createdFactoryIds: number[] = [];
const createdUserIds: number[] = [];

const anon = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext);
async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q) as unknown as Promise<[any, unknown]>; }

async function bulkUsers(prefix: string, n: number): Promise<number[]> {
  const values = Array.from({ length: n }, (_, i) => sql`(${`${prefix}-${i}-${runId}`}, ${`SRH ${i}`}, ${`${prefix}-${i}-${runId}@example.test`})`);
  await exec(sql`INSERT INTO users (openId, name, email) VALUES ${sql.join(values, sql`, `)}`);
  const [rows] = await exec(sql`SELECT id FROM users WHERE openId LIKE ${`${prefix}-%-${runId}`} ORDER BY id`);
  const ids = (rows as { id: number }[]).map(r => r.id);
  createdUserIds.push(...ids);
  return ids;
}
async function bulkFactories(rows: { ownerId: number; name: string; industry: string; description: string; rating: string; reviews: number; status?: string }[]) {
  const values = rows.map(r => sql`(${r.ownerId}, ${r.name}, ${JSON.stringify([r.industry])}, '["OEM"]', '台北市', ${r.description}, '<1000萬', '地址',
    ${r.status ?? "approved"}, 'normal', FALSE, '[]', ${r.rating}, ${r.reviews}, 'factory')`);
  await exec(sql`INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, address, status, operationStatus, certified, subIndustry, avgRating, reviewCount, businessType)
    VALUES ${sql.join(values, sql`, `)}`);
  const [out] = await exec(sql`SELECT id, name FROM factories WHERE ownerId IN (${sql.join(rows.map(r => sql`${r.ownerId}`), sql`, `)})`);
  const list = out as { id: number; name: string }[];
  createdFactoryIds.push(...list.map(f => f.id));
  return list;
}

let likeFactories: { id: number; name: string }[] = [];
let bulkIds: number[] = [];

beforeAll(async () => {
  const likeOwners = await bulkUsers("srh-like", 6);
  likeFactories = await bulkFactories([
    { ownerId: likeOwners[0], name: `LK 100% 純棉 ${runTag}`, industry: LIKE_IND, description: "織布", rating: "4.00", reviews: 1 },
    { ownerId: likeOwners[1], name: `LK 規格A_B ${runTag}`, industry: LIKE_IND, description: "沖壓", rating: "3.00", reviews: 1 },
    { ownerId: likeOwners[2], name: `LK 螺絲精密 ${runTag}`, industry: LIKE_IND, description: "M6 螺絲、CNC 車床", rating: "5.00", reviews: 2 },
    { ownerId: likeOwners[3], name: `LK CNC 加工 ${runTag}`, industry: LIKE_IND, description: "五軸 CNC", rating: "2.00", reviews: 0 },
    { ownerId: likeOwners[4], name: `LK 驚嘆!號 ${runTag}`, industry: LIKE_IND, description: "一般", rating: "1.00", reviews: 0 },
    { ownerId: likeOwners[5], name: `LK 下架 螺絲 ${runTag}`, industry: LIKE_IND, description: "螺絲", rating: "5.00", reviews: 9, status: "delisted" },
  ]);
  // 只有商品提到螺絲的工廠（驗證商品預查仍會把它拉進候選）
  const onlyProductOwner = (await bulkUsers("srh-prod", 1))[0];
  const [prodFactory] = await bulkFactories([{ ownerId: onlyProductOwner, name: `LK 五金行 ${runTag}`, industry: LIKE_IND, description: "五金", rating: "3.50", reviews: 3 }]);
  likeFactories.push(prodFactory);
  await exec(sql`INSERT INTO products (factoryId, name, description) VALUES (${prodFactory.id}, '不鏽鋼螺絲', 'M8')`);
  const delisted = likeFactories.find(f => f.name.includes("下架"))!;
  await exec(sql`INSERT INTO products (factoryId, name, description) VALUES (${delisted.id}, '螺絲', '下架工廠的商品')`);

  const bulkOwners = await bulkUsers("srh-bulk", BULK_COUNT);
  const bulk = await bulkFactories(bulkOwners.map((ownerId, i) => ({
    ownerId, name: `BK ${i} ${runId}`, industry: BULK_IND,
    description: i % 7 === 0 ? `${BULK_KW} 專精` : `一般描述 ${BULK_KW}`,
    rating: `${(i % 5) + 1}.00`, reviews: i % 3,
  })));
  bulkIds = bulk.map(f => f.id);
}, 180000);

afterAll(async () => {
  if (createdFactoryIds.length) {
    await exec(sql`DELETE FROM products WHERE factoryId IN (${sql.join(createdFactoryIds.map(id => sql`${id}`), sql`, `)})`);
    await exec(sql`DELETE FROM factories WHERE id IN (${sql.join(createdFactoryIds.map(id => sql`${id}`), sql`, `)})`);
  }
  if (createdUserIds.length) await exec(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds.map(id => sql`${id}`), sql`, `)})`);
}, 180000);

// ── 1. 批次上限 ─────────────────────────────────────────────────────────
describe("單一 HTTP 批次內 factory.search 上限", () => {
  let server: import("node:http").Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use(searchBatchGuard);
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: () => anon() }));
    server = app.listen(0);
    await new Promise(r => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  const batchUrl = (paths: string[], sep = ",") => {
    const input: Record<string, unknown> = {};
    paths.forEach((p, i) => { input[i] = { json: p === SEARCH_PROCEDURE_PATH ? { industry: [LIKE_IND], page: i + 1, pageSize: 1 } : { limit: 3 } }; });
    return `${base}/api/trpc/${paths.join(sep)}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
  };
  const search = (n: number) => Array.from({ length: n }, () => SEARCH_PROCEDURE_PATH);

  it("server 與 client 使用同一個上限（5）", () => {
    expect(MAX_SEARCH_CALLS_PER_BATCH).toBe(5);
    expect(SHARED_MAX).toBe(MAX_SEARCH_CALLS_PER_BATCH);
  });
  it.each([1, 2, MAX_SEARCH_CALLS_PER_BATCH])("%i 個搜尋的批次正常回應", async (n) => {
    const r = await fetch(batchUrl(search(n)));
    expect(r.status).toBe(200);
    const body = await r.json() as unknown[];
    expect(body).toHaveLength(n);
  });
  it("超過上限（6 個、50 個）→ 400，回應是與批次等長的 tRPC 錯誤陣列，完全沒有執行搜尋", async () => {
    for (const n of [MAX_SEARCH_CALLS_PER_BATCH + 1, 50]) {
      const r = await fetch(batchUrl(search(n)));
      expect(r.status).toBe(400);
      const body = await r.json() as { error: { json: { data: { code: string } } } }[];
      expect(body).toHaveLength(n);
      expect(body[0].error.json.data.code).toBe("BAD_REQUEST");
    }
  });
  it("URL 編碼的逗號（%2C）也會被計入", async () => {
    const r = await fetch(batchUrl(search(MAX_SEARCH_CALLS_PER_BATCH + 1), "%2C"));
    expect(r.status).toBe(400);
  });
  it("其他 procedure 的大批次不受限制；5 個搜尋＋其他 procedure 混合也正常", async () => {
    const others = Array.from({ length: 12 }, () => "announcement.list");
    expect((await fetch(batchUrl(others))).status).toBe(200);
    expect((await fetch(batchUrl([...search(MAX_SEARCH_CALLS_PER_BATCH), ...others]))).status).toBe(200);
  });
  it("countSearchCalls 只數完全等於 factory.search 的項目", () => {
    expect(countSearchCalls("/api/trpc/factory.search,factory.searchX,factory.getById,factory.search")).toBe(2);
    expect(countSearchCalls("/api/oauth/callback")).toBe(0);
  });
  it("前端：factory.search 走獨立的 httpBatchLink，maxItems 使用同一個上限；其他 procedure 維持原本的批次連線", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../client/src/main.tsx"), "utf-8");
    expect(main).toMatch(/splitLink\(\{\s*condition: op => op\.path === SEARCH_PROCEDURE_PATH/);
    expect(main).toMatch(/maxItems: MAX_SEARCH_CALLS_PER_BATCH/);
    expect(main.match(/httpBatchLink\(/g)).toHaveLength(2);
  });
});

// ── 2. LIKE 跳脫 ────────────────────────────────────────────────────────
describe("LIKE 萬用字元跳脫", () => {
  const ids = async (keyword: string) =>
    (await db.searchFactories({ industry: [LIKE_IND], keyword, page: 1, pageSize: 50 })).items.map(f => f.id).sort((a, b) => a - b);
  const byName = (part: string) => likeFactories.filter(f => f.name.includes(part)).map(f => f.id);

  it("escapeLikeLiteral：%、_、! 都被跳脫", () => {
    expect(db.escapeLikeLiteral("100%_純棉!")).toBe("100!%!_純棉!!");
    expect(db.likeContainsPattern("螺絲")).toBe("%螺絲%");
  });
  it("「%」只找到名稱真的含 % 的工廠（修正前會比對全部）", async () => {
    expect(await ids("%")).toEqual(byName("100%"));
  });
  it("「_」只找到名稱真的含 _ 的工廠", async () => {
    expect(await ids("_")).toEqual(byName("A_B"));
  });
  it("「!」（跳脫字元本身）是字面比對", async () => {
    expect(await ids("!")).toEqual(byName("驚嘆!號"));
  });
  it("一般中文「螺絲」：名稱／描述命中＋只有商品命中的工廠；下架工廠與其商品不影響結果", async () => {
    const expected = [...byName("螺絲精密"), ...byName("五金行")].sort((a, b) => a - b);
    expect(await ids("螺絲")).toEqual(expected);
  });
  it("一般英文「CNC」：結果與未跳脫的原始 LIKE 語意完全相同", async () => {
    const [rows] = await exec(sql`SELECT id FROM factories WHERE status='approved' AND deletedAt IS NULL
      AND JSON_OVERLAPS(industry, ${JSON.stringify([LIKE_IND])}) AND (name LIKE '%CNC%' OR description LIKE '%CNC%') ORDER BY id`);
    expect(await ids("CNC")).toEqual((rows as { id: number }[]).map(r => r.id));
  });
});

// ── 3. page 上限 ────────────────────────────────────────────────────────
describe("page 上限", () => {
  it(`page 必須是 1～${FACTORY_SEARCH_MAX_PAGE} 的整數`, async () => {
    const caller = appRouter.createCaller(anon());
    for (const page of [0, -1, 1.5, FACTORY_SEARCH_MAX_PAGE + 1, 1e9]) {
      await expect(caller.factory.search({ industry: [LIKE_IND], page })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(caller.factory.search({ industry: [LIKE_IND], page: FACTORY_SEARCH_MAX_PAGE })).resolves.toMatchObject({ items: [] });
  });
});

// ── 4. 候選上限 300 ─────────────────────────────────────────────────────
describe(`候選上限：${BULK_COUNT} 間符合條件的工廠（> 300）`, () => {
  async function allPages(params: Parameters<typeof db.searchFactories>[0], pageSize = 50) {
    const seen: number[] = [];
    let total = -1;
    for (let page = 1; page <= 10; page++) {
      const r = await db.searchFactories({ ...params, page, pageSize });
      total = r.total;
      seen.push(...r.items.map(f => f.id));
      if (r.items.length < pageSize) break;
    }
    return { seen, total };
  }
  const intent = { normalizedQuery: BULK_KW, mainIndustries: [], subIndustries: [], productKeywords: [], searchSynonyms: [], confidence: 0.9 };

  it.each([
    ["一般關鍵字相關性排序", { industry: [BULK_IND], keyword: BULK_KW }],
    ["AI 模式（intent 信心 0.9）", { industry: [BULK_IND], keyword: BULK_KW, intent, userHasSelectedIndustry: true }],
    ["排序詞模式（rankingSignals）", { industry: [BULK_IND], rankingSignals: ["專精"] }],
  ])("%s：total＝%s，每一間都翻得到、沒有重複", async (_label, params) => {
    const { seen, total } = await allPages(params as any);
    expect(total).toBe(BULK_COUNT);
    expect(seen).toHaveLength(BULK_COUNT);
    expect(new Set(seen).size).toBe(BULK_COUNT);
    expect([...seen].sort((a, b) => a - b)).toEqual([...bulkIds].sort((a, b) => a - b));
  }, 60000);

  it("前 300 筆仍是既有排序（上限內語意不變）；第 301 筆起依評分順序接在後面", async () => {
    const { seen } = await allPages({ industry: [BULK_IND], keyword: BULK_KW });
    const [rows] = await exec(sql`SELECT id FROM factories WHERE status='approved' AND deletedAt IS NULL
      AND JSON_OVERLAPS(industry, ${JSON.stringify([BULK_IND])}) ORDER BY avgRating DESC, reviewCount DESC, id ASC`);
    const ratingOrder = (rows as { id: number }[]).map(r => r.id);
    expect(new Set(seen.slice(0, 300))).toEqual(new Set(ratingOrder.slice(0, 300)));
    expect(seen.slice(300)).toEqual(ratingOrder.slice(300));
  }, 60000);

  it("排序詞模式：尾段的 tier 用同一套規則計算（明確命中「專精」的是 2）", async () => {
    const last = await db.searchFactories({ industry: [BULK_IND], rankingSignals: ["專精"], page: 7, pageSize: 50 });
    expect(last.items.length).toBe(BULK_COUNT - 300);
    expect(last.tiers).toHaveLength(last.items.length);
    const [descRows] = await exec(sql`SELECT id, description FROM factories WHERE id IN (${sql.join(last.items.map(f => sql`${f.id}`), sql`, `)})`);
    const descById = new Map((descRows as { id: number; description: string }[]).map(r => [r.id, r.description]));
    last.items.forEach((f, i) => expect(last.tiers![i]).toBe(descById.get(f.id)!.includes("專精") ? 2 : 0));
  }, 60000);
});

// ── 5. 搜尋專用連線池 ───────────────────────────────────────────────────
describe("搜尋專用連線池：MySQL 端執行時間上限", () => {
  it(`搜尋連線的 max_execution_time＝${db.SEARCH_QUERY_MAX_EXECUTION_MS}ms；主連線池不受影響`, async () => {
    const searchDb = (await db.getSearchDb())!;
    const [[s]] = await searchDb.execute(sql`SELECT @@SESSION.max_execution_time AS t`) as unknown as [[{ t: number }]];
    expect(Number(s.t)).toBe(db.SEARCH_QUERY_MAX_EXECUTION_MS);
    const [[m]] = await (await db.getDb())!.execute(sql`SELECT @@SESSION.max_execution_time AS t`) as unknown as [[{ t: number }]];
    expect(Number(m.t)).toBe(0);
  });
  it("極慢查詢由 MySQL 端中止（ER_QUERY_TIMEOUT），連線可重用，之後一般搜尋正常", async () => {
    const searchDb = (await db.getSearchDb())!;
    const t0 = Date.now();
    const err = await searchDb.execute(sql`SELECT COUNT(*) FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c`).catch(e => e);
    const elapsed = Date.now() - t0;
    expect(db.isSearchQueryTimeoutError(err)).toBe(true);
    expect(elapsed).toBeLessThan(db.SEARCH_QUERY_MAX_EXECUTION_MS + 3000);
    const r = await db.searchFactories({ industry: [LIKE_IND], page: 1, pageSize: 5 });
    expect(r.total).toBeGreaterThan(0);
  }, 20000);
});

// ── 6. 正式環境 log 不含使用者輸入 ─────────────────────────────────────
describe("搜尋 log 隱私（結構性保證）", () => {
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf-8");
  it("db.ts 搜尋區段：含 keyword／工廠名稱的 log 一律走 searchDebugLog（正式環境不輸出）", () => {
    const src = read("db.ts");
    const section = src.slice(src.indexOf("const AI_CANDIDATE_LIMIT"), src.indexOf("export async function listApprovedFactoryNamesForIndex"));
    const withoutHelper = section.replace(/function searchDebugLog[\s\S]*?\r?\n\}/, "");
    expect(withoutHelper).not.toMatch(/console\.log\(/);
    expect(section).toMatch(/function searchDebugLog\(message: string\): void \{\s*if \(!ENV\.isProduction\) console\.log\(message\);/);
  });
  it("routers.ts factory.search：路由 log 只在非正式環境輸出；每次搜尋的摘要 log 不含 keyword／q", () => {
    const src = read("routers.ts");
    const block = src.slice(src.indexOf("    search: publicProcedure.input(z.object({"), src.indexOf("    delete: protectedProcedure.input(z.object({ id: z.number() }))"));
    expect(block).toMatch(/if \(searchRoute && !ENV\.isProduction\) \{\s*console\.log\(`\[SearchRouter\] query=/);
    const summary = block.match(/console\.log\(`\[Search\][^\n]*/)![0];
    expect(summary).not.toMatch(/keyword|input\.q|name/);
  });
  it("semantic-search.ts：log 不含關鍵字", () => {
    const src = read("semantic-search.ts");
    for (const line of src.match(/console\.(log|warn|error)\([^\n]*/g) ?? []) expect(line).not.toMatch(/\$\{key\}|\$\{keyword\}/);
  });
});
