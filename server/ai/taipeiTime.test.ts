/**
 * Phase 8.1（見對話中「二：Taiwan/Asia-Taipei quota-day」）：getTaipeiQuotaDate
 * 不能用 server UTC 日期或天真的字串切割，這裡驗證真正跨越 UTC 日期邊界、
 * 但在台灣時區已經是隔天的情況（Asia/Taipei 是 UTC+8，沒有 DST）。
 */
import { describe, it, expect } from "vitest";
import { getTaipeiQuotaDate } from "./taipeiTime";

describe("getTaipeiQuotaDate（Phase 8.1 二）", () => {
  it("一般情況：UTC 與台灣同一天時，直接轉換", () => {
    const at = new Date("2026-03-10T04:00:00Z"); // Taipei: 2026-03-10 12:00
    expect(getTaipeiQuotaDate(at)).toBe("2026-03-10");
  });

  it("跨日邊界：UTC 還是前一天，但台灣時間已經是隔天凌晨", () => {
    const at = new Date("2026-03-10T16:30:00Z"); // Taipei: 2026-03-11 00:30
    expect(getTaipeiQuotaDate(at)).toBe("2026-03-11");
  });

  it("跨日邊界：UTC 前一刻仍屬於台灣的前一天", () => {
    const at = new Date("2026-03-10T15:59:59Z"); // Taipei: 2026-03-10 23:59:59
    expect(getTaipeiQuotaDate(at)).toBe("2026-03-10");
  });

  it("跨年邊界：UTC 12/31 深夜，台灣已經是隔年 1/1", () => {
    const at = new Date("2025-12-31T16:05:00Z"); // Taipei: 2026-01-01 00:05
    expect(getTaipeiQuotaDate(at)).toBe("2026-01-01");
  });
});
