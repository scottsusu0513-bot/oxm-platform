import { describe, expect, it } from "vitest";
import { hasAiPrefilledAnyOf } from "./AiHandoffPrefillProvenance";

/**
 * Phase 7.2（見對話中「十二、來源必須是真正 provenance」）：判斷是否顯示
 * 「AI 已帶入」只能吃 confirmedFields 這個 server-authoritative 來源，不能用
 * 「欄位目前有沒有值」判斷——這裡驗證的正是這個邊界。
 */
describe("hasAiPrefilledAnyOf (Phase 7.2 D：Handoff AI Prefill Provenance)", () => {
  it("relevantFieldKeys 裡有任何一個出現在 confirmedFields 時回傳 true", () => {
    const confirmedFields = { needType: { sourceFact: "使用者提到 ERP 系統老舊" } };
    expect(hasAiPrefilledAnyOf(confirmedFields, ["needType"])).toBe(true);
  });

  it("confirmedFields 完全沒有涵蓋這個表單的欄位時回傳 false（即使 confirmedFields 本身非空）", () => {
    const confirmedFields = { someOtherServiceField: { sourceFact: "x" } };
    expect(hasAiPrefilledAnyOf(confirmedFields, ["needType"])).toBe(false);
  });

  it("confirmedFields 是空物件時回傳 false", () => {
    expect(hasAiPrefilledAnyOf({}, ["needType", "servicesWanted"])).toBe(false);
  });

  it("不能用「欄位有值」代替 provenance 判斷：這裡只吃 confirmedFields 的 key 是否存在，不看值的內容", () => {
    // 即使欄位物件存在但 sourceFact 是空字串，仍然代表「AI 確認過這個欄位」
    // 這個 provenance 事實本身，不因為 sourceFact 內容而改變判斷。
    const confirmedFields = { annualRevenue: { sourceFact: "" } };
    expect(hasAiPrefilledAnyOf(confirmedFields, ["annualRevenue"])).toBe(true);
  });
});
