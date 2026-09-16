/**
 * 「可接小量」／「可打樣」搜尋篩選 — 整合測試，真的走資料庫（沿用
 * server/factoryPublicContentUpdatedAt.test.ts 已驗證過的 fixture 模式）。
 *
 * 背景：這兩個條件沒有 factory-level 欄位，只有既有的 product-level 欄位
 * products.acceptSmallOrder／products.provideSample（見 drizzle/schema.ts）。
 * 語意（使用者已確認）：工廠旗下只要「任一」product 符合就算該工廠符合，
 * 不要求同一個 product 同時符合兩個條件；沒有任何 product 的工廠一律不符合
 * 任何一邊。server/db.ts searchFactories 用 EXISTS 子查詢實作，套用在既有
 * conditions 陣列上（跟 status=approved 等既有條件一起 AND）。
 *
 * 用一個本次測試專屬、不會撞到真實資料的假 industry 字串把候選集合縮小到
 * 只剩這裡建立的 5 間工廠，避免正式環境既有工廠干擾斷言（不依賴分頁／排序
 * 剛好把測試工廠排進第一頁）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `SBSF_TEST_${runId}`;

// factories.ownerId 有 uq_factory_owner_id 唯一索引（一個 user 只能有一間工廠），
// 所以 5 間測試工廠需要 5 個各自獨立的 owner，不能共用同一個 ownerId。
const ownerIds: number[] = [];
const factoryIds: { A: number; B: number; C: number; D: number; E: number } = {} as any;

async function createFactory(label: string): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`sbsf-owner-${label}-${runId}`, `小量打樣篩選測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${`SBSF-${label}-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`SBSF 測試地址 ${label}`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

beforeAll(async () => {
  factoryIds.A = await createFactory("A");
  factoryIds.B = await createFactory("B");
  factoryIds.C = await createFactory("C");
  factoryIds.D = await createFactory("D");
  factoryIds.E = await createFactory("E");

  // A：只接小量
  await db.createProduct({ factoryId: factoryIds.A, name: "A1", acceptSmallOrder: true, provideSample: false });
  // B：只打樣
  await db.createProduct({ factoryId: factoryIds.B, name: "B1", acceptSmallOrder: false, provideSample: true });
  // C：同一個 product 兩者皆符合
  await db.createProduct({ factoryId: factoryIds.C, name: "C1", acceptSmallOrder: true, provideSample: true });
  // D：兩個不同 product 各自符合一邊 → 工廠整體視為兩者皆符合
  await db.createProduct({ factoryId: factoryIds.D, name: "D1", acceptSmallOrder: true, provideSample: false });
  await db.createProduct({ factoryId: factoryIds.D, name: "D2", acceptSmallOrder: false, provideSample: true });
  // E：無 product，兩者皆不符合
}, 30000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of Object.values(factoryIds)) {
      // products.factoryId 有 onDelete: cascade，刪 factory 會一併清掉 products。
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

describe("searchFactories smallBatch / sample EXISTS 篩選", () => {
  it("不加篩選：5 間測試工廠都在候選集合內（baseline）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], pageSize: 50 });
    const ids = idSet(result.items);
    for (const id of Object.values(factoryIds)) expect(ids.has(id)).toBe(true);
    expect(result.items.length).toBe(5);
  });

  it("smallBatch=true → A、C、D（B、E 被排除）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], smallBatch: true, pageSize: 50 });
    const ids = idSet(result.items);
    expect(ids.has(factoryIds.A)).toBe(true);
    expect(ids.has(factoryIds.C)).toBe(true);
    expect(ids.has(factoryIds.D)).toBe(true);
    expect(ids.has(factoryIds.B)).toBe(false);
    expect(ids.has(factoryIds.E)).toBe(false);
    expect(result.items.length).toBe(3);
  });

  it("sample=true → B、C、D（A、E 被排除）", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], sample: true, pageSize: 50 });
    const ids = idSet(result.items);
    expect(ids.has(factoryIds.B)).toBe(true);
    expect(ids.has(factoryIds.C)).toBe(true);
    expect(ids.has(factoryIds.D)).toBe(true);
    expect(ids.has(factoryIds.A)).toBe(false);
    expect(ids.has(factoryIds.E)).toBe(false);
    expect(result.items.length).toBe(3);
  });

  it("smallBatch=true + sample=true（AND）→ 只有 C、D", async () => {
    const result = await db.searchFactories({ industry: [TEST_INDUSTRY], smallBatch: true, sample: true, pageSize: 50 });
    const ids = idSet(result.items);
    expect(ids.has(factoryIds.C)).toBe(true);
    expect(ids.has(factoryIds.D)).toBe(true);
    expect(ids.has(factoryIds.A)).toBe(false);
    expect(ids.has(factoryIds.B)).toBe(false);
    expect(ids.has(factoryIds.E)).toBe(false);
    expect(result.items.length).toBe(2);
  });

  it("沒有任何 product 的工廠（E）在兩個條件下都不會出現", async () => {
    const smallBatchResult = await db.searchFactories({ industry: [TEST_INDUSTRY], smallBatch: true, pageSize: 50 });
    const sampleResult = await db.searchFactories({ industry: [TEST_INDUSTRY], sample: true, pageSize: 50 });
    expect(idSet(smallBatchResult.items).has(factoryIds.E)).toBe(false);
    expect(idSet(sampleResult.items).has(factoryIds.E)).toBe(false);
  });

  it("既有條件（industry／approved）仍然生效，不因新篩選被放寬", async () => {
    // 換一個不存在的 industry，即使 smallBatch=true 也應該完全沒有結果。
    const result = await db.searchFactories({ industry: [`不存在的產業_${runId}`], smallBatch: true, pageSize: 50 });
    expect(result.items.length).toBe(0);
  });
});
