import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { getFullReport, recordAnalyticsEvent } from "./analyticsDb";
import { getDb } from "./db";
vi.mock("./db", () => ({ getDb: vi.fn() }));

const queries: { sql: string; params: unknown[] }[] = [];
beforeEach(() => {
  queries.length = 0;
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
});

describe("analytics report classification", () => {
  it("uses session classification for factory/search counts, preserving original event snapshots", async () => {
    await getFullReport("2026-10-01", "2026-10-10", "all");
    const splitCounts = queries.filter(q => q.sql.includes("COUNT(CASE WHEN"));
    expect(splitCounts).toHaveLength(2);
    for (const q of splitCounts) {
      expect(q.sql).toContain('inner join `analyticsSessions`');
      expect(q.sql).toContain("`analyticsSessions`.`classification`='human'");
      expect(q.sql).not.toContain("`analyticsEvents`.`classification`");
    }
    expect(queries.every(q => q.sql.startsWith("select"))).toBe(true);
  });
  it("filters content events and sources to normal sessions while retaining all quality classes", async () => {
    await getFullReport("2026-10-01", "2026-10-10", "human");
    const content = queries.filter(q => q.sql.includes("from `analyticsEvents`"));
    // KPI pageview count is the unfiltered overview; the four content breakdowns are filtered.
    const filtered = content.filter(q => q.sql.includes("inner join `analyticsSessions`"));
    expect(filtered).toHaveLength(4);
    for (const q of filtered) {
      expect(q.sql).toContain("`analyticsSessions`.`classification` = ?");
      expect(q.params).toContain("human");
    }
    const quality = queries.find(q => q.sql.includes("CASE WHEN") && q.sql.includes("THEN 'high'"));
    expect(quality).toBeDefined();
    expect(quality!.params).not.toContain("human");
  });
  it("skips internal page events before DB/session creation", async () => {
    await recordAnalyticsEvent({ visitorId: "external-test", eventType: "pageview", pathname: "/admin/analytics" }, { ip: "203.0.113.1", userAgent: "Mozilla/5.0" });
    expect(queries).toHaveLength(0);
  });
});
