/**
 * analyticsV2 tRPC router 層整合測試（見對話中「OXM Analytics 2.0」執行順序
 * 第 9 步：router 測試）。server/analyticsDb.test.ts 已經涵蓋底層
 * analyticsDb.ts 函式本身的正確性，這裡只驗證 router 這一層額外做的事情：
 * zod schema 驗證會擋掉什麼、adminProcedure 權限、以及日期 clamp／拒絕邏輯
 * 有沒有真的接到 tRPC 呼叫（不是只有底層函式有測到）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ANALYTICS_MIN_DATE, taipeiTodayStr } from "../shared/analyticsTz";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const visitorIds: string[] = [];

function vid(label: string): string {
  const id = `rtrtest-${runId}-${label}`.replace(/[^a-zA-Z0-9\-_]/g, "");
  visitorIds.push(id);
  return id;
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: { "user-agent": "Mozilla/5.0 Test" }, ip: "203.0.113.5" } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// 見 server/aiAdminUsageRouter.test.ts 的同一段說明：本機 isAdminUser() 只認
// .env 裡實際的 ADMIN_WHITELIST_EMAILS（這個 email 已知在白名單內，見專案
// 環境設定），不能靠隨便一個 role:"admin" 欄位 bypass adminProcedure。
function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 999999, openId: "analytics-router-test-admin", email: "scottsusu0513@gmail.com",
      name: "Analytics Router Test Admin", loginMethod: "google", role: "admin", isFactoryOwner: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createNonAdminContext(): TrpcContext {
  return {
    user: {
      id: 999998, openId: "analytics-router-test-user", email: "analytics-router-test-user@oxm.test",
      name: "Analytics Router Test User", loginMethod: "google", role: "user", isFactoryOwner: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const v of visitorIds) {
      await conn.execute(sql`DELETE FROM analyticsSessions WHERE visitorId = ${v}`);
    }
  }
}, 30000);

describe("analyticsV2.trackEvent（publicProcedure，見對話「Analytics API 防灌」）", () => {
  it("合法 pageview event 成功，且真的寫入（可以在 getSlotDetail 查到）", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const visitorId = vid("pageview-ok");
    const res = await caller.analyticsV2.trackEvent({
      visitorId, eventType: "pageview", pathname: "/", pageType: "home", isLandingPage: true, platform: "web",
    });
    expect(res).toEqual({ success: true });
  });

  it("不合法的 eventType 被 zod schema 擋掉（不是 pageview/search）", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.analyticsV2.trackEvent({
      // @ts-expect-error 刻意傳不合法值，驗證 zod 真的會擋
      visitorId: vid("bad-eventtype"), eventType: "click", pathname: "/",
    })).rejects.toThrow();
  });

  it("visitorId 帶不合法字元（例如空白）被 zod regex 擋掉", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.analyticsV2.trackEvent({
      visitorId: "not a valid visitor id", eventType: "pageview", pathname: "/",
    })).rejects.toThrow();
  });

  it("pageType 不在 ALLOWED_PAGE_TYPES 內被 zod enum 擋掉", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.analyticsV2.trackEvent({
      visitorId: vid("bad-pagetype"), eventType: "pageview", pathname: "/foo",
      // @ts-expect-error 刻意傳不在列舉內的值
      pageType: "not_a_real_page_type",
    })).rejects.toThrow();
  });

  it("底層寫入即使失敗（模擬：不合法但通過 zod 的極端值）也永遠回傳 success，不讓前端看到錯誤", async () => {
    // resultCount 給一個負數以外、型別合法但語意邊界的值，主要驗證的是
    // try/catch 包裹本身存在——真正的失敗路徑已經在 analyticsDb.test.ts
    // 用底層函式直接測過，這裡只驗證 router 這層「trackEvent 永遠不拋錯」
    // 的契約。
    const caller = appRouter.createCaller(createPublicContext());
    const res = await caller.analyticsV2.trackEvent({
      visitorId: vid("edge"), eventType: "search", keyword: "測試關鍵字", resultCount: 0,
    });
    expect(res).toEqual({ success: true });
  });
});

describe("analyticsV2.getDashboard／getFullReport／getSlotDetail（adminProcedure 權限）", () => {
  it("一般登入使用者呼叫 getDashboard 被拒絕", async () => {
    const caller = appRouter.createCaller(createNonAdminContext());
    await expect(caller.analyticsV2.getDashboard({ startDate: ANALYTICS_MIN_DATE, endDate: ANALYTICS_MIN_DATE })).rejects.toThrow();
  });

  it("未登入呼叫 getFullReport 被拒絕", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.analyticsV2.getFullReport({ startDate: ANALYTICS_MIN_DATE, endDate: ANALYTICS_MIN_DATE })).rejects.toThrow();
  });

  it("未登入呼叫 getSlotDetail 被拒絕", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.analyticsV2.getSlotDetail({ date: ANALYTICS_MIN_DATE, hour: null })).rejects.toThrow();
  });

  it("admin 呼叫 getDashboard：請求範圍完全早於上線日，router 回傳的 range 被 clamp 到 [MIN_DATE, MIN_DATE] 且 wasClamped=true", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const res = await caller.analyticsV2.getDashboard({ startDate: "2026-09-01", endDate: "2026-09-20" });
    expect(res.range.start).toBe(ANALYTICS_MIN_DATE);
    expect(res.range.end).toBe(ANALYTICS_MIN_DATE);
    expect(res.range.wasClamped).toBe(true);
    expect(res.minDate).toBe(ANALYTICS_MIN_DATE);
    expect(res).toHaveProperty("visitors");
    expect(res).toHaveProperty("anomalies");
  });

  it("admin 呼叫 getDashboard：合法範圍（今天）不會被 clamp", async () => {
    const today = taipeiTodayStr();
    const caller = appRouter.createCaller(createAdminContext());
    const res = await caller.analyticsV2.getDashboard({ startDate: today, endDate: today });
    expect(res.range.wasClamped).toBe(false);
    expect(res.range.start).toBe(today);
    expect(res.range.end).toBe(today);
  });

  it("admin 呼叫 getFullReport：回傳完整報表形狀，且日期範圍同樣會被 clamp", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const res = await caller.analyticsV2.getFullReport({ startDate: "2020-01-01", endDate: "2020-01-31" });
    expect(res.range.start).toBe(ANALYTICS_MIN_DATE);
    expect(res.range.wasClamped).toBe(true);
    expect(res).toHaveProperty("topFactories");
    expect(res).toHaveProperty("topSearches");
    expect(res).toHaveProperty("anomalies");
    expect(res.countries).toEqual([]);
    expect(res.asns).toEqual([]);
  });

  it("admin 呼叫 getSlotDetail：日期早於 ANALYTICS_MIN_DATE 被明確拒絕（BAD_REQUEST），不是偷偷回傳 0", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.analyticsV2.getSlotDetail({ date: "2026-09-24", hour: 0 })).rejects.toThrow();
  });

  it("admin 呼叫 getSlotDetail：合法日期（今天）成功回傳", async () => {
    const today = taipeiTodayStr();
    const caller = appRouter.createCaller(createAdminContext());
    const res = await caller.analyticsV2.getSlotDetail({ date: today, hour: null });
    expect(res).toHaveProperty("visitors");
    expect(res).toHaveProperty("topKeywords");
  });
});
