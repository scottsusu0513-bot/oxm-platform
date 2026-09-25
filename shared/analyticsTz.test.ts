import { describe, expect, it } from "vitest";
import {
  ANALYTICS_MIN_DATE, taipeiDateStr, taipeiHour, addDaysToDateStr,
  taipeiDateStartUtcLiteral, taipeiDateEndUtcLiteral, isAnalyticsDateAllowed, clampAnalyticsDateRange,
} from "./analyticsTz";

describe("Asia/Taipei 邊界（對話中特別要求：2026-09-25 00:00 Asia/Taipei = 2026-09-24 16:00 UTC）", () => {
  it("2026-09-24T16:00:00Z 換算成 Asia/Taipei 是 2026-09-25 00:00", () => {
    const epoch = Date.parse("2026-09-24T16:00:00.000Z");
    expect(taipeiDateStr(epoch)).toBe("2026-09-25");
    expect(taipeiHour(epoch)).toBe(0);
  });

  it("2026-09-24T15:59:59Z（差 1 秒）仍是 Asia/Taipei 09-24，不是 09-25", () => {
    const epoch = Date.parse("2026-09-24T15:59:59.000Z");
    expect(taipeiDateStr(epoch)).toBe("2026-09-24");
    expect(taipeiHour(epoch)).toBe(23);
  });

  it("taipeiDateStartUtcLiteral('2026-09-25') 回傳 2026-09-24 16:00:00（UTC 字面值）", () => {
    expect(taipeiDateStartUtcLiteral("2026-09-25")).toBe("2026-09-24 16:00:00");
  });

  it("taipeiDateEndUtcLiteral('2026-09-25') 回傳 2026-09-25 15:59:59（UTC 字面值）", () => {
    expect(taipeiDateEndUtcLiteral("2026-09-25")).toBe("2026-09-25 15:59:59");
  });
});

describe("addDaysToDateStr", () => {
  it("往前一天", () => {
    expect(addDaysToDateStr("2026-09-25", -1)).toBe("2026-09-24");
  });
  it("往後一天", () => {
    expect(addDaysToDateStr("2026-09-25", 1)).toBe("2026-09-26");
  });
  it("往前六天（近 7 天範圍常見用法）", () => {
    expect(addDaysToDateStr("2026-10-01", -6)).toBe("2026-09-25");
  });
});

describe("ANALYTICS_MIN_DATE 常數", () => {
  it("固定是 2026-09-25，不得被任何呼叫端動態往前推", () => {
    expect(ANALYTICS_MIN_DATE).toBe("2026-09-25");
  });
});

describe("isAnalyticsDateAllowed（09/24 以前 disabled、09/25 起 enabled、未來 disabled）", () => {
  const NOW = Date.parse("2026-09-27T04:00:00.000Z"); // = 2026-09-27 12:00 Taipei

  it("2026-09-24（含）以前一律不允許", () => {
    expect(isAnalyticsDateAllowed("2026-09-24", NOW)).toBe(false);
    expect(isAnalyticsDateAllowed("2026-01-01", NOW)).toBe(false);
  });

  it("2026-09-25 起允許", () => {
    expect(isAnalyticsDateAllowed("2026-09-25", NOW)).toBe(true);
  });

  it("今天（Asia/Taipei）允許", () => {
    expect(isAnalyticsDateAllowed("2026-09-27", NOW)).toBe(true);
  });

  it("未來日期不允許", () => {
    expect(isAnalyticsDateAllowed("2026-09-28", NOW)).toBe(false);
  });

  it("格式不合法一律不允許", () => {
    expect(isAnalyticsDateAllowed("2026/09/25", NOW)).toBe(false);
    expect(isAnalyticsDateAllowed("", NOW)).toBe(false);
  });
});

describe("clampAnalyticsDateRange（不可偷偷把不存在日期當 0，必須誠實回報實際查詢範圍）", () => {
  const NOW = Date.parse("2026-09-27T04:00:00.000Z"); // = 2026-09-27 12:00 Taipei

  it("請求範圍完全早於上線日 → clamp 到 [MIN_DATE, MIN_DATE]，wasClamped=true", () => {
    const r = clampAnalyticsDateRange("2026-09-18", "2026-09-24", NOW);
    expect(r.start).toBe("2026-09-25");
    expect(r.end).toBe("2026-09-25");
    expect(r.wasClamped).toBe(true);
  });

  it("跨越上線日的範圍（例如天真的「近 7 天」= 09-21~09-27）→ clamp start 到 09-25，end 不變", () => {
    const r = clampAnalyticsDateRange("2026-09-21", "2026-09-27", NOW);
    expect(r.start).toBe("2026-09-25");
    expect(r.end).toBe("2026-09-27");
    expect(r.wasClamped).toBe(true);
  });

  it("完全落在合法範圍內 → 不變，wasClamped=false", () => {
    const r = clampAnalyticsDateRange("2026-09-25", "2026-09-26", NOW);
    expect(r.start).toBe("2026-09-25");
    expect(r.end).toBe("2026-09-26");
    expect(r.wasClamped).toBe(false);
  });

  it("end 超過今天 → clamp 到今天", () => {
    const r = clampAnalyticsDateRange("2026-09-25", "2026-10-05", NOW);
    expect(r.end).toBe("2026-09-27");
    expect(r.wasClamped).toBe(true);
  });
});
