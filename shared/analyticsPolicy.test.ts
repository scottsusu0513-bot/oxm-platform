import { describe, expect, it } from "vitest";
import { analyticsRiskLabel, analyticsSignalLabel, isExcludedAnalyticsPath } from "./analyticsPolicy";

describe("external analytics policy", () => {
  it.each(["/admin", "/admin/analytics", "/admin?x=1", "/api/health", "/api/health/ready"])("excludes internal route %s", path => {
    expect(isExcludedAnalyticsPath(path)).toBe(true);
  });
  it.each([undefined, "/", "/search", "/factory/1", "/administrator"])("preserves external route %s", path => {
    expect(isExcludedAnalyticsPath(path)).toBe(false);
  });
  it("uses score boundaries without treating UA bots as risk scores", () => {
    expect(analyticsRiskLabel("suspicious", 30)).toBe("低風險");
    expect(analyticsRiskLabel("suspicious", 59)).toBe("低風險");
    expect(analyticsRiskLabel("suspicious", 60)).toBe("中風險");
    expect(analyticsRiskLabel("suspicious", 79)).toBe("中風險");
    expect(analyticsRiskLabel("suspicious", 80)).toBe("高風險");
    expect(analyticsRiskLabel("known_bot", 0)).toContain("UA 命中");
    expect(analyticsSignalLabel("HIGH_NEW_VISITOR_RATE")).toContain("20 個");
    expect(analyticsSignalLabel("FUTURE_SIGNAL")).toBe("FUTURE_SIGNAL");
  });
});
