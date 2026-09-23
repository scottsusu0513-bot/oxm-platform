import { describe, expect, it } from "vitest";
import { resolveSubIndustryKeywordMatches } from "./subIndustryKeywordMatch";

describe("resolveSubIndustryKeywordMatches — table-driven mapping", () => {
  const cases: Array<[string, string[]]> = [
    ["線束", ["線束 / 線組加工"]],
    ["線組加工", ["線束 / 線組加工"]],
    // 「線材」是真實存在的跨產業 taxonomy 衝突：同時是「紡織」底下「織帶 /
    // 線材」與「電子零件」底下「線材 / 電纜」的原子詞——兩者都是合法命中，
    // 依規格「一個原子詞理論上對應多個完整 taxonomy values：使用 OR」，
    // 兩個完整值都要回傳，不能只回傳其中一個。
    ["線材", ["織帶 / 線材", "線材 / 電纜"]],
    ["電纜", ["線材 / 電纜"]],
    ["CNC", ["CNC加工 / 精密加工"]], // alias
    ["CNC加工", ["CNC加工 / 精密加工"]],
    ["精密加工", ["CNC加工 / 精密加工"]],
    ["連接器", ["連接器 / 端子"]],
    ["端子", ["連接器 / 端子"]],
    ["油封", []],
  ];

  it.each(cases)("「%s」→ %j", (input, expected) => {
    expect(resolveSubIndustryKeywordMatches(input)).toEqual(expected);
  });
});

describe("resolveSubIndustryKeywordMatches — 不做 substring/arbitrary 判斷", () => {
  it("「塑膠」不會因為 sub 值「塑膠包裝」包含「塑膠」就誤判命中（塑膠包裝沒有「/」可拆，整串是一個原子詞，不是「塑膠」）", () => {
    expect(resolveSubIndustryKeywordMatches("塑膠")).toEqual([]);
  });

  it("「包裝」同樣不會因為「塑膠包裝」「禮盒 / 特殊包裝」等 sub 值包含「包裝」就誤判（「包裝」本身不是任何一個原子詞）", () => {
    expect(resolveSubIndustryKeywordMatches("包裝")).toEqual([]);
  });

  it("「金屬」不會因為「金屬原料」「金屬加工」等 sub/主產業字串包含「金屬」就誤判（「金屬原料」沒有「/」，是單一原子詞）", () => {
    expect(resolveSubIndustryKeywordMatches("金屬")).toEqual([]);
  });
});

describe("resolveSubIndustryKeywordMatches — edge cases", () => {
  it("空字串／純空白回傳空陣列", () => {
    expect(resolveSubIndustryKeywordMatches("")).toEqual([]);
    expect(resolveSubIndustryKeywordMatches("   ")).toEqual([]);
  });

  it("trim 前後空白後仍能命中", () => {
    expect(resolveSubIndustryKeywordMatches("  線束  ")).toEqual(["線束 / 線組加工"]);
  });

  it("alias 比對不分大小寫（cnc / Cnc / CNC 都命中）", () => {
    expect(resolveSubIndustryKeywordMatches("cnc")).toEqual(["CNC加工 / 精密加工"]);
    expect(resolveSubIndustryKeywordMatches("Cnc")).toEqual(["CNC加工 / 精密加工"]);
    expect(resolveSubIndustryKeywordMatches("CNC")).toEqual(["CNC加工 / 精密加工"]);
  });

  it("完全無法辨識的字串回傳空陣列", () => {
    expect(resolveSubIndustryKeywordMatches("這是一段完全無法辨識的文字")).toEqual([]);
  });
});
