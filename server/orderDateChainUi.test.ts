import { describe, expect, it } from "vitest";
import { applyDateChainChange, getMinDateForField, type OrderDateChainValues } from "@/lib/orderDateChain";

const EMPTY: OrderDateChainValues = {
  depositDueDate: "", productionStartDate: "", expectedCompletionDate: "", expectedShipmentDate: "", finalPaymentDueDate: "",
};

describe("applyDateChainChange", () => {
  it("clears only the invalidated later dates, not everything after", () => {
    // 原資料：depositDueDate=7/1, productionStartDate=7/3, expectedCompletionDate=7/10
    // 將 depositDueDate 改成 7/5 → productionStartDate(7/3) 必須清空，
    // 但 expectedCompletionDate(7/10) 本身仍晚於新的 7/5，不該被清空
    const original: OrderDateChainValues = {
      ...EMPTY,
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-03",
      expectedCompletionDate: "2026-07-10",
    };
    const { next, clearedFields } = applyDateChainChange(original, "depositDueDate", "2026-07-05");
    expect(next.depositDueDate).toBe("2026-07-05");
    expect(next.productionStartDate).toBe("");
    expect(next.expectedCompletionDate).toBe("2026-07-10");
    expect(clearedFields).toEqual(["productionStartDate"]);
  });

  it("does not clear anything when the new date keeps the chain valid", () => {
    const original: OrderDateChainValues = {
      ...EMPTY,
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-05",
    };
    const { next, clearedFields } = applyDateChainChange(original, "depositDueDate", "2026-07-01");
    expect(next.productionStartDate).toBe("2026-07-05");
    expect(clearedFields).toEqual([]);
  });

  it("clears multiple later fields that all become invalid", () => {
    const original: OrderDateChainValues = {
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-02",
      expectedCompletionDate: "2026-07-03",
      expectedShipmentDate: "2026-07-04",
      finalPaymentDueDate: "2026-07-20",
    };
    const { next, clearedFields } = applyDateChainChange(original, "depositDueDate", "2026-07-10");
    expect(clearedFields).toEqual(["productionStartDate", "expectedCompletionDate", "expectedShipmentDate"]);
    expect(next.finalPaymentDueDate).toBe("2026-07-20"); // 仍晚於新日期，保留
  });
});

describe("getMinDateForField", () => {
  it("returns the nearest preceding filled date", () => {
    const values: OrderDateChainValues = {
      ...EMPTY,
      depositDueDate: "2026-07-01",
      productionStartDate: "",
      expectedCompletionDate: "2026-07-05",
    };
    // expectedShipmentDate 往前找：expectedCompletionDate 有值 -> 用它
    expect(getMinDateForField("expectedShipmentDate", values)).toBe("2026-07-05");
    // productionStartDate 往前找：depositDueDate 有值 -> 用它
    expect(getMinDateForField("productionStartDate", values)).toBe("2026-07-01");
  });

  it("returns undefined when nothing precedes it or all preceding fields are blank", () => {
    expect(getMinDateForField("depositDueDate", EMPTY)).toBeUndefined();
    expect(getMinDateForField("finalPaymentDueDate", EMPTY)).toBeUndefined();
  });
});
