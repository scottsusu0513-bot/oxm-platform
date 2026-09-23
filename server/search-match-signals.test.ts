import { describe, expect, it } from "vitest";
import { computeSearchMatchSignals, computeGeneralMatchTier, type SearchMatchSignals } from "./search-match-signals";

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
