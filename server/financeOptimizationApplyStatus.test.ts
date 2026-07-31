/**
 * client/src/pages/financeOptimizationApplyStatus.ts 的行為測試。
 *
 * 純函式，直接用真實輸入輸出驗證「多工廠狀態判斷」邏輯本身，取代原本用
 * readFileSync 比對元件原始碼裡迴圈寫法字串的假行為測試。
 */
import { describe, expect, it } from "vitest";
import { resolveAnyFactoryStatus } from "../client/src/pages/financeOptimizationApplyStatus";

describe("resolveAnyFactoryStatus", () => {
  it("沒有任何工廠時回傳 null", () => {
    expect(resolveAnyFactoryStatus(null, undefined)).toBeNull();
    expect(resolveAnyFactoryStatus(undefined, [])).toBeNull();
  });

  it("只有 ownedFactory 時直接回傳它的狀態", () => {
    expect(resolveAnyFactoryStatus({ status: "approved" }, [])).toBe("approved");
    expect(resolveAnyFactoryStatus({ status: "draft" }, undefined)).toBe("draft");
  });

  it("ownedFactory 是 rejected，但共管工廠有 pending 時，優先回傳 pending（不是只看 owner）", () => {
    const result = resolveAnyFactoryStatus(
      { status: "rejected" },
      [{ status: "pending" }],
    );
    expect(result).toBe("pending");
  });

  it("ownedFactory 是 null，共管工廠第一筆是 rejected、第二筆是 pending 時，仍優先回傳 pending（不是只看第一筆共管工廠）", () => {
    const result = resolveAnyFactoryStatus(
      null,
      [{ status: "rejected" }, { status: "pending" }],
    );
    expect(result).toBe("pending");
  });

  it("沒有 pending 時，rejected 優先於其他狀態（draft／unregistered）", () => {
    const result = resolveAnyFactoryStatus(
      { status: "draft" },
      [{ status: "rejected" }],
    );
    expect(result).toBe("rejected");
  });

  it("沒有 pending 也沒有 rejected 時，回傳第一筆的狀態", () => {
    const result = resolveAnyFactoryStatus(
      { status: "draft" },
      [{ status: "draft" }],
    );
    expect(result).toBe("draft");
  });
});
