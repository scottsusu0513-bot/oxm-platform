// shared/taxId.ts 的純函式測試。
//
// 測試用統編一律用程式碼依標準演算法計算／驗證出來的數字，不使用任何真實
// 公司的統一編號——這裡列的號碼只是「符合／不符合演算法規則」的測試碼，
// 不對應任何實際登記的企業。04595252／10458570 是財政部公開的新版檢核
// 範例號碼，同樣只用來驗證演算法，不代表任何實際企業。
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
  it("財政部新版檢核範例（加權總和 % 5 === 0 但 % 10 !== 0）→ true", () => {
    // 04595252：加權總和 35（35 % 5 === 0、35 % 10 === 5）——舊制「% 10」
    // 會誤判為無效，新制「% 5」才正確通過。這正是正式用戶回報的情況。
    expect(isValidTaiwanTaxId("04595252")).toBe(true);
    // 10458570：加權總和 25（第 7 碼為 7，但 25 % 5 === 0，不需要用到 +1 特例）
    expect(isValidTaiwanTaxId("10458570")).toBe(true);
  });

  it("舊制（% 10 === 0）有效的統編在新制下仍然有效", () => {
    // % 10 === 0 必然也 % 5 === 0，放寬規則不會讓任何原本有效的號碼失效。
    expect(isValidTaiwanTaxId("00000016")).toBe(true); // 加權總和 10
    expect(isValidTaiwanTaxId("00000022")).toBe(true); // 加權總和 10
  });

  it("檢查碼錯誤（加權總和不是 5 的倍數）→ false", () => {
    // 00000016 有效（總和 10），改動最後一碼讓總和變 11（11 % 5 === 1）。
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
    expect(isValidTaiwanTaxId("0459 5252")).toBe(false); // 含空白
  });

  it("空字串 → false", () => {
    expect(isValidTaiwanTaxId("")).toBe(false);
  });

  it("第 7 碼為 7 的特例：一般檢查失敗，但 +1 後為 5 的倍數時仍視為有效", () => {
    // 00000079：加權總和 19（19 % 5 === 4），第 7 碼為 7，
    // (19 + 1) % 5 === 0 成立，依特例規則應視為有效。
    expect(isValidTaiwanTaxId("00000079")).toBe(true);
  });

  it("第 7 碼為 7，但一般規則與 +1 特例都不成立 → false", () => {
    // 00000078：加權總和 18，18 % 5 === 3、(18 + 1) % 5 === 4，兩者皆非 0。
    expect(isValidTaiwanTaxId("00000078")).toBe(false);
  });

  it("不因首碼／號段做任何額外限制，只看 checksum（例如 622 開頭）", () => {
    // 新舊版統編格式相同，都是 8 碼數字，沒有「6 開頭不合法」「622 不合法」
    // 或特定號段白名單這種規則。622 開頭的號碼是否有效，完全由 checksum 決定：
    expect(isValidTaiwanTaxId("62200003")).toBe(true);  // 加權總和 15 → 有效
    expect(isValidTaiwanTaxId("62200001")).toBe(false); // 加權總和 13 → 無效
  });
});
