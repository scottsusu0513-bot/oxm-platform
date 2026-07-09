import { describe, expect, it } from "vitest";
import {
  ORDER_DATE_CHAIN_FIELDS,
  validateOrderDateChain,
  type OrderDateChainValues,
} from "@shared/orderDateChain";

function dates(partial: Partial<Record<(typeof ORDER_DATE_CHAIN_FIELDS)[number], string>>): OrderDateChainValues {
  const base: OrderDateChainValues = {
    depositDueDate: undefined,
    productionStartDate: undefined,
    expectedCompletionDate: undefined,
    expectedShipmentDate: undefined,
    finalPaymentDueDate: undefined,
  };
  return { ...base, ...partial };
}

describe("validateOrderDateChain", () => {
  it("allows the same day for consecutive fields", () => {
    const result = validateOrderDateChain(dates({
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-01",
    }));
    expect(result).toBeNull();
  });

  it("rejects the next date being one day earlier", () => {
    const result = validateOrderDateChain(dates({
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-06-30",
    }));
    expect(result).toBe("製作開始日期不得早於首款付款日期");
  });

  it("skips blank/undefined middle fields per existing optional-field rules", () => {
    // productionStartDate 未填，expectedCompletionDate 早於 depositDueDate 之後的下一個
    // 「已填」欄位（depositDueDate）才需要比較，中間空白欄位不參與驗證
    const result = validateOrderDateChain(dates({
      depositDueDate: "2026-07-01",
      expectedCompletionDate: "2026-07-05",
    }));
    expect(result).toBeNull();
  });

  it("still catches a violation across a blank middle field", () => {
    const result = validateOrderDateChain(dates({
      depositDueDate: "2026-07-05",
      expectedCompletionDate: "2026-07-01", // 早於 depositDueDate，即使 productionStartDate 空白
    }));
    expect(result).toBe("預計完成日期不得早於首款付款日期");
  });

  it("validates the full chain across all five fields", () => {
    const valid = validateOrderDateChain(dates({
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-01",
      expectedCompletionDate: "2026-07-10",
      expectedShipmentDate: "2026-07-12",
      finalPaymentDueDate: "2026-07-20",
    }));
    expect(valid).toBeNull();

    const invalid = validateOrderDateChain(dates({
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-01",
      expectedCompletionDate: "2026-07-10",
      expectedShipmentDate: "2026-07-12",
      finalPaymentDueDate: "2026-07-11", // 早於 expectedShipmentDate
    }));
    expect(invalid).toBe("尾款結款日期不得早於預計出貨日期");
  });

  it("returns null when nothing is filled in", () => {
    expect(validateOrderDateChain(dates({}))).toBeNull();
  });
});
