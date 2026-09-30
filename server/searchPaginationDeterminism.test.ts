/**
 * searchFactories 分頁 deterministic 迴歸測試 — 整合測試，真的走資料庫
 * （fixture 模式沿用 server/factorySmallBatchSampleFilter.test.ts）。
 *
 * 背景（Production Hardening Batch 1）：正式站 44 家 approved 工廠中有 37 家
 * avgRating=0／reviewCount=0，排序只有 avgRating DESC, reviewCount DESC、沒有
 * 唯一 tiebreaker，MySQL 對「非唯一 ORDER BY + LIMIT/OFFSET」不保證各頁順序
 * 一致——實測預設瀏覽第 1、2 頁重複 4 家、另外 4 家永遠不出現。
 *
 * 這裡建立 45 間「所有排序欄位完全相同」的 approved 工廠（相同 avgRating／
 * reviewCount／avgResponseHours／createdAt／updatedAt），另外穿插 9 間高分
 * 工廠重現正式站的資料形狀，用本次測試專屬的
 * industry／subIndustry／region 把候選集合限縮在這 45 間，逐頁抓完後斷言：
 * 無重複、無遺漏、聯集 === total、重跑順序一致。涵蓋 SQL 分頁路徑（預設／
 * reviews／response／newest 排序）與 JS 候選池分頁路徑（keyword relevance、
 * rankingSignals）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `SPD_TEST_${runId}`;
const TEST_SUB_INDUSTRY = `SPD_SUB_${runId}`;
// factories.region 是 varchar(20)，需要短的專屬值。
const TEST_REGION = `SPD${Math.random().toString(36).slice(2, 10)}`;
const NAME_KEYWORD = `SPDKW${runId}`;
const TIED_COUNT = 45;
// 正式站的實際形狀：大量同分（0 分）之間穿插少數高分工廠。只有同分的資料
// 在本機 MySQL 可能剛好以插入順序回傳、掩蓋 bug；穿插不同分數會讓 filesort
// 走 LIMIT 的 priority queue（不穩定排序），才能在修正前真正重現跨頁重複／遺漏。
const RATED_EVERY = 5;
const FACTORY_COUNT = TIED_COUNT + Math.floor(TIED_COUNT / RATED_EVERY);
const PAGE_SIZE = 20;
// 全部工廠共用同一個時間戳記，讓 newest 排序與 relevance 排序的 updatedAt
// 比較也全部相同，只剩唯一 tiebreaker 能決定順序。
const FIXED_TS = "2026-01-01 00:00:00";

const ownerIds: number[] = [];
const factoryIds: number[] = [];

beforeAll(async () => {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  for (let i = 0; i < FACTORY_COUNT; i++) {
    const ownerId = await ensureTestUser(`spd-owner-${i}-${runId}`, `分頁測試擁有者-${i}`);
    ownerIds.push(ownerId);
    // 每第 RATED_EVERY 間是 5 分／1 則評價，其餘（>= 45 間）全部 0 分／0 則。
    const rated = i % (RATED_EVERY + 1) === RATED_EVERY;
    const avgRating = rated ? "5.00" : "0.00";
    const reviewCount = rated ? 1 : 0;
    const [result] = (await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, avgRating, reviewCount, createdAt, updatedAt, publicContentUpdatedAt)
      VALUES (${ownerId}, ${`${NAME_KEYWORD}-${i}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, ${TEST_REGION}, "<1000萬", ${`SPD 測試地址 ${i}`}, "approved", "normal", FALSE, ${JSON.stringify([TEST_SUB_INDUSTRY])}, ${avgRating}, ${reviewCount}, ${FIXED_TS}, ${FIXED_TS}, ${FIXED_TS})
    `)) as unknown as [{ insertId: number }, unknown];
    factoryIds.push(result.insertId);
  }
  const [tied] = (await conn.execute(sql`
    SELECT COUNT(*) AS n FROM factories WHERE region = ${TEST_REGION} AND avgRating = 0 AND reviewCount = 0
  `)) as unknown as [{ n: number }[], unknown];
  if (Number(tied[0].n) < TIED_COUNT) throw new Error("fixture: tied factory count below 45");
}, 120000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of factoryIds) {
      await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    }
  }
  for (const ownerId of ownerIds) {
    await deleteTestUser(ownerId);
  }
}, 120000);

type SearchParams = Parameters<typeof db.searchFactories>[0];

async function fetchAllPages(params: SearchParams) {
  const pages: number[][] = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const result = await db.searchFactories({ ...params, page, pageSize: PAGE_SIZE });
    total = result.total;
    if (result.items.length === 0) break;
    pages.push(result.items.map(f => f.id));
    if (page * PAGE_SIZE >= total) break;
  }
  return { pages, total };
}

function analyse(pages: number[][], expectedIds: number[]) {
  const all = pages.flat();
  const unique = new Set(all);
  const expected = new Set(expectedIds);
  return {
    returned: all.length,
    uniqueCount: unique.size,
    duplicateCount: all.length - unique.size,
    missing: expectedIds.filter(id => !unique.has(id)),
    unexpected: all.filter(id => !expected.has(id)),
  };
}

async function assertDeterministicPagination(params: SearchParams) {
  const first = await fetchAllPages(params);
  const stats = analyse(first.pages, factoryIds);

  expect(first.total).toBe(FACTORY_COUNT);
  expect(first.pages.length).toBe(Math.ceil(FACTORY_COUNT / PAGE_SIZE));
  expect(stats.duplicateCount).toBe(0);
  expect(stats.missing).toEqual([]);
  expect(stats.unexpected).toEqual([]);
  expect(stats.uniqueCount).toBe(first.total);

  // 相鄰頁面交集為空
  for (let i = 0; i + 1 < first.pages.length; i++) {
    const next = new Set(first.pages[i + 1]);
    expect(first.pages[i].filter(id => next.has(id))).toEqual([]);
  }

  // 同一 query 重跑：每一頁的內容與順序完全一致（page boundaries 穩定）
  const second = await fetchAllPages(params);
  expect(second.pages).toEqual(first.pages);
  return stats;
}

/**
 * 引擎無關的 ORDER BY 契約檢查：上面的資料層測試能否重現 bug 取決於 MySQL
 * 版本與 filesort 策略（本機 8.0 對同分資料剛好以主鍵順序回傳，正式站 9.7
 * 則會跨頁重複／遺漏）。這裡直接攔截 drizzle 送到 mysql2 pool 的 SQL，斷言
 * searchFactories 每一條「SELECT … FROM factories … ORDER BY」的最後一個排序
 * 鍵都是唯一的 factories.id，不依賴任何 MySQL 版本行為。
 */
