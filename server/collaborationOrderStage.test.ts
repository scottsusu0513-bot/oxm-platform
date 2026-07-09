import { describe, expect, it } from "vitest";
import {
  COLLABORATION_ORDER_NEXT_STAGE,
  COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD,
  isStageTransitionEarly,
} from "@shared/collaborationOrderStage";

describe("COLLABORATION_ORDER_NEXT_STAGE", () => {
  it("maps each stage to the correct next stage", () => {
    expect(COLLABORATION_ORDER_NEXT_STAGE.awaiting_deposit).toBe("in_production");
    expect(COLLABORATION_ORDER_NEXT_STAGE.in_production).toBe("awaiting_shipment");
    expect(COLLABORATION_ORDER_NEXT_STAGE.awaiting_shipment).toBe("awaiting_final_payment");
  });

  it("has no next stage for awaiting_final_payment (final step uses markCompleted, not advanceStage)", () => {
    expect(COLLABORATION_ORDER_NEXT_STAGE.awaiting_final_payment).toBeUndefined();
  });

  it("has no next stage for completed (cannot advance further)", () => {
    expect(COLLABORATION_ORDER_NEXT_STAGE.completed).toBeUndefined();
  });
});

describe("COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD", () => {
  it("maps each stage to the date field that gates leaving it", () => {
    // 產品確認：等待首款 → 製作中用「原定製作開始日」判斷提早，不是首款到期日
    expect(COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD.awaiting_deposit).toBe("productionStartDate");
    expect(COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD.in_production).toBe("expectedCompletionDate");
    expect(COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD.awaiting_shipment).toBe("expectedShipmentDate");
    expect(COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD.awaiting_final_payment).toBe("finalPaymentDueDate");
  });

  it("does not use depositDueDate as any stage's transition gate (display-only field)", () => {
    const usedFields = Object.values(COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD);
    expect(usedFields).not.toContain("depositDueDate");
  });
});

describe("isStageTransitionEarly", () => {
  it("returns true when today is before the expected date", () => {
    expect(isStageTransitionEarly("2026-07-01", "2026-07-10")).toBe(true);
  });

  it("returns false when today equals the expected date", () => {
    expect(isStageTransitionEarly("2026-07-10", "2026-07-10")).toBe(false);
  });

  it("returns false when today is after the expected date", () => {
    expect(isStageTransitionEarly("2026-07-15", "2026-07-10")).toBe(false);
  });

  it("returns false when there is no expected date for this stage", () => {
    expect(isStageTransitionEarly("2026-07-01", null)).toBe(false);
    expect(isStageTransitionEarly("2026-07-01", undefined)).toBe(false);
  });
});
