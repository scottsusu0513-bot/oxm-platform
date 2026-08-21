// shared/taxId.ts 的純函式測試。
//
// 測試用統編一律用程式碼依標準演算法計算／驗證出來的數字，不使用任何真實
// 公司的統一編號——這裡列的號碼只是「符合／不符合演算法規則」的測試碼，
// 不對應任何實際登記的企業。
import { describe, expect, it } from "vitest";
import { isValidTaiwanTaxId, normalizeTaxId } from "./taxId";

describe("normalizeTaxId", () => {
  it("去除前後空白", () => {
    expect(normalizeTaxId("  12345678  ")).toBe("12345678");
  });

  it("不改變中間內容（不自動轉換全形數字等）", () => {
    expect(normalizeTaxId("1234５678")).toBe("1234５678");
  });
});

describe("isValidTaiwanTaxId", () => {
  it("有效統編（一般情況，第 7 碼非 7）→ true", () => {
    expect(isValidTaiwanTaxId("00000016")).toBe(true);
    expect(isValidTaiwanTaxId("00000022")).toBe(true);
  });

  it("檢查碼錯誤 → false", () => {
    // 00000016 是有效的，改動最後一碼讓總和不再是 10 的倍數
    expect(isValidTaiwanTaxId("00000017")).toBe(false);
  });

  it("不是 8 碼數字 → false", () => {
    expect(isValidTaiwanTaxId("1234567")).toBe(false); // 7 碼
    expect(isValidTaiwanTaxId("123456789")).toBe(false); // 9 碼
  });

  it("非數字（含全形數字、英文字母、符號）→ false", () => {
    expect(isValidTaiwanTaxId("1234５678")).toBe(false); // 全形數字
    expect(isValidTaiwanTaxId("1234abcd")).toBe(false);
    expect(isValidTaiwanTaxId("1234-567")).toBe(false);
  });

  it("空字串 → false", () => {
    expect(isValidTaiwanTaxId("")).toBe(false);
  });

  it("第 7 碼為 7 的特例：一般檢查失敗，但 +1 規則成立時仍視為有效", () => {
    // 00000079：一般 sum % 10 === 0 檢查會失敗，但第 7 碼為 7，
    // (sum + 1) % 10 === 0 成立，依特例規則應視為有效。
    expect(isValidTaiwanTaxId("00000079")).toBe(true);
  });

  it("第 7 碼為 7，但兩種規則都不成立 → false", () => {
    expect(isValidTaiwanTaxId("00000078")).toBe(false);
  });
});
