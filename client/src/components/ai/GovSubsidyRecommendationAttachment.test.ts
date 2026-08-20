import { describe, expect, it } from "vitest";
import { GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER } from "./GovSubsidyRecommendationAttachment";

/**
 * Phase 7.1（見對話中「七、不要把 Recommendation 做成「審核結果」」）：UI
 * 文案不得出現符合／不符合／合格／不合格／通過率／評分／資格確認這類字眼，
 * 避免使用者把「AI 初步方向判斷」誤認成正式政府資格審查結果。
 */
const FORBIDDEN_WORDS = ["不符合", "符合", "合格", "不合格", "通過率", "評分", "分數", "資格確認"];

describe("GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER (Phase 7.1 P0-2)", () => {
  it("E: disclaimer 文字存在且非空", () => {
    expect(GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER.length).toBeGreaterThan(0);
  });

  it("disclaimer 不包含任何「審核結果」語意的禁用字眼", () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER).not.toContain(word);
    }
  });

  it("disclaimer 明確傳達「方向判斷」而非「資格確定」", () => {
    expect(GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER).toContain("方向判斷");
    expect(GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER).toContain("顧問確認");
  });
});