async function captureSearchSql(params: SearchParams): Promise<string[]> {
  // Batch 3.6：searchFactories 改走搜尋專用連線池（getSearchDb）
  const conn = await db.getSearchDb();
  if (!conn) throw new Error("no db");
  const client = (conn as unknown as { session: { client: Record<string, (...args: any[]) => any> } }).session.client;
  const captured: string[] = [];
  const originals = { query: client.query, execute: client.execute };
  for (const method of ["query", "execute"] as const) {
    client[method] = function (this: unknown, ...args: any[]) {
      const first = args[0];
      captured.push(typeof first === "string" ? first : String(first?.sql ?? ""));
      return originals[method].apply(this, args);
    };
  }
  try {
    await db.searchFactories({ ...params, page: 2, pageSize: PAGE_SIZE });
  } finally {
    client.query = originals.query;
    client.execute = originals.execute;
  }
  return captured.filter(s => /from `factories`/i.test(s) && /order by/i.test(s));
}

describe("searchFactories ORDER BY 契約：最後一個排序鍵必須是唯一的 factories.id", () => {
  const cases: [string, SearchParams][] = [
    ["預設排序（SQL 分頁）", { industry: [TEST_INDUSTRY] }],
    ["sortBy=rating", { industry: [TEST_INDUSTRY], sortBy: "rating" }],
    ["sortBy=reviews", { industry: [TEST_INDUSTRY], sortBy: "reviews" }],
    ["sortBy=response", { industry: [TEST_INDUSTRY], sortBy: "response" }],
    ["sortBy=newest", { industry: [TEST_INDUSTRY], sortBy: "newest" }],
    ["keyword relevance 候選池", { industry: [TEST_INDUSTRY], keyword: NAME_KEYWORD }],
    ["rankingSignals 候選池", { industry: [TEST_INDUSTRY], rankingSignals: ["不存在的能力詞"] }],
    ["AI intent 候選池", {
      industry: [TEST_INDUSTRY], keyword: NAME_KEYWORD, userHasSelectedIndustry: true,
      intent: { normalizedQuery: NAME_KEYWORD.toLowerCase(), mainIndustries: [], subIndustries: [], productKeywords: [], searchSynonyms: [], confidence: 0.9 },
    }],
  ];
  it.each(cases)("%s", async (_label, params) => {
    const orderedSelects = await captureSearchSql(params);
    expect(orderedSelects.length).toBeGreaterThan(0);
    for (const statement of orderedSelects) {
      const orderBy = statement.slice(statement.toLowerCase().lastIndexOf("order by"));
      expect(orderBy).toMatch(/`factories`\.`id`\s+(asc|desc)\s*(limit\b|$)/i);
    }
  });
});

describe("searchFactories 分頁 deterministic（>= 45 間同分 approved 工廠）", () => {
  it("industry filter，預設排序（SQL LIMIT/OFFSET 路徑）", async () => {
    await assertDeterministicPagination({ industry: [TEST_INDUSTRY] });
  });

  it("subIndustry filter，預設排序", async () => {
    await assertDeterministicPagination({ subIndustry: [TEST_SUB_INDUSTRY] });
  });

  it("region filter，預設排序", async () => {
    await assertDeterministicPagination({ region: [TEST_REGION] });
  });

  it.each(["rating", "reviews", "response", "newest"])("sortBy=%s", async (sortBy) => {
    await assertDeterministicPagination({ industry: [TEST_INDUSTRY], sortBy });
  });

  it("keyword relevance（JS 候選池排序＋JS 分頁路徑）", async () => {
    await assertDeterministicPagination({ industry: [TEST_INDUSTRY], keyword: NAME_KEYWORD });
  });

  it("rankingSignals（Hard Filter + AI Ranking 候選池路徑）", async () => {
    await assertDeterministicPagination({ industry: [TEST_INDUSTRY], rankingSignals: ["不存在的能力詞"] });
  });

  it("AI intent mode（intent 信心值 >= 0.5 的候選池路徑）", async () => {
    await assertDeterministicPagination({
      industry: [TEST_INDUSTRY],
      keyword: NAME_KEYWORD,
      userHasSelectedIndustry: true,
      intent: {
        normalizedQuery: NAME_KEYWORD.toLowerCase(),
        mainIndustries: [],
        subIndustries: [],
        productKeywords: [],
        searchSynonyms: [],
        confidence: 0.9,
      },
    });
  });
});
