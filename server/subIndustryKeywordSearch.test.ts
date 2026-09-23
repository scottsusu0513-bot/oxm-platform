/**
 * Integration tests for 精準 subIndustry taxonomy keyword match（見
 * shared/subIndustryKeywordMatch.ts、server/db.ts searchFactories）——真的走
 * 資料庫，驗證 keyword 搜尋現在能命中 subIndustry 完全對應 taxonomy 原子詞
 * 的工廠，同時不會因為 substring 誤命中不相關的複合值。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `SIKS_TEST_${runId}`;

const ownerIds: number[] = [];
const factoryIds: { A: number; B: number } = {} as any;

async function createFactory(label: string, subIndustry: string[]): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`siks-owner-${label}-${runId}`, `subIndustry搜尋測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, subIndustry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, createdAt, updatedAt)
    VALUES (${ownerId}, ${`SIKS-${label}-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(subIndustry)}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`subIndustry搜尋測試地址 ${label}`}, "approved", "normal", FALSE, NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

beforeAll(async () => {
  // Factory A：subIndustry 剛好是「線束 / 線組加工」，description／products
  // 完全不含「線束」「線組加工」字樣，確保命中只可能是靠 subIndustry match。
  factoryIds.A = await createFactory("A", ["線束 / 線組加工"]);
  // Factory B：subIndustry 是「塑膠包裝」（單一原子詞，沒有「/」可拆），
  // 用來驗證搜尋「塑膠」不會因為 substring 誤命中。
  factoryIds.B = await createFactory("B", ["塑膠包裝"]);
}, 30000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of Object.values(factoryIds)) {
      await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    }
  }
  for (const ownerId of ownerIds) {
    await deleteTestUser(ownerId);
  }
}, 30000);

function idSet(items: { id: number }[]): Set<number> {
  return new Set(items.map(i => i.id));
}

describe("searchFactories — 精準 subIndustry taxonomy keyword match（non-AI mode，intent=null）", () => {
  it("搜尋「線束」命中 Factory A（subIndustry 精準命中，description/products 完全不含此字）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], keyword: "線束", pageSize: 50 });
    expect(idSet(result.items).has(factoryIds.A)).toBe(true);
  });

  it("搜尋「線組加工」也命中 Factory A（同一個複合值拆出的另一個原子詞）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], keyword: "線組加工", pageSize: 50 });
    expect(idSet(result.items).has(factoryIds.A)).toBe(true);
  });

  it("搜尋「塑膠」不會因為 Factory B 的 subIndustry「塑膠包裝」而誤命中（「塑膠」不是拆開後的原子詞）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], keyword: "塑膠", pageSize: 50 });
    expect(idSet(result.items).has(factoryIds.B)).toBe(false);
    expect(idSet(result.items).has(factoryIds.A)).toBe(false);
    expect(result.total).toBe(0);
  });

  it("搜尋「塑膠包裝」（完整原子詞，剛好本身沒有「/」，整串就是一個 sub 值）仍然能透過既有 JSON_SEARCH(industry) 以外機制找到——這裡驗證的是 exact 完整字串不會被 subIndustry mapping 誤傷，走的是既有一般文字比對", async () => {
    // 這裡 Factory B 沒有其他文字命中「塑膠包裝」（name/description 都不含），
    // 且「塑膠包裝」不是任何 INDUSTRIES[].sub 拆分後的「原子詞的子字串」情境
    // （它本身就是一個完整原子詞，resolveSubIndustryKeywordMatches 會直接
    // 命中它自己），所以應該要能找到 B。
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], keyword: "塑膠包裝", pageSize: 50 });
    expect(idSet(result.items).has(factoryIds.B)).toBe(true);
  });
});

describe("searchFactories — 精準 subIndustry taxonomy keyword match（AI mode，手動建構 intent fixture，不呼叫 OpenAI）", () => {
  it("AI mode 下搜尋「線束」同樣能命中 Factory A（AI mode 與 non-AI mode 共用同一份 subIndustry 條件）", async () => {
    const intent = {
      normalizedQuery: "線束",
      mainIndustries: [] as string[], // 刻意留空，確保命中不是靠 mainIndustries overlap
      subIndustries: [] as string[],
      productKeywords: [] as string[],
      searchSynonyms: [] as string[],
      confidence: 0.9,
    };
    const result = await db.searchFactories({
      industry: [TEST_INDUSTRY], keyword: "線束", intent, userHasSelectedIndustry: false, pageSize: 50,
    });
    expect(idSet(result.items).has(factoryIds.A)).toBe(true);
  });
});
