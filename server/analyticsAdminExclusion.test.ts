import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import * as analyticsDb from "./analyticsDb";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  recordPageView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./analyticsDb", async importOriginal => ({
  ...await importOriginal<typeof import("./analyticsDb")>(),
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));

function context(email?: string, role: "admin" | "user" = "user"): TrpcContext {
  return {
    user: email ? { id: 1, openId: "analytics-test-user", email, role } as TrpcContext["user"] : null,
    req: { headers: { "user-agent": "Mozilla/5.0" }, ip: "203.0.113.5" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_WHITELIST_EMAILS", JSON.stringify(["admin@example.test"]));
  vi.stubEnv("ADMIN_WHITELIST_OPEN_IDS", "[]");
  vi.stubEnv("OWNER_OPEN_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("analytics excludes authenticated administrators", () => {
  it.each(["pageview", "search"] as const)("skips admin %s before ingestion, including public pages", async eventType => {
    const caller = appRouter.createCaller(context("admin@example.test"));
    expect(await caller.analyticsV2.trackEvent({ visitorId: "admin-visitor", eventType, pathname: "/search" }))
      .toEqual({ success: true });
    await caller.analytics.record({ visitorId: "admin-visitor" });
    expect(analyticsDb.recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(db.recordPageView).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "user"],
    ["visitor@example.test", "user"],
    ["former-admin@example.test", "admin"],
  ] as const)("continues tracking %s (%s), using whitelist rather than stale role", async (email, role) => {
    const caller = appRouter.createCaller(context(email, role));
    const input = { visitorId: "real-visitor", eventType: "pageview" as const, pathname: "/" };
    await caller.analyticsV2.trackEvent(input);
    await caller.analytics.record({ visitorId: input.visitorId });
    expect(analyticsDb.recordAnalyticsEvent).toHaveBeenCalledWith(input, expect.objectContaining({ userAgent: "Mozilla/5.0" }));
    expect(db.recordPageView).toHaveBeenCalledWith(input.visitorId);
  });
});
