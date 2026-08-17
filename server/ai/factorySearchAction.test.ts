/**
 * Phase 6A：AI 找工廠——server/ai/factorySearchAction.ts 驗證。
 *
 * 搜尋邏輯修正後（見對話中「Phase 6A 搜尋邏輯修正：Hard Filters + AI
 * Ranking，不要用 AI 過度篩掉候選」）：Hard Filter（region/mainIndustry）決定
 * 候選集合，能力詞只用來排序，絕對不能把候選排除掉——這裡的整合測試直接連
 * 本機測試 DB，只 mock getSearchIntent（避免測試套件呼叫真實 OpenAI API），
 * 驗證候選集合真的沒有被能力詞誤刪、排序邏輯正確、visibility 沿用既有標準。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

const mockGetSearchIntent = vi.fn();
vi.mock("../semantic-search", () => ({
  getSearchIntent: (...args: unknown[]) => mockGetSearchIntent(...args),
}));

import { extractRegionsFromText, buildKeywordInputFromHistory, buildRankingSignals } from "./factorySearchAction";

describe("extractRegionsFromText：deterministic 白名單子字串比對", () => {
  it("命中一個地區", () => {
    expect(extractRegionsFromText("幫我找台中的CNC加工廠")).toEqual(["台中市"]);
  });

  it("沒有提到任何地區 → 空陣列", () => {
    expect(extractRegionsFromText("我要找CNC加工廠")).toEqual([]);
  });

  it("命中多個地區時全部回傳（去重）", () => {
    const regions = extractRegionsFromText("台中或台南都可以，最好是台中");
    expect(regions).toEqual(["台中市", "台南市"]);
  });

  it("不會把模型自創的字串誤判成地區（不在白名單裡就不算）", () => {
    expect(extractRegionsFromText("我在某個工業區")).toEqual([]);
  });
});

describe("buildKeywordInputFromHistory：只拼接 user 訊息，且有長度上限", () => {
  it("只取 role=user 的內容，assistant 訊息不計入", () => {
    const text = buildKeywordInputFromHistory([
      { role: "user", content: "我要找CNC加工廠" },
      { role: "assistant", content: "請問地區？" },
      { role: "user", content: "台中" },
    ]);
    expect(text).toBe("我要找CNC加工廠 台中");
  });

  it("空歷史回傳空字串", () => {
    expect(buildKeywordInputFromHistory([])).toBe("");
  });

  it("超長內容會被截斷（不會無上限餵給 getSearchIntent）", () => {
    const longMsg = "字".repeat(1000);
    const text = buildKeywordInputFromHistory([{ role: "user", content: longMsg }]);
    expect(text.length).toBeLessThanOrEqual(300);
  });
});

describe("buildRankingSignals：能力詞是排序訊號，不是篩選條件", () => {
  it("保留 productKeywords 中跟 mainIndustry 不重複、非填充詞的詞", () => {
    const signals = buildRankingSignals({
      intent: { normalizedQuery: "x", mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: ["金屬加工", "CNC", "五軸加工", "加工廠"], searchSynonyms: [], confidence: 0.9 },
      mainIndustries: ["金屬加工"],
    });
    expect(signals).toEqual(["CNC", "五軸加工"]);
  });

  it("V1 保留多個能力詞（不像舊版殘餘 keyword 只挑一個），因為現在是排序訊號可以同時吃多個", () => {
    const signals = buildRankingSignals({
      intent: { normalizedQuery: "x", mainIndustries: [], subIndustries: [], productKeywords: ["CNC", "五軸", "車銑複合"], searchSynonyms: [], confidence: 0.8 },
      mainIndustries: [],
    });
    expect(signals).toEqual(["CNC", "五軸", "車銑複合"]);
  });

  it("intent 為 null 時回傳空陣列", () => {
    expect(buildRankingSignals({ intent: null, mainIndustries: [] })).toEqual([]);
  });
});

// ===== 真實 DB 區塊 =====
const { getDb } = await import("../db");
const { createTestFactory } = await import("../_core/financeTestFixtures");
const { createProduct } = await import("../db");
const { runFactorySearchAction } = await import("./factorySearchAction");

const runId = `fsa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueTag = `FSA${runId.replace(/[^a-zA-Z0-9]/g, "")}`;
const cleanupFactoryIds: number[] = [];
const cleanupUserIds: number[] = [];
let userSeq = 0;

async function makeFactory(params: {
  status: "draft" | "pending" | "approved" | "rejected" | "delisted";
  name: string;
  industry: string[];
  region: string;
  description?: string;
}): Promise<number> {
  userSeq += 1;
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`FSA ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const ownerId = rows[0]!.id;
  cleanupUserIds.push(ownerId);
  const factoryId = await createTestFactory(ownerId, params.name, "approved");
  cleanupFactoryIds.push(factoryId);
  await conn.execute(sql`UPDATE factories SET status = ${params.status}, industry = ${JSON.stringify(params.industry)}, region = ${params.region}, description = ${params.description ?? ""} WHERE id = ${factoryId}`);
  return factoryId;
}

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const id of cleanupFactoryIds) {
    await conn.execute(sql`DELETE FROM products WHERE factoryId = ${id}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  }
  for (const id of cleanupUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

describe("CASE 1：Hard Filter 保留所有候選，能力詞只排序不排除", () => {
  it("同 region+mainIndustry 但公開資料沒提到能力詞的工廠仍然出現在候選裡（不會被 AI 過度篩掉）", async () => {
    const tag = `${uniqueTag}C1`;
    // region 欄位長度有限，不能塞 tag 前綴——用真實地區字串，靠 industry 的
    // tag 前綴做測試隔離即可（region+industry 是 AND 條件，不會誤命中其他
    // 測試的同地區資料）。
    const withSignalId = await makeFactory({
      status: "approved", name: `${tag} 五軸廠`, industry: [`${tag}金屬加工`], region: "台中市",
      description: "專精五軸 CNC 精密加工",
    });
    const withoutSignalId = await makeFactory({
      status: "approved", name: `${tag} 一般廠`, industry: [`${tag}金屬加工`], region: "台中市",
      description: "傳統金屬加工代工",
    });

    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: ["五軸", "CNC"], searchSynonyms: [], confidence: 0.9,
    });

    const result = await runFactorySearchAction([{ role: "user", content: `${tag} 台中 CNC 五軸` }]);
    const ids = result.candidates.map(c => c.factory.id);

    // 兩家都要保留，不能因為「一般廠」沒提到五軸/CNC 就被排除
    expect(ids).toContain(withSignalId);
    expect(ids).toContain(withoutSignalId);
    expect(result.total).toBe(2);
    expect(result.zeroResult).toBe(false);

    const withSignalCandidate = result.candidates.find(c => c.factory.id === withSignalId)!;
    const withoutSignalCandidate = result.candidates.find(c => c.factory.id === withoutSignalId)!;
    expect(withSignalCandidate.relevanceTier).toBe("high");
    expect(withoutSignalCandidate.relevanceTier).toBe("general");
    // 明確命中的排前面
    expect(result.candidates.indexOf(withSignalCandidate)).toBeLessThan(result.candidates.indexOf(withoutSignalCandidate));
    expect(result.hasExplicitCapabilityMatch).toBe(true);
  });
});

describe("CASE 2：商品文字（不是 factory.description）也要能提升 ranking", () => {
  it("factory 本身沒寫五軸，但商品名稱寫五軸 CNC，仍排到 general 廠前面", async () => {
    const tag = `${uniqueTag}C2`;
    const productMatchId = await makeFactory({
      status: "approved", name: `${tag} A廠`, industry: [`${tag}金屬加工`], region: "高雄市",
      description: "金屬零件代工",
    });
    await createProduct({ factoryId: productMatchId, name: "五軸 CNC 精密加工零件", description: "鋁合金五軸加工零件" });

    const noMatchId = await makeFactory({
      status: "approved", name: `${tag} B廠`, industry: [`${tag}金屬加工`], region: "高雄市",
      description: "金屬零件代工",
    });

    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: ["五軸", "CNC"], searchSynonyms: [], confidence: 0.9,
    });

    const result = await runFactorySearchAction([{ role: "user", content: `${tag} CNC 五軸` }]);
    const productMatchCandidate = result.candidates.find(c => c.factory.id === productMatchId)!;
    const noMatchCandidate = result.candidates.find(c => c.factory.id === noMatchId)!;
    expect(productMatchCandidate.relevanceTier).toBe("high");
    expect(noMatchCandidate.relevanceTier).toBe("general");
    expect(result.candidates.indexOf(productMatchCandidate)).toBeLessThan(result.candidates.indexOf(noMatchCandidate));
  });
});

describe("CASE 3：不同 region 不會被跨進來，即使該廠明確命中能力詞", () => {
  it("region hard filter 嚴格生效，外縣市工廠不出現", async () => {
    const tag = `${uniqueTag}C3`;
    // extractRegionsFromText 需要真正的地區白名單字串（台南市／高雄市）才能
    // 抽出 hard filter，工廠的 region 欄位也設成同樣真實字串，驗證 SQL 層的
    // region 隔離；industry 仍用本測試專屬 tag，避免跟其他並行測試的同名真實
    // 地區資料互相干擾。
    const inRegionId = await makeFactory({
      status: "approved", name: `${tag} 台南廠`, industry: [`${tag}金屬加工`], region: "台南市",
      description: "一般加工",
    });
    const outOfRegionId = await makeFactory({
      status: "approved", name: `${tag} 高雄五軸廠`, industry: [`${tag}金屬加工`], region: "高雄市",
      description: "五軸 CNC 精密加工專家",
    });

    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: ["五軸"], searchSynonyms: [], confidence: 0.9,
    });

    const result = await runFactorySearchAction([{ role: "user", content: `${tag} 台南 五軸` }]);
    const ids = result.candidates.map(c => c.factory.id);
    expect(ids).toContain(inRegionId);
    expect(ids).not.toContain(outOfRegionId);
  });
});

describe("CASE 4：完全沒有 hard filter（地區+主產業都空）→ 不搜尋，誠實回報 zeroResult", () => {
  it("intent 沒有 mainIndustries、文字也沒有地區 → zeroResult=true，不會顯示所有工廠", async () => {
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: "我要找供應商", mainIndustries: [], subIndustries: [],
      productKeywords: [], searchSynonyms: ["尋找供應商"], confidence: 0.2,
    });
    const result = await runFactorySearchAction([{ role: "user", content: "我要找供應商" }]);
    expect(result.zeroResult).toBe(true);
    expect(result.candidates).toEqual([]);
  });
});

describe("CASE 5：hard filter 候選集合本身 0 筆才是真正 zero result", () => {
  it("mainIndustry 有值但資料庫裡完全沒有符合的工廠 → zeroResult=true", async () => {
    const tag = `${uniqueTag}C5NOTEXIST`;
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}不存在的產業`], subIndustries: [],
      productKeywords: ["CNC"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: tag }]);
    expect(result.zeroResult).toBe(true);
    expect(result.total).toBe(0);
  });
});

describe("Visibility：approved 以外狀態不得出現在 AI 搜尋結果", () => {
  it("pending/rejected/delisted 都不會被搜到，只有 approved 出現", async () => {
    const tag = `${uniqueTag}VIS`;
    const approvedId = await makeFactory({ status: "approved", name: `${tag} Approved`, industry: [`${tag}產業`], region: "新竹市" });
    await makeFactory({ status: "pending", name: `${tag} Pending`, industry: [`${tag}產業`], region: "新竹市" });
    await makeFactory({ status: "rejected", name: `${tag} Rejected`, industry: [`${tag}產業`], region: "新竹市" });
    await makeFactory({ status: "delisted", name: `${tag} Delisted`, industry: [`${tag}產業`], region: "新竹市" });

    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}產業`], subIndustries: [],
      productKeywords: [], searchSynonyms: [], confidence: 0.9,
    });

    const result = await runFactorySearchAction([{ role: "user", content: tag }]);
    const ids = result.candidates.map(c => c.factory.id);
    expect(ids).toContain(approvedId);
    expect(ids.length).toBe(1);
  });
});

describe("viewAllUrl：只帶 hard filters（industry/region）+ q，不帶 subIndustry/keyword", () => {
  it("組出的網址不會把能力詞塞進 keyword，避免 /search 頁把它當 hard filter", async () => {
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: "cnc", mainIndustries: ["金屬加工"], subIndustries: ["CNC加工"],
      productKeywords: ["CNC", "五軸"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: "幫我找台中的CNC五軸加工廠" }]);
    expect(result.viewAllUrl.startsWith("/search?")).toBe(true);
    expect(result.viewAllUrl).toContain("industry=");
    expect(result.viewAllUrl).toContain("region=");
    expect(result.viewAllUrl).toContain("q=");
    expect(result.viewAllUrl).not.toContain("subIndustry=");
    expect(result.viewAllUrl).not.toContain("keyword=");
    expect(result.viewAllUrl).not.toContain("{");
  });

  it("有帶 conversationId 時額外附上 aiSearch=<conversationId>（AI Search Mode 的擁有權驗證入口）", async () => {
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: "cnc", mainIndustries: ["金屬加工"], subIndustries: [],
      productKeywords: ["CNC"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: "幫我找台中的CNC加工廠" }], 4242);
    expect(result.viewAllUrl).toContain("aiSearch=4242");
  });

  it("沒有帶 conversationId（訪客／stateless 路徑）時不會出現 aiSearch", async () => {
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: "cnc", mainIndustries: ["金屬加工"], subIndustries: [],
      productKeywords: ["CNC"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: "幫我找台中的CNC加工廠" }]);
    expect(result.viewAllUrl).not.toContain("aiSearch=");
  });
});

describe("見「OXM AI 已完成功能整體驗收修正」五：FactorySearchStatus 三種結構化狀態", () => {
  it("CASE F5 對應：Hard Filter 候選集合 0 筆 → NO_HARD_CANDIDATE，0 張候選", async () => {
    const tag = `${uniqueTag}STNOHARD`;
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}不存在的產業`], subIndustries: [],
      productKeywords: ["CNC"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: tag }]);
    expect(result.status).toBe("NO_HARD_CANDIDATE");
    expect(result.candidates).toEqual([]);
  });

  it("CASE F3 對應：有 hard candidates，但沒有任何候選對核心能力提供直接證據 → SIMILAR_ONLY", async () => {
    const tag = `${uniqueTag}STSIMILAR`;
    await makeFactory({
      status: "approved", name: `${tag} 一般廠`, industry: [`${tag}金屬加工`], region: "台中市",
      description: "傳統金屬加工代工，沒有提到五軸",
    });
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: ["五軸加工"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: `${tag} 台中 五軸加工` }]);
    expect(result.status).toBe("SIMILAR_ONLY");
    expect(result.hasExplicitCapabilityMatch).toBe(false);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("CASE F4 對應：至少一家候選對核心能力提供直接證據 → MATCH_FOUND", async () => {
    const tag = `${uniqueTag}STMATCH`;
    await makeFactory({
      status: "approved", name: `${tag} 五軸廠`, industry: [`${tag}金屬加工`], region: "台中市",
      description: "專精五軸 CNC 精密加工",
    });
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: ["五軸"], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: `${tag} 台中 五軸` }]);
    expect(result.status).toBe("MATCH_FOUND");
  });

  it("CASE F1/F2 對應：使用者沒有指定任何核心能力（只有地區＋產業）→ 有候選就是 MATCH_FOUND，不會被誤判成 SIMILAR_ONLY", async () => {
    const tag = `${uniqueTag}STNOSIGNAL`;
    await makeFactory({
      status: "approved", name: `${tag} 普通廠`, industry: [`${tag}金屬加工`], region: "南投縣",
      description: "一般代工",
    });
    mockGetSearchIntent.mockResolvedValue({
      normalizedQuery: tag, mainIndustries: [`${tag}金屬加工`], subIndustries: [],
      productKeywords: [], searchSynonyms: [], confidence: 0.9,
    });
    const result = await runFactorySearchAction([{ role: "user", content: `${tag} 南投金屬加工廠` }]);
    expect(result.appliedFilters.rankingSignals).toEqual([]);
    expect(result.status).toBe("MATCH_FOUND");
  });
});
