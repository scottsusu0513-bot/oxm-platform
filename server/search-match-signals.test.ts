import { describe, expect, it } from "vitest";
import {
  computeSearchMatchSignals, computeGeneralMatchTier, computeAIMatchTier,
  type SearchMatchSignals, type AIIntentSignals,
} from "./search-match-signals";

function allFalse(overrides: Partial<SearchMatchSignals> = {}): SearchMatchSignals {
  return {
    factoryNameExact: false,
    factoryNameContains: false,
    subIndustryExact: false,
    productNameExact: false,
    productNameContains: false,
    mainIndustryExact: false,
    factoryDescriptionContains: false,
    productDescriptionContains: false,
    ...overrides,
  };
}

function allFalseAI(overrides: Partial<AIIntentSignals> = {}): AIIntentSignals {
  return {
    aiMainMatch: false,
    aiSubMatch: false,
    productIntentMatch: false,
    ...overrides,
  };
}

describe("computeSearchMatchSignals", () => {
  it("factory name exact match", () => {
    const signals = computeSearchMatchSignals(
      { name: "創普科技股份有限公司" }, "創普科技股份有限公司", [],
    );
    expect(signals.factoryNameExact).toBe(true);
    expect(signals.factoryNameContains).toBe(false); // exact 命中時 contains 不應該也是 true
  });

  it("factory name contains（prefix 也算 contains，本輪不再細拆）", () => {
    const signals = computeSearchMatchSignals(
      { name: "創普科技股份有限公司" }, "創普", [],
    );
    expect(signals.factoryNameExact).toBe(false);
    expect(signals.factoryNameContains).toBe(true);
  });

  it("main industry exact（keyword 完全等於某個 industry 值，不是 substring）", () => {
    const signals = computeSearchMatchSignals(
      { name: "X", industry: ["金屬加工", "電子零件"] }, "金屬加工", [],
    );
    expect(signals.mainIndustryExact).toBe(true);
  });

  it("main industry 不是 exact 時不算命中（substring 不算）", () => {
    const signals = computeSearchMatchSignals(
      { name: "X", industry: ["金屬加工"] }, "金屬", [],
    );
    expect(signals.mainIndustryExact).toBe(false);
  });

  it("subIndustry exact taxonomy match（keyword 對應到的完整值出現在 factory.subIndustry）", () => {
    const signals = computeSearchMatchSignals(
      { name: "X", subIndustry: ["線束 / 線組加工"] }, "線束", [], // 呼叫端沒傳 resolved matches
    );
    expect(signals.subIndustryExact).toBe(false); // 沒有 subIndustryMatches 就不可能命中

    const signals2 = computeSearchMatchSignals(
      { name: "X", subIndustry: ["線束 / 線組加工"] }, "線束", [],
      ["線束 / 線組加工"], // 呼叫端傳入 resolveSubIndustryKeywordMatches("線束") 的結果
    );
    expect(signals2.subIndustryExact).toBe(true);
  });

  it("product name exact / contains 分開判斷", () => {
    const exact = computeSearchMatchSignals(
      { name: "X" }, "油封", [{ name: "油封" }],
    );
    expect(exact.productNameExact).toBe(true);
    expect(exact.productNameContains).toBe(false);

    const contains = computeSearchMatchSignals(
      { name: "X" }, "油封", [{ name: "客製化油封零件" }],
    );
    expect(contains.productNameExact).toBe(false);
    expect(contains.productNameContains).toBe(true);
  });

  it("一間 factory 有多個 product：各 product 各自命中不同 signal，最後用 OR 合併（見對話中「keywordProductMatches」的多 product 合併語意）", () => {
    const signals = computeSearchMatchSignals(
      { name: "X" }, "油封",
      [
        { name: "油封" },                          // product 1：name exact
        { name: "止漏環", description: "適用於油封周邊防漏" }, // product 2：description contains
      ],
    );
    expect(signals.productNameExact).toBe(true);
    expect(signals.productNameContains).toBe(false); // product 1 已經是 exact，不會同時又算 contains
    expect(signals.productDescriptionContains).toBe(true);
  });

  it("product description contains 獨立於 product name", () => {
    const signals = computeSearchMatchSignals(
      { name: "X" }, "塑膠", [{ name: "不銹鋼搬運箱", description: "材質包含塑膠與不銹鋼" }],
    );
    expect(signals.productNameContains).toBe(false);
    expect(signals.productDescriptionContains).toBe(true);
  });

  it("factory description contains", () => {
    const signals = computeSearchMatchSignals(
      { name: "X", description: "專營油封相關零件加工" }, "油封", [],
    );
    expect(signals.factoryDescriptionContains).toBe(true);
  });

  it("normalization：trim / 英文小寫 / 連續空白收斂", () => {
    const signals = computeSearchMatchSignals(
      { name: "ABC   Precision  Co" }, "  abc precision co  ", [],
    );
    expect(signals.factoryNameExact).toBe(true);
  });

  it("完全沒有命中時全部是 false", () => {
    const signals = computeSearchMatchSignals(
      { name: "無關工廠", description: "無關描述", industry: ["食品"] }, "油封", [{ name: "無關產品" }],
    );
    expect(signals).toEqual(allFalse());
  });
});

