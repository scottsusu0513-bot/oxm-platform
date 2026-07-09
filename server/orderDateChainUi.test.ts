import { describe, expect, it } from "vitest";
import { applyDateChainChange, getMinDateForField, handleOrderDateFieldChange, type OrderDateChainValues } from "@/lib/orderDateChain";

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

describe("handleOrderDateFieldChange (mobile second-layer guard)", () => {
  // 手機瀏覽器／Capacitor 原生日期選擇器不一定會擋掉早於 min 的日期（native <input min>
  // 在部分 iOS/Android picker 上可以被滑過去），所以 onChange 一定要在這裡重新驗證，
  // 不能只依賴瀏覽器的 min 屬性。

  it("案例 1：首款付款日期=2026-07-01 時，製作開始日期選 2026-06-30 必須被拒絕", () => {
    const values: OrderDateChainValues = { ...EMPTY, depositDueDate: "2026-07-01" };
    const result = handleOrderDateFieldChange(values, "productionStartDate", "2026-06-30");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("製作開始日期不得早於首款付款日期");
  });

  it("案例 1：同一天（2026-07-01）允許", () => {
    const values: OrderDateChainValues = { ...EMPTY, depositDueDate: "2026-07-01" };
    const result = handleOrderDateFieldChange(values, "productionStartDate", "2026-07-01");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.productionStartDate).toBe("2026-07-01");
  });

  it("案例 1：晚一天（2026-07-02）允許", () => {
    const values: OrderDateChainValues = { ...EMPTY, depositDueDate: "2026-07-01" };
    const result = handleOrderDateFieldChange(values, "productionStartDate", "2026-07-02");
    expect(result.ok).toBe(true);
  });

  it("案例 2：製作開始日期=2026-07-05 時，預計完成日期選 2026-07-04 必須被拒絕", () => {
    const values: OrderDateChainValues = { ...EMPTY, productionStartDate: "2026-07-05" };
    const result = handleOrderDateFieldChange(values, "expectedCompletionDate", "2026-07-04");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("預計完成日期不得早於製作開始日期");
  });

  it("案例 4：拒絕時不回傳更新後的 state，呼叫端必須維持原本的值（不可留下非法日期）", () => {
    const values: OrderDateChainValues = { ...EMPTY, depositDueDate: "2026-07-01", productionStartDate: "2026-07-03" };
    const result = handleOrderDateFieldChange(values, "productionStartDate", "2026-06-30");
    expect(result.ok).toBe(false);
    // ok=false 分支不含 next，呼叫端理應完全不呼叫 setState，原本的 2026-07-03 保持不變
    expect("next" in result).toBe(false);
  });

  it("合法變更仍會清空後續失效日期（跟 applyDateChainChange 行為一致）", () => {
    const values: OrderDateChainValues = {
      ...EMPTY,
      depositDueDate: "2026-07-01",
      productionStartDate: "2026-07-03",
      expectedCompletionDate: "2026-07-10",
    };
    const result = handleOrderDateFieldChange(values, "depositDueDate", "2026-07-05");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.productionStartDate).toBe("");
      expect(result.next.expectedCompletionDate).toBe("2026-07-10");
      expect(result.clearedFields).toEqual(["productionStartDate"]);
    }
  });
});
