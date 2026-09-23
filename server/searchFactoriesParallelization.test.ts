/**
 * Regression tests for the searchFactories / factory.search 平行化改動
 * （keywordProductIds‖aiProductIds、count‖candidates/items、
 * searchFactories‖getActiveAds）。目的不是重新測試既有搜尋邏輯本身（那些
 * 已由 factorySmallBatchSampleFilter.test.ts 等既有測試涵蓋），而是確認
 * 「把循序 await 改成 Promise.all」這件事本身沒有改變：
 *   1. 結果集合／total／排序
 *   2. useAIMode=false 時不會多打 AI product query
 *   3. page===1 才查 ads、page>1 不查
 *   4. 其中一個平行 query 失敗時，錯誤會正常拋出，不會被吞掉
 *
 * 不呼叫真正的 OpenAI：AI mode 用手動建構的 AISearchIntent fixture 直接傳給
 * db.searchFactories，繞過 getSearchIntent。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { AISearchIntent } from "./semantic-search";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

// 這個測試檔的 router-level 測試（透過 appRouter.createCaller 打
// factory.search）不該真的呼叫 OpenAI：getSearchIntent 固定回傳 null（→
// non-AI mode）。intent 為 null 時 router 會 fallback 呼叫
// enhanceSearchKeyword——這裡刻意不 mock 它、用真正的實作，因為它在
// ANTHROPIC_API_KEY 未設定（本機 .env 現況）時第一行就直接原樣回傳關鍵字，
// 完全不會打任何網路請求（見 server/semantic-search.ts isLegacyEnabled()）。
// AI mode 的行為改用手動建構的 AISearchIntent fixture 直接傳給
// db.searchFactories 測試，不經過 getSearchIntent。
vi.mock("./semantic-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./semantic-search")>();
  return {
    ...actual,
    getSearchIntent: vi.fn().mockResolvedValue(null),
  };
});

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const ownerIds: number[] = [];
const factoryIds: number[] = [];

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function createFactory(label: string, industry: string, region = "新竹市", capitalLevel = "<1000萬") {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`spar-owner-${label}-${runId}`, `平行化測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${`SPAR-${label}-${runId}`}, ${JSON.stringify([industry])}, ${JSON.stringify(["ODM"])}, ${region}, ${capitalLevel}, ${`平行化測試地址 ${label}`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(result.insertId);
  return result.insertId;
}

async function setAvgRating(factoryId: number, rating: number) {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`UPDATE factories SET avgRating = ${rating} WHERE id = ${factoryId}`);
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchFactories — non-AI mode 平行化 (keywordProductIds ‖ count ‖ items)", () => {
  const INDUSTRY = `SPAR_NONAI_${runId}`;
  const KEYWORD = `XKW${runId.slice(-6)}`;
  let byNameId: number;
  let byProductId: number;
  let noMatchId: number;

  beforeAll(async () => {
    byNameId = await createFactory("ByName", INDUSTRY);
    byProductId = await createFactory("ByProduct", INDUSTRY);
    noMatchId = await createFactory("NoMatch", INDUSTRY);

    // byNameId 命中靠 factories.name（改名成含關鍵字）；byProductId 靠
    // products.name（走 keywordProductIds → factoryId 反查）。
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET name = ${`${KEYWORD}-工廠`} WHERE id = ${byNameId}`);
    await db.createProduct({ factoryId: byProductId, name: `${KEYWORD}零件` });

    // 排序驗證：byProductId 評分較高，但 byNameId 是 factory name 命中
    // （relevance tier 5）、byProductId 只是 product name 命中（tier 3）——
    // 見 server/search-match-signals.ts 的 General relevance ranking，
    // 「工廠名稱命中」永遠不會因為評分較低被排到「商品名稱命中」後面
    // （這正是這一輪要修正的錯排案例類型，見對話中的稽核報告）。
    await setAvgRating(byNameId, 3.0);
    await setAvgRating(byProductId, 4.5);
  }, 30000);

  it("回傳靠 factories.name 命中與靠 products.name（factoryId 反查）命中的兩間工廠，排除無關工廠，total 正確，依 relevance tier 排序（factory name 命中優先於評分）", async () => {
    const result = await db.searchFactories({ industry: [INDUSTRY], keyword: KEYWORD, pageSize: 50 });
    const ids = result.items.map(f => f.id);
    expect(ids).toContain(byNameId);
    expect(ids).toContain(byProductId);
    expect(ids).not.toContain(noMatchId);
    expect(result.total).toBe(2);
    // General relevance ranking：factory name contains（tier 5）優先於
    // product name contains（tier 3），不因為 byProductId 評分較高（4.5 vs
    // 3.0）就排到前面——tier 之間不可能靠評分跨級超車。
    expect(ids.indexOf(byNameId)).toBeLessThan(ids.indexOf(byProductId));
  });

  it("透過 router（factory.search）呼叫同一條路徑，結果一致", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.factory.search({ industry: [INDUSTRY], keyword: KEYWORD, page: 1, pageSize: 50 });
    const ids = result.items.map((f: any) => f.id);
    expect(ids).toContain(byNameId);
    expect(ids).toContain(byProductId);
    expect(result.total).toBe(2);
  }, 15000);
});

describe("searchFactories — AI mode 平行化 (keywordProductIds ‖ aiProductIds ‖ count ‖ candidates)", () => {
  const INDUSTRY = `SPAR_AI_${runId}`;
  const DECOY_INDUSTRY = `SPAR_AI_DECOY_${runId}`; // intent.mainIndustries 故意指向這個，確保它不會透過產業比對命中任何 fixture
  const RAW_KEYWORD = `XRAWKW${runId.slice(-6)}`;
  const AI_TERM = `XAITERM${runId.slice(-6)}`;
  let byKeywordId: number;
  let byAiTermId: number;
  let noMatchId: number;

  const fixtureIntent: AISearchIntent = {
    normalizedQuery: RAW_KEYWORD,
    mainIndustries: [DECOY_INDUSTRY],
    subIndustries: [],
    productKeywords: [AI_TERM],
    searchSynonyms: [],
    confidence: 0.9, // >= 0.5 → useAIMode=true（sortBy 預設不傳，符合 !sortBy 條件）
  };

  beforeAll(async () => {
    byKeywordId = await createFactory("AiByKeyword", INDUSTRY);
    byAiTermId  = await createFactory("AiByTerm", INDUSTRY);
    noMatchId   = await createFactory("AiNoMatch", INDUSTRY);

    // byKeywordId 只能靠 keywordProductIds（原始 keyword）命中；
    // byAiTermId 只能靠 aiProductIds（intent.productKeywords）命中——
    // mainIndustries 故意指向不相關的 DECOY_INDUSTRY，所以「產業命中」這條
    // content condition 不會貢獻任何候選，兩者都必須真的透過平行查出來的
    // product id 才會出現在結果裡。
    await db.createProduct({ factoryId: byKeywordId, name: `${RAW_KEYWORD}產品` });
    await db.createProduct({ factoryId: byAiTermId,  name: `${AI_TERM}產品` });
  }, 30000);

  it("keywordProductIds 與 aiProductIds 兩條平行查詢的結果都有被正確合併進候選集合", async () => {
    const result = await db.searchFactories({
      industry: [INDUSTRY],
      keyword: RAW_KEYWORD,
      intent: fixtureIntent,
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(ids).toContain(byKeywordId);
    expect(ids).toContain(byAiTermId);
    expect(ids).not.toContain(noMatchId);
    expect(result.total).toBe(2);
  });

  it("useAIMode=false（低信心 intent）時，不會查 aiProductIds，只有 keyword 命中的工廠出現", async () => {
    const lowConfidenceIntent: AISearchIntent = { ...fixtureIntent, confidence: 0.2 };
    const result = await db.searchFactories({
      industry: [INDUSTRY],
      keyword: RAW_KEYWORD,
      intent: lowConfidenceIntent,
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(ids).toContain(byKeywordId);
    expect(ids).not.toContain(byAiTermId); // aiProductIds 沒跑，AI term 命中的工廠不應出現
  });
});

describe("factory.search — searchFactories ‖ getActiveAds 平行化", () => {
  const INDUSTRY = `SPAR_ADS_${runId}`;
  const REGION = "新竹市";
  const CAPITAL = "<1000萬";
  let adFactoryId: number;

  beforeAll(async () => {
    adFactoryId = await createFactory("AdFactory", INDUSTRY, REGION, CAPITAL);
    const now = Date.now();
    await db.createAd({
      factoryId: adFactoryId,
      industry: INDUSTRY,
      capitalLevel: CAPITAL,
      region: REGION,
      startDate: new Date(now - 24 * 60 * 60 * 1000),
      endDate: new Date(now + 24 * 60 * 60 * 1000),
    });
  }, 30000);

  it("page=1 時回傳的 ads 包含這則廣告", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.factory.search({
      industry: [INDUSTRY], region: [REGION], capitalLevel: [CAPITAL], page: 1, pageSize: 20,
    });
    const adFactoryIds = (result.ads as any[]).map(a => a.factoryId);
    expect(adFactoryIds).toContain(adFactoryId);
  }, 15000);

  it("page=2 時不查 ads：回傳的 ads 為空陣列，且 getActiveAds 完全沒被呼叫", async () => {
    const spy = vi.spyOn(db, "getActiveAds");
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.factory.search({
      industry: [INDUSTRY], region: [REGION], capitalLevel: [CAPITAL], page: 2, pageSize: 20,
    });
    expect(result.ads).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  }, 15000);
});

describe("factory.search — 平行 query 其中一個失敗時，錯誤正常拋出（不被吞掉）", () => {
  it("db.searchFactories 失敗時，整個 request 應該 reject，不會回傳空結果", async () => {
    vi.spyOn(db, "searchFactories").mockRejectedValueOnce(new Error("simulated DB failure"));
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.factory.search({ page: 1, pageSize: 10 })).rejects.toThrow();
  }, 15000);

  it("db.getActiveAds 失敗時（page=1），整個 request 也應該 reject", async () => {
    vi.spyOn(db, "getActiveAds").mockRejectedValueOnce(new Error("simulated ads DB failure"));
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.factory.search({ page: 1, pageSize: 10 })).rejects.toThrow();
  }, 15000);
});
