/**
 * server/ai/assessmentAuthority.ts 驗證——純函式，不需要 DB／provider mock。
 * 對應對話中「一」「二」「三」與「九、必測 Authority」CASE 2／CASE 3：presence
 * 判斷必須是型別安全的（undefined 才算「表單沒回答」，false／0／null／空字串
 * ／空陣列都算「已回答」），已回答的 key 一律從背景資料裡剔除。
 */
import { describe, expect, it } from "vitest";
import { buildAuthoritativeReferenceBackground, isAnsweredValue } from "./assessmentAuthority";

describe("isAnsweredValue：presence 判斷", () => {
  it("undefined → 未回答", () => {
    expect(isAnsweredValue(undefined)).toBe(false);
  });
  it("false／0／null／空字串／空陣列 → 都算已回答，不是 falsy 判斷", () => {
    expect(isAnsweredValue(false)).toBe(true);
    expect(isAnsweredValue(0)).toBe(true);
    expect(isAnsweredValue(null)).toBe(true);
    expect(isAnsweredValue("")).toBe(true);
    expect(isAnsweredValue([])).toBe(true);
  });
});

describe("buildAuthoritativeReferenceBackground：CASE 9-2（表單未回答時才保留 handoff 舊值）", () => {
  it("submittedAnswers 完全沒有這個 key（undefined）→ 保留 prefillData 的舊值", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "測試摘要",
      prefillData: { hasPatent: false },
      submittedAnswers: { hasPatent: undefined },
    });
    expect(result.remainingReferenceFacts).toEqual({ hasPatent: false });
    expect(result.supersededKeys).toEqual([]);
  });

  it("submittedAnswers 有值（即使跟 prefillData 一樣）→ 視為已回答，剔除舊值不再送進背景", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "測試摘要",
      prefillData: { hasPatent: false },
      submittedAnswers: { hasPatent: false },
    });
    expect(result.remainingReferenceFacts).toEqual({});
    expect(result.supersededKeys).toEqual(["hasPatent"]);
  });
});

describe("buildAuthoritativeReferenceBackground：CASE 9-1（表單值覆蓋衝突的 handoff 舊值）", () => {
  it("handoff hasPatent=false，表單 hasPatent=true → 舊的 false 不得再出現在背景資料裡", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "測試摘要",
      prefillData: { hasPatent: false },
      submittedAnswers: { hasPatent: true, patentCount: 3 },
    });
    expect(result.remainingReferenceFacts).toEqual({});
    expect(JSON.stringify(result.remainingReferenceFacts)).not.toContain("false");
    expect(result.supersededKeys).toEqual(["hasPatent"]);
  });
});

describe("buildAuthoritativeReferenceBackground：CASE 9-3（boolean false 不得被誤當成 falsy fallback）", () => {
  it("表單某 boolean 明確回答 false → 不得 fallback 到舊 handoff 的 true", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "測試摘要",
      prefillData: { isEnterpriseFirm: true },
      submittedAnswers: { isEnterpriseFirm: false },
    });
    // isEnterpriseFirm 被剔除（表單已回答），殘餘背景完全不含這個 key，
    // 更不會殘留舊的 true 值造成語意衝突。
    expect(result.remainingReferenceFacts).toEqual({});
    expect(result.supersededKeys).toEqual(["isEnterpriseFirm"]);
  });
});

describe("buildAuthoritativeReferenceBackground：混合情境", () => {
  it("多個 key，只有表單沒回答的才保留，其餘各自獨立判斷、互不影響", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "測試摘要",
      prefillData: { hasPatent: false, needType: "erp_adoption", exportMode: "no_export" },
      submittedAnswers: { hasPatent: true, needType: undefined, exportMode: "" },
    });
    // hasPatent：已回答（true）→ 剔除；needType：未回答（undefined）→ 保留；
    // exportMode：已回答（空字串仍算已回答）→ 剔除。
    expect(result.remainingReferenceFacts).toEqual({ needType: "erp_adoption" });
    expect(result.supersededKeys.sort()).toEqual(["exportMode", "hasPatent"]);
  });

  it("handoffSummary 原樣保留，不受任何欄位覆蓋判斷影響", () => {
    const result = buildAuthoritativeReferenceBackground({
      handoffSummary: "使用者主動要求轉交顧問。",
      prefillData: {},
      submittedAnswers: {},
    });
    expect(result.handoffSummary).toBe("使用者主動要求轉交顧問。");
  });
});
