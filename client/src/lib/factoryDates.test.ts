import { describe, expect, it } from "vitest";
import { formatPublicContentUpdatedAt } from "./factoryDates";

describe("formatPublicContentUpdatedAt", () => {
  it("Date 物件格式化為「YYYY 年 M 月 D 日」，不補零", () => {
    expect(formatPublicContentUpdatedAt(new Date(2026, 8, 15))).toBe("2026 年 9 月 15 日");
  });

  it("ISO 字串輸入也能正確格式化", () => {
    expect(formatPublicContentUpdatedAt("2026-01-05T03:00:00.000Z")).toBe("2026 年 1 月 5 日");
  });

  it("不顯示時／分／秒／時區", () => {
    const formatted = formatPublicContentUpdatedAt(new Date(2026, 8, 15, 23, 59, 59));
    expect(formatted).toBe("2026 年 9 月 15 日");
    expect(formatted).not.toMatch(/:/);
  });

  it("不使用相對時間字樣", () => {
    const formatted = formatPublicContentUpdatedAt(new Date());
    expect(formatted).not.toMatch(/前|昨天|今天/);
  });

  it("null / undefined 回傳 null（不會產生壞字串）", () => {
    expect(formatPublicContentUpdatedAt(null)).toBeNull();
    expect(formatPublicContentUpdatedAt(undefined)).toBeNull();
  });

  it("無效日期字串回傳 null，不是 \"Invalid Date\"", () => {
    expect(formatPublicContentUpdatedAt("not-a-date")).toBeNull();
  });

  it("空字串回傳 null", () => {
    expect(formatPublicContentUpdatedAt("")).toBeNull();
  });
});