describe("computeGeneralMatchTier（多重命中取最高 tier，不累加）", () => {
  it("factory name exact → tier 6（即使同時有其他弱訊號也不會被拉低）", () => {
    expect(computeGeneralMatchTier(allFalse({ factoryNameExact: true, productDescriptionContains: true }))).toBe(6);
  });

  it("factory name contains → tier 5", () => {
    expect(computeGeneralMatchTier(allFalse({ factoryNameContains: true }))).toBe(5);
  });

  it("product name exact → tier 4", () => {
    expect(computeGeneralMatchTier(allFalse({ productNameExact: true }))).toBe(4);
  });

  it("subIndustry exact → tier 4（跟 product name exact 同一層）", () => {
    expect(computeGeneralMatchTier(allFalse({ subIndustryExact: true }))).toBe(4);
  });

  it("subIndustry exact + product name contains → 取最高 tier 4，不是累加", () => {
    expect(computeGeneralMatchTier(allFalse({ subIndustryExact: true, productNameContains: true }))).toBe(4);
  });

  it("product name contains → tier 3", () => {
    expect(computeGeneralMatchTier(allFalse({ productNameContains: true }))).toBe(3);
  });

  it("main industry exact → tier 2", () => {
    expect(computeGeneralMatchTier(allFalse({ mainIndustryExact: true }))).toBe(2);
  });

  it("factory description contains → tier 1", () => {
    expect(computeGeneralMatchTier(allFalse({ factoryDescriptionContains: true }))).toBe(1);
  });

  it("product description contains → tier 0", () => {
    expect(computeGeneralMatchTier(allFalse({ productDescriptionContains: true }))).toBe(0);
  });

  it("完全沒有訊號 → tier 0（fallback）", () => {
    expect(computeGeneralMatchTier(allFalse())).toBe(0);
  });
});

