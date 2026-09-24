/**
 * Integration tests for AI mode ranking precision 修正（見對話中「AI ranking
 * read-only audit」發現的三個缺口，本輪修正）：
 *   1. factory name literal match 現在參與 AI tier（computeAIMatchTier）。
 *   2. product name / description 拆開判斷，不再合併成同一個 productExactMatch。
 *   3. productIntentMatch 不再需要 aiMainMatch && aiSubMatch 才有非零 tier。
 *
 * 用 production-like fixtures 重現上一輪 audit 報告裡的真實案例（CNC/木盒
 * description 誤判、塑膠 description literal 誤判、連接器 productIntent
 * without subMatch、模具 factory name contains、射出 AI intent 缺
 * subIndustry 但 structured literal match、線束 precision vs main-only）。
 * 不呼叫真正的 OpenAI：AISearchIntent 用手動建構的 fixture 直接傳給
 * db.searchFactories，繞過 getSearchIntent（跟 searchFactoriesParallelization.
 * test.ts／generalRelevanceRanking.test.ts 同一套既有模式）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import type { AISearchIntent } from "./semantic-search";
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
  const ownerId = await ensureTestUser(`aimt-owner-${label}-${runId}`, `AI Tier測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, description, subIndustry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, avgRating, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify([industry])}, ${opts.description ?? ""}, ${JSON.stringify(opts.subIndustry ?? [])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`AI Tier測試地址 ${label}`}, "approved", "normal", FALSE, ${opts.avgRating ?? 0}, NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(result.insertId);
  return result.insertId;
}

function baseIntent(overrides: Partial<AISearchIntent> = {}): AISearchIntent {
  return {
    normalizedQuery: "",
    mainIndustries: [],
    subIndustries: [],
    productKeywords: [],
    searchSynonyms: [],
    confidence: 0.9,
    ...overrides,
  };
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

describe("Case CNC/木盒 — product description 誤判不再跟真正 product name 命中同強度", () => {
  const INDUSTRY = `AIMT_CNC_${runId}`;
  let realCnc: number, woodBoxFalsePositive: number;

  beforeAll(async () => {
    realCnc = await createFactory("RealCNC", `CNC加工廠-${runId}`, INDUSTRY, {
      subIndustry: ["CNC加工 / 精密加工"], avgRating: 0,
    });
    await db.createProduct({ factoryId: realCnc, name: `CNC${runId}工具機外殼` });

    woodBoxFalsePositive = await createFactory("WoodBox", `木盒禮盒廠-${runId}`, `AIMT_CNC_DECOY_${runId}`, { avgRating: 5 });
    await db.createProduct({
      factoryId: woodBoxFalsePositive,
      name: `威士忌禮盒-${runId}`,
      description: `高密度木盒，加工方式類似CNC${runId}切割`,
    });
  }, 30000);

  it("真正 CNC 產品名稱命中（+subIndustry exact）排在純 description 命中之前，即使評分較低", async () => {
    const result = await db.searchFactories({
      keyword: `CNC${runId}`,
      intent: baseIntent({ mainIndustries: [INDUSTRY], subIndustries: ["CNC加工 / 精密加工"] }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(ids).toContain(realCnc);
    expect(ids).toContain(woodBoxFalsePositive);
    expect(rankOf(ids, realCnc)).toBeLessThan(rankOf(ids, woodBoxFalsePositive));
  });
});

describe("Case 塑膠 — description-only literal match（含否定語境詞）不再與真正 product name 命中同 tier", () => {
  const INDUSTRY = `AIMT_PLASTIC_${runId}`;
  let realPlastic: number, negationFalsePositive: number;

  beforeAll(async () => {
    realPlastic = await createFactory("RealPlastic", `塑膠製品廠-${runId}`, INDUSTRY, {
      subIndustry: ["塑膠外殼 / 零件"], avgRating: 0,
    });
    await db.createProduct({ factoryId: realPlastic, name: `塑膠${runId}外殼零件` });

    negationFalsePositive = await createFactory("MetalMat", `鋁地墊廠-${runId}`, `AIMT_PLASTIC_DECOY_${runId}`, { avgRating: 5 });
    await db.createProduct({
      factoryId: negationFalsePositive,
      name: `經典木紋航空鋁地墊-${runId}`,
      description: `不用像塑膠${runId}地墊一樣擔心耐用度`,
    });
  }, 30000);

  it("真正塑膠製品（product name + subIndustry exact）排在 description literal 命中之前", async () => {
    const result = await db.searchFactories({
      keyword: `塑膠${runId}`,
      intent: baseIntent({ mainIndustries: [INDUSTRY], subIndustries: ["塑膠外殼 / 零件"] }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, realPlastic)).toBeLessThan(rankOf(ids, negationFalsePositive));
  });
});

describe("Case 連接器 — subIndustry literal exact 仍是最高 precision；productIntentMatch（無 aiSubMatch）優先於 main-only", () => {
  const INDUSTRY = `AIMT_CONN_${runId}`;
  let subIndustryLiteralMatch: number, productIntentNoSub: number, mainOnly: number;

  beforeAll(async () => {
    // 用真實 taxonomy 值（連接器 / 端子）＋真實 keyword「連接器」，讓
    // resolveSubIndustryKeywordMatches 真的能解析到，重現 section 9「id61
    // 應為第一優先 precision 結果」這個真實案例的機制（跟 aiSubMatch 是
    // 兩條獨立路徑，見對話中「請區分 basicSignals.subIndustryExact 與
    // aiSubIndustryMatch」）。
    subIndustryLiteralMatch = await createFactory("SubLiteral", `連接器廠-${runId}`, INDUSTRY, {
      subIndustry: ["連接器 / 端子"], avgRating: 0,
    });
    // aiMainMatch=true（同 INDUSTRY），但 subIndustry 不在 intent.subIndustries
    // 裡（aiSubMatch=false），靠 product 命中 AI productKeywords 拿到
    // productIntentMatch=true——對應上一輪 audit 發現的 id59 案例。
    productIntentNoSub = await createFactory("IntentNoSub", `線材廠-${runId}`, INDUSTRY, {
      subIndustry: [`線材 / 電纜${runId}`], avgRating: 5,
    });
    await db.createProduct({ factoryId: productIntentNoSub, name: `AITERM${runId.slice(-6)}端子零件` });
    mainOnly = await createFactory("ConnMainOnly", `電子組裝廠-${runId}`, INDUSTRY, {
      subIndustry: [`電子組裝${runId}`], avgRating: 5,
    });
  }, 30000);

  it("subIndustry literal exact 排最前；productIntentMatch（無 aiSubMatch）排在純 mainIndustry-only 之前", async () => {
    const result = await db.searchFactories({
      industry: [INDUSTRY],
      keyword: "連接器",
      intent: baseIntent({
        mainIndustries: [INDUSTRY],
        subIndustries: ["連接器 / 端子"],
        productKeywords: [`AITERM${runId.slice(-6)}`],
      }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, subIndustryLiteralMatch)).toBe(0);
    expect(rankOf(ids, productIntentNoSub)).toBeLessThan(rankOf(ids, mainOnly));
  });
});

describe("Case 模具 — factory name contains（忠興模具企業社模式）不會被 AI subMatch/synonym/高評分壓過", () => {
  const INDUSTRY = `AIMT_MOLD_${runId}`;
  let nameMatch: number, aiSubAndSynonymMatch: number;

  beforeAll(async () => {
    nameMatch = await createFactory("NameMatch", `忠興模具${runId}企業社`, INDUSTRY, { avgRating: 0 });

    aiSubAndSynonymMatch = await createFactory("AiMatch", `某精密工業-${runId}`, INDUSTRY, {
      subIndustry: [`模具製造${runId}`], avgRating: 5,
    });
    await db.createProduct({ factoryId: aiSubAndSynonymMatch, name: `開模${runId}服務` });
  }, 30000);

  it("factory name contains 排第一，即使評分為 0，AI sub+synonym 命中的高評分工廠排在後面", async () => {
    const result = await db.searchFactories({
      keyword: `模具${runId}`,
      intent: baseIntent({
        mainIndustries: [INDUSTRY],
        subIndustries: [`模具製造${runId}`],
        productKeywords: [`開模${runId}`],
      }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, nameMatch)).toBe(0);
    expect(rankOf(ids, nameMatch)).toBeLessThan(rankOf(ids, aiSubAndSynonymMatch));
  });
});

describe("Case 射出 — AI intent 缺 subIndustries 時，structured literal signals（product name literal）仍能兜底排序", () => {
  const INDUSTRY = `AIMT_INJECT_${runId}`;
  let trueInjectionMolder: number, mainOnlyCompetitor: number;

  beforeAll(async () => {
    // intent.subIndustries 故意留空（模擬 proxy intent 缺欄位、或上一輪 audit
    // 發現的「射出成型」屬於資料庫舊資料、已不在現行 taxonomy 裡因而無法靠
    // resolveSubIndustryKeywordMatches 解析的情境）——這間工廠靠 product
    // name 真正的字面命中（跟 AI intent 完全無關的 basicSignals）兜底排到
    // 前面，而不是靠 AI 推導。
    trueInjectionMolder = await createFactory("TrueInject", `射出成型廠-${runId}`, INDUSTRY, { avgRating: 0 });
    await db.createProduct({ factoryId: trueInjectionMolder, name: `射出${runId}成型服務` });
    mainOnlyCompetitor = await createFactory("MainOnly", `其他塑膠廠-${runId}`, INDUSTRY, { avgRating: 5 });
  }, 30000);

  it("真正射出成型工廠（product name literal 命中）排在純 mainIndustry-only 之前，即使 intent.subIndustries 是空陣列", async () => {
    const result = await db.searchFactories({
      industry: [INDUSTRY],
      keyword: `射出${runId}`,
      intent: baseIntent({ mainIndustries: [INDUSTRY], subIndustries: [] }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, trueInjectionMolder)).toBeLessThan(rankOf(ids, mainOnlyCompetitor));
  });
});

describe("Case 線束 — precision（main+sub taxonomy）優先於 main-only（broad）", () => {
  const INDUSTRY = `AIMT_WIRE_${runId}`;
  let precisionMatch: number, mainOnlyA: number, mainOnlyB: number;

  beforeAll(async () => {
    precisionMatch = await createFactory("Precision", `線束廠-${runId}`, INDUSTRY, {
      subIndustry: [`線束 / 線組加工${runId}`], avgRating: 0,
    });
    mainOnlyA = await createFactory("MainOnlyA", `CNC廠-${runId}`, INDUSTRY, {
      subIndustry: [`CNC加工${runId}`], avgRating: 5,
    });
    mainOnlyB = await createFactory("MainOnlyB", `SMT廠-${runId}`, INDUSTRY, {
      subIndustry: [`電子組裝${runId}`], avgRating: 5,
    });
  }, 30000);

  it("precision（subMatch=true）排在 main-only（subMatch=false）之前，即使 main-only 評分更高", async () => {
    const result = await db.searchFactories({
      keyword: `線束${runId}`,
      intent: baseIntent({ mainIndustries: [INDUSTRY], subIndustries: [`線束 / 線組加工${runId}`] }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, precisionMatch)).toBeLessThan(rankOf(ids, mainOnlyA));
    expect(rankOf(ids, precisionMatch)).toBeLessThan(rankOf(ids, mainOnlyB));
  });
});

describe("Case rating tie-break — 低 tier 高評分不可超車高 tier 低評分", () => {
  const INDUSTRY = `AIMT_RATING_${runId}`;
  let highTierLowRating: number, lowTierHighRating: number;

  beforeAll(async () => {
    highTierLowRating = await createFactory("HighTier", `精密加工${runId}廠`, INDUSTRY, { avgRating: 0 }); // factory name contains
    lowTierHighRating = await createFactory("LowTier", `其他廠-${runId}`, `AIMT_RATING_DECOY_${runId}`, { avgRating: 5 }); // main-only
  }, 30000);

  it("factory name contains（tier 8，評分0）排在 mainIndustry-only（tier 0，評分5）之前", async () => {
    const result = await db.searchFactories({
      keyword: `精密加工${runId}`,
      intent: baseIntent({ mainIndustries: [`AIMT_RATING_DECOY_${runId}`] }),
      userHasSelectedIndustry: false,
      pageSize: 50,
    });
    const ids = result.items.map(f => f.id);
    expect(rankOf(ids, highTierLowRating)).toBeLessThan(rankOf(ids, lowTierHighRating));
  });
});
