/**
 * Integration tests for General（non-AI）mode relevance ranking（見對話中
 * 「General mode relevance ranking」、server/search-match-signals.ts）。
 *
 * 每個 case 都刻意讓「相關性應該較高」的工廠評分較低、「相關性應該較低」的
 * 工廠評分較高，驗證 relevance tier 真的優先於 avgRating——不會因為評分高
 * 就跨 tier 超車（見對話中上一輪稽核發現的真實錯排案例：CNC／模具／塑膠）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ownerIds: number[] = [];
const factoryIds: number[] = [];

async function createFactory(label: string, name: string, industry: string, opts: {
  description?: string;
  subIndustry?: string[];
  avgRating?: number;
} = {}) {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`grr-owner-${label}-${runId}`, `Relevance排序測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, description, subIndustry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, avgRating, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify([industry])}, ${opts.description ?? ""}, ${JSON.stringify(opts.subIndustry ?? [])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`Relevance測試地址 ${label}`}, "approved", "normal", FALSE, ${opts.avgRating ?? 0}, NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(result.insertId);
  return result.insertId;
}

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
}, 30000);

function rankOf(ids: number[], id: number): number {
  return ids.indexOf(id);
}

describe("Case A — 模具：factory name contains 應排在 description-only 前面（即使評分較低）", () => {
  const INDUSTRY = `GRR_A_${runId}`;
  let A: number, B: number;

  beforeAll(async () => {
    A = await createFactory("CaseA_A", `忠興模具企業社-${runId}`, INDUSTRY, { avgRating: 0 });
    B = await createFactory("CaseA_B", `SomeFactory-${runId}`, INDUSTRY, { description: "我們也承接模具相關代工", avgRating: 5 });
  }, 30000);

  it("A（name contains）排在 B（description-only）前面", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: "模具", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });
});

describe("Case B — CNC：subIndustry exact 與 product name contains 的相對排序", () => {
  const INDUSTRY = `GRR_B_${runId}`;
  let A: number, B: number;

  beforeAll(async () => {
    A = await createFactory("CaseB_A", `SubIndustryFactory-${runId}`, INDUSTRY, { subIndustry: ["CNC加工 / 精密加工"], avgRating: 0 });
    B = await createFactory("CaseB_B", `ProductFactory-${runId}`, INDUSTRY, { avgRating: 5 });
    await db.createProduct({ factoryId: B, name: `CNC加工零件-${runId}` }); // product name contains "CNC"
  }, 30000);

  it("A（subIndustry exact，tier 4）排在 B（product name contains，tier 3）前面，即使 B 評分較高", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: "CNC", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });
});

describe("Case C — 塑膠 false-positive：main industry exact 應排在 product description-only 前面", () => {
  const INDUSTRY = `GRR_C_${runId}塑膠`; // industry 本身就是這個測試用產業字串的一部分，直接用「塑膠」當關鍵字驗證
  let A: number, B: number;

  beforeAll(async () => {
    A = await createFactory("CaseC_A", `IndustryFactory-${runId}`, "塑膠", { avgRating: 0 });
    B = await createFactory("CaseC_B", `DescOnlyFactory-${runId}`, `GRR_C_DECOY_${runId}`, { avgRating: 5 });
    await db.createProduct({ factoryId: B, name: `不鏽鋼搬運箱-${runId}`, description: "材質包含塑膠配件與金屬骨架" });
  }, 30000);

  it("A（main industry exact，tier 2）排在 B（product description-only，tier 0）前面，即使 B 評分較高", async () => {
    const result = await db.searchFactories({ keyword: "塑膠", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(ids).toContain(A);
    expect(ids).toContain(B);
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });
});

describe("Case D — 油封：product name exact 應排在 description-only 前面", () => {
  const INDUSTRY = `GRR_D_${runId}`;
  let A: number, B: number;

  beforeAll(async () => {
    A = await createFactory("CaseD_A", `ProductExactFactory-${runId}`, INDUSTRY, { avgRating: 0 });
    await db.createProduct({ factoryId: A, name: "油封" });
    B = await createFactory("CaseD_B", `DescFactory-${runId}`, INDUSTRY, { description: "本廠亦承接油封相關零件", avgRating: 5 });
  }, 30000);

  it("A（product name exact，tier 4）排在 B（description-only，tier 1）前面，即使 B 評分較高", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: "油封", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });

  it("多個 product 的 signal 透過 keywordProductMatches 正確 OR 合併（見對話中「一間 factory 多個 products」）：A 額外加一個只有 description 命中的 product，productNameExact 仍然是 true（不會被稀釋）", async () => {
    await db.createProduct({ factoryId: A, name: "止漏環", description: "適用於油封周邊防漏" });
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: "油封", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    // A 仍然是 tier 4（productNameExact 來自第一個 product，不受新增的第二個
    // product 影響），排序結果不變。
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });
});

describe("Case E — 公司名稱：factory name contains 應永遠排在 description-only 前面", () => {
  const INDUSTRY = `GRR_E_${runId}`;
  const KEYWORD = `萬泰${runId.slice(-6)}`;
  let A: number, B: number;

  beforeAll(async () => {
    A = await createFactory("CaseE_A", `${KEYWORD}精密工業`, INDUSTRY, { avgRating: 0 });
    B = await createFactory("CaseE_B", `OtherFactory-${runId}`, INDUSTRY, { description: `本公司與${KEYWORD}精密工業同屬供應鏈夥伴`, avgRating: 5 });
  }, 30000);

  it("A（name contains，tier 5）排在 B（description-only，tier 1）前面，即使 B 評分較高", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: KEYWORD, pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, A)).toBeLessThan(rankOf(ids, B));
  });
});

describe("金屬加工 regression：同 tier（都是 main industry exact）時，維持 avgRating/reviewCount 排序", () => {
  const INDUSTRY = "金屬加工"; // 真實 taxonomy 主產業名稱，跟正式站 audit 使用同一個 query
  let higher: number, lower: number;

  beforeAll(async () => {
    higher = await createFactory("Higher", `MetalHigher-${runId}`, INDUSTRY, { avgRating: 5 });
    lower = await createFactory("Lower", `MetalLower-${runId}`, INDUSTRY, { avgRating: 1 });
  }, 30000);

  it("同一個 relevance tier（main industry exact）內，avgRating 高的排前面——沒有因為改用 relevance ranking 而破壞既有評分排序", async () => {
    const result = await db.searchFactories({ keyword: "金屬加工", pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, higher)).toBeLessThan(rankOf(ids, lower));
  });
});

describe("Pagination correctness：relevance ranking 不會讓高 tier 工廠因為分頁被切斷", () => {
  const INDUSTRY = `GRR_PAGE_${runId}`;
  const KEYWORD = `PAGEKW${runId.slice(-6)}`;
  let highTierId: number;
  const lowTierIds: number[] = [];

  beforeAll(async () => {
    // 建 5 間只有 description-only（tier 1，弱）命中、評分故意設很高的工廠，
    // 確保如果還是舊版「SQL rating 排序 + LIMIT」邏輯，這些工廠會排在
    // pageSize=1 的第一頁；而唯一一間 factory name exact 命中（tier 6，
    // 評分反而最低）的工廠應該仍然排第一。
    for (let i = 0; i < 5; i++) {
      const id = await createFactory(`Low${i}`, `LowTierFactory${i}-${runId}`, INDUSTRY, {
        description: `本廠提及關鍵字 ${KEYWORD} 於敘述中`, avgRating: 5 - i * 0.1,
      });
      lowTierIds.push(id);
    }
    highTierId = await createFactory("HighTier", KEYWORD, INDUSTRY, { avgRating: 0 });
  }, 30000);

  it("pageSize=1 的 page=1 仍然是 tier 6 的工廠，不會被評分較高的弱命中工廠擠出第一頁", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: KEYWORD, page: 1, pageSize: 1 });
    expect(result.items[0]?.id).toBe(highTierId);
    expect(result.total).toBe(6);
  });
});