describe("computeAIMatchTier（AI mode ranking precision 修正，見對話中三個缺口）", () => {
  it("factory name exact → tier 9，即使同時有 broad AI 訊號也不會被拉低", () => {
    const tier = computeAIMatchTier(
      allFalse({ factoryNameExact: true }),
      allFalseAI({ aiMainMatch: true }),
    );
    expect(tier).toBe(9);
  });

  it("factory name contains → tier 8，高於任何純 semantic 訊號", () => {
    const nameContains = computeAIMatchTier(allFalse({ factoryNameContains: true }), allFalseAI());
    const semanticStrong = computeAIMatchTier(
      allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: true, productIntentMatch: true }),
    );
    expect(nameContains).toBe(8);
    expect(nameContains).toBeGreaterThan(semanticStrong);
  });

  it("factory name exact 缺口修正：忠興模具企業社案例——名稱命中不會被 AI subMatch／synonym／高評分壓過（排序層面由 db.ts 呼叫端的 rating tie-break 另外保證，這裡只驗證 tier 本身）", () => {
    const nameMatch = computeAIMatchTier(allFalse({ factoryNameContains: true }), allFalseAI());
    const aiSubOnly = computeAIMatchTier(
      allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: true, productIntentMatch: true }),
    );
    expect(nameMatch).toBeGreaterThan(aiSubOnly);
  });

  it("product name exact > product description contains（缺口2：name/description 拆開）", () => {
    const nameExact = computeAIMatchTier(allFalse({ productNameExact: true }), allFalseAI());
    const descOnly = computeAIMatchTier(allFalse({ productDescriptionContains: true }), allFalseAI());
    expect(nameExact).toBeGreaterThan(descOnly);
  });

  it("product name contains > product description contains（否定句「不像塑膠」這類 description literal 不再跟真正 product name 命中同強度）", () => {
    const nameContains = computeAIMatchTier(allFalse({ productNameContains: true }), allFalseAI());
    const descOnly = computeAIMatchTier(allFalse({ productDescriptionContains: true }), allFalseAI());
    expect(nameContains).toBeGreaterThan(descOnly);
  });

  it("subIndustry literal exact > aiMainMatch only（literal taxonomy 證據優於純 AI 推導的 main industry 泛化）", () => {
    const subExact = computeAIMatchTier(allFalse({ subIndustryExact: true }), allFalseAI());
    const mainOnly = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true }));
    expect(subExact).toBeGreaterThan(mainOnly);
  });

  it("subIndustry literal exact 不低於 aiMainMatch && aiSubMatch（basicSignals.subIndustryExact 與 aiSubIndustryMatch 是兩件事，見對話中「不要把兩者視為同一件事」）", () => {
    const subExact = computeAIMatchTier(allFalse({ subIndustryExact: true }), allFalseAI());
    const aiTaxonomy = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: true }));
    expect(subExact).toBeGreaterThanOrEqual(aiTaxonomy);
  });

  it("缺口3修正：productIntentMatch=true 但 aiSubMatch=false，仍必須高於純 mainIndustry-only（連接器 id59 案例：有 semantic 商品證據，不該落到跟完全無證據的候選同一 tier）", () => {
    const productIntentNoSub = computeAIMatchTier(
      allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: false, productIntentMatch: true }),
    );
    const mainOnly = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true }));
    expect(productIntentNoSub).toBeGreaterThan(mainOnly);
    expect(productIntentNoSub).toBeGreaterThan(0);
  });

  it("aiMainMatch && aiSubMatch（semantic taxonomy，無商品證據）> aiMainMatch only（broad）", () => {
    const taxonomy = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: true }));
    const mainOnly = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true }));
    expect(taxonomy).toBeGreaterThan(mainOnly);
  });

  it("aiMainMatch && aiSubMatch && productIntentMatch（semantic strong）> 純 productIntentMatch（aiSubMatch=false）", () => {
    const strong = computeAIMatchTier(
      allFalse(), allFalseAI({ aiMainMatch: true, aiSubMatch: true, productIntentMatch: true }),
    );
    const productOnly = computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true, productIntentMatch: true }));
    expect(strong).toBeGreaterThan(productOnly);
  });

  it("完全沒有訊號 → tier 0（fallback，跟 aiMainMatch only 同一層——candidate 集合裡最低分那層）", () => {
    expect(computeAIMatchTier(allFalse(), allFalseAI())).toBe(0);
    expect(computeAIMatchTier(allFalse(), allFalseAI({ aiMainMatch: true }))).toBe(0);
  });

  it("多重命中取最高 tier，不累加（factory name contains 同時有 productDescriptionContains 仍是 tier 8）", () => {
    const tier = computeAIMatchTier(
      allFalse({ factoryNameContains: true, productDescriptionContains: true }),
      allFalseAI(),
    );
    expect(tier).toBe(8);
  });
});
