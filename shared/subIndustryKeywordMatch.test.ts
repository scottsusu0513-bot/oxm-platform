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
    // 本輪 taxonomy 新增的 9 個值（見對話中「OXM taxonomy 本輪調整」）——
    // 純粹驗證 ATOMIC_TERM_TO_FULL_VALUES 動態衍生自 INDUSTRIES 這件事對新
    // 增值同樣自動生效，不需要為每個新詞另外寫特判。
    ["染整", ["染整 / 後加工"]],
    ["後加工", ["染整 / 後加工"]],
    ["沖壓", ["沖壓 / 金屬成型"]],
    ["金屬成型", ["沖壓 / 金屬成型"]],
    ["表面處理", ["表面處理"]], // 沒有「/」，整串是一個原子詞
    ["射出成型", ["射出成型"]], // 沒有「/」，整串是一個原子詞
    ["擠出成型", ["擠出成型"]],
    ["吹塑成型", ["吹塑成型"]],
    ["瓦楞紙箱", ["瓦楞紙箱 / 紙箱"]],
    ["紙箱", ["瓦楞紙箱 / 紙箱"]],
    ["調理食品", ["調理食品 / 即食食品"]],
    ["即食食品", ["調理食品 / 即食食品"]],
    ["保健食品", ["保健食品 / 機能食品"]],
    ["機能食品", ["保健食品 / 機能食品"]],
    // alias（見 ALIASES 註解：射出/擠出/吹塑是製造業常見製程口語簡稱，跟
    // cnc 同一種情況，本輪新增）——沒有 alias 時裸詞應該解析不到任何值，
    // 因為「射出」單獨不是任何一個原子詞（原子詞是完整的「射出成型」）。
    ["射出", ["射出成型"]], // alias
    ["擠出", ["擠出成型"]], // alias
    ["吹塑", ["吹塑成型"]], // alias
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
