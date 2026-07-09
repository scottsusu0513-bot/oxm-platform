/**
 * Pure-function tests for the local date parsing/formatting used by
 * OrderDatePicker, plus the day-boundary logic that feeds react-day-picker's
 * `disabled={{ before: Date }}` matcher. No DOM/component rendering here —
 * this project's vitest environment is "node", not jsdom, so we validate the
 * data OrderDatePicker feeds into the Calendar rather than mounting it.
 */
import { describe, expect, it } from "vitest";
import { parseLocalDate, formatLocalDate } from "@/lib/orderDateChain";

describe("parseLocalDate", () => {
  it("parses YYYY-MM-DD into the correct local year/month/day", () => {
    const d = parseLocalDate("2026-07-01");
    expect(d).toBeDefined();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(6); // 0-indexed: July = 6
    expect(d!.getDate()).toBe(1);
  });

  it("does not shift the date across midnight the way new Date(str) can in some timezones", () => {
    // 若誤用 new Date("2026-07-01") 在 UTC-N 時區可能解析成前一天，這裡確認
    // parseLocalDate 用 Date(year, month-1, day) 建構子，不經過任何 UTC 字串解析
    const d = parseLocalDate("2026-01-01");
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(1);
  });

  it("returns undefined for an empty or invalid string", () => {
    expect(parseLocalDate("")).toBeUndefined();
  });
});

describe("formatLocalDate", () => {
  it("formats a local Date back into YYYY-MM-DD", () => {
    expect(formatLocalDate(new Date(2026, 6, 1))).toBe("2026-07-01");
  });

  it("pads single-digit months and days", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("round-trips through parseLocalDate without drift", () => {
    const original = "2026-12-31";
    const roundTripped = formatLocalDate(parseLocalDate(original)!);
    expect(roundTripped).toBe(original);
  });
});

// react-day-picker 的 `disabled={{ before: Date }}` matcher 語意是「day < before」
// （嚴格早於，不含 before 當天）；這裡直接驗證我們餵進去的日期值在這個語意下
// 邊界正確，不重新測試 react-day-picker 套件本身的行為。
function isBeforeDay(day: Date, before: Date): boolean {
  return day.getTime() < before.getTime();
}

describe("minDate day-boundary (feeds Calendar disabled={{ before }})", () => {
  it("案例 1：minDate=2026-07-01 時，2026-06-30 屬於 disabled（before）", () => {
    const minDate = parseLocalDate("2026-07-01")!;
    const day = parseLocalDate("2026-06-30")!;
    expect(isBeforeDay(day, minDate)).toBe(true);
  });

  it("案例 1：minDate=2026-07-01 時，2026-07-01 當天不屬於 disabled", () => {
    const minDate = parseLocalDate("2026-07-01")!;
    const day = parseLocalDate("2026-07-01")!;
    expect(isBeforeDay(day, minDate)).toBe(false);
  });

  it("案例 1：minDate=2026-07-01 時，2026-07-02 不屬於 disabled", () => {
    const minDate = parseLocalDate("2026-07-01")!;
    const day = parseLocalDate("2026-07-02")!;
    expect(isBeforeDay(day, minDate)).toBe(false);
  });

  it("案例 2：minDate=2026-07-05 時，2026-07-04 屬於 disabled、2026-07-05 不屬於", () => {
    const minDate = parseLocalDate("2026-07-05")!;
    expect(isBeforeDay(parseLocalDate("2026-07-04")!, minDate)).toBe(true);
    expect(isBeforeDay(parseLocalDate("2026-07-05")!, minDate)).toBe(false);
  });
});
