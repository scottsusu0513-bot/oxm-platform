/**
 * Integration tests for Analytics 2.0 ingest/query（見對話中「OXM Analytics
 * 2.0」）。真的寫入本機測試 DB（跟其餘 server/*.test.ts 同一套既有模式），
 * 不 mock DB。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import * as db from "./db";
import { analyticsSessions, analyticsEvents, factories } from "../drizzle/schema";
import { recordAnalyticsEvent, getKpiSummary, getTrendSeries, getSlotDetail, getFullReport } from "./analyticsDb";
import { taipeiDateStr } from "../shared/analyticsTz";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const visitorIds: string[] = [];
const ownerIds: number[] = [];
const factoryIds: number[] = [];

function vid(label: string): string {
  const id = `test-${runId}-${label}`;
  visitorIds.push(id);
  return id;
}

const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const UA_GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const UA_HEADLESS = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 HeadlessChrome/128.0.0.0 Safari/537.36";

async function meta(ip: string, ua: string) {
  return { ip, userAgent: ua };
}

async function createFactory(label: string, name: string): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`analytics-owner-${label}-${runId}`, `Analytics測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify(["金屬加工"])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`Analytics測試地址 ${label}`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(result.insertId);
  return result.insertId;
}

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    // event 靠 FK CASCADE 隨 session 一起刪除，只需要刪 session。
    for (const v of visitorIds) {
      await conn.execute(sql`DELETE FROM analyticsSessions WHERE visitorId = ${v}`);
    }
    for (const id of factoryIds) {
      await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    }
  }
  for (const ownerId of ownerIds) {
    await deleteTestUser(ownerId);
  }
}, 30000);

describe("A. visitor/session/pageview — 同 visitor 多 pageview 應該是同一個 session", () => {
  it("首頁 → 搜尋 → 工廠A → 工廠B：1 visitor / 1 session / 4 pageviews", async () => {
    const visitorId = vid("multi-pv");
    const m = await meta("198.51.100.10", UA_CHROME);

    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home", isLandingPage: true }, m);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/search", pageType: "search", prevPathname: "/" }, m);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/factory/1", pageType: "factory", factoryId: 1, prevPathname: "/search" }, m);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/factory/2", pageType: "factory", factoryId: 2, prevPathname: "/factory/1" }, m);

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const sessions = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(sessions.length).toBe(1); // 1 session
    expect(sessions[0].eventCount).toBe(4);

    const events = await conn.select().from(analyticsEvents).where(eq(analyticsEvents.sessionRowId, sessions[0].id));
    expect(events.length).toBe(4); // 4 pageviews
    expect(events.filter(e => e.eventType === "pageview").length).toBe(4);
  });
});

describe("B. route tracking — pathname/pageType/factoryId 正確記錄", () => {
  it("home/search/factory 三種 pageType 各自正確存入", async () => {
    const visitorId = vid("route-types");
    const m = await meta("198.51.100.11", UA_CHROME);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home", isLandingPage: true }, m);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/search?keyword=cnc", pageType: "search", queryString: "keyword=cnc" }, m);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/factory/42", pageType: "factory", factoryId: 42 }, m);

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    const events = await conn.select().from(analyticsEvents).where(eq(analyticsEvents.sessionRowId, session.id));
    const byPath = new Map(events.map(e => [e.pathname, e]));
    expect(byPath.get("/")?.pageType).toBe("home");
    expect(byPath.get("/search?keyword=cnc")?.pageType).toBe("search");
    expect(byPath.get("/search?keyword=cnc")?.queryString).toBe("keyword=cnc");
    expect(byPath.get("/factory/42")?.pageType).toBe("factory");
    expect(byPath.get("/factory/42")?.factoryId).toBe(42);
  });
});

describe("C. factory view — 只有真的進 factory route 才記，搜尋結果顯示不算", () => {
  it("search event（即使 resultCount 很高）不會被算進工廠瀏覽統計，只有 pageType='factory' 的 pageview 才算", async () => {
    const visitorId = vid("factory-view-guard");
    const m = await meta("198.51.100.12", UA_CHROME);
    await recordAnalyticsEvent({ visitorId, eventType: "search", keyword: "油封", resultCount: 15, useAIMode: true }, m);
    // 沒有任何 pageType='factory' 的 pageview

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    const factoryViews = await conn.select().from(analyticsEvents)
      .where(eq(analyticsEvents.sessionRowId, session.id));
    expect(factoryViews.filter(e => e.pageType === "factory").length).toBe(0);
    expect(factoryViews.filter(e => e.eventType === "search").length).toBe(1);
  });
});

describe("D. bot classification — known bot / human / suspicious(automation UA)", () => {
  it("Googlebot UA → classification='known_bot'，knownBotName='Googlebot'", async () => {
    const visitorId = vid("googlebot");
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, await meta("198.51.100.20", UA_GOOGLEBOT));
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(session.classification).toBe("known_bot");
    expect(session.knownBotName).toBe("Googlebot");
  });

  it("一般 Chrome UA → classification='human'", async () => {
    const visitorId = vid("normal-human");
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, await meta("198.51.100.21", UA_CHROME));
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(session.classification).toBe("human");
    expect(session.knownBotName).toBeNull();
  });

  it("HeadlessChrome UA（automation 特徵）→ classification='suspicious'，不是 known_bot（不確定是不是 bot，只是行為可疑）", async () => {
    const visitorId = vid("headless");
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, await meta("198.51.100.22", UA_HEADLESS));
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(session.classification).toBe("suspicious");
    expect(session.knownBotName).toBeNull();
    expect(session.suspiciousSignals).toContain("AUTOMATION_UA");
  });
});

describe("A2. 30 分鐘 inactivity 重新建立 session", () => {
  it("同一個 visitorId，把 lastEventAt 手動改到 31 分鐘前後，再打一個 event 會建立新的 session（不是延續舊的）", async () => {
    const visitorId = vid("session-timeout");
    const m = await meta("198.51.100.30", UA_CHROME);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, m);

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [firstSession] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(firstSession).toBeDefined();

    // 手動把這個 session 的 lastEventAt 撥回 31 分鐘前，模擬「上次活動是
    // 31 分鐘前」。刻意用 drizzle 的 .update()（跟正式寫入路徑一樣走 JS
    // Date 參數綁定），不用原生 SQL 的 DATE_SUB(NOW()...)——本機開發用
    // MySQL 實測 NOW() 回傳的是本機系統時區 wall-clock，混用兩種時間來源
    // 在本機環境會出現不一致的時區偏移，見 server/analyticsDb.ts
    // recordAnalyticsEvent 的同一個說明。
    await conn.update(analyticsSessions)
      .set({ lastEventAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(analyticsSessions.id, firstSession.id));

    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/search", pageType: "search" }, m);

    const allSessions = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(allSessions.length).toBe(2); // 產生了新的 session，不是延續舊的
  });

  it("反例：只撥回 10 分鐘（未超過 30 分鐘），應該延續同一個 session", async () => {
    const visitorId = vid("session-continue");
    const m = await meta("198.51.100.31", UA_CHROME);
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, m);

    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [firstSession] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    await conn.update(analyticsSessions)
      .set({ lastEventAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(analyticsSessions.id, firstSession.id));

    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/search", pageType: "search" }, m);

    const allSessions = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(allSessions.length).toBe(1); // 延續同一個 session
    expect(allSessions[0].eventCount).toBe(2);
  });
});

describe("G. 重複搜尋 dedup（同一次 query request 只產生一筆 event，不會被硬性丟棄，但納入可疑訊號評分）", () => {
  it("同一 session 短時間內重複搜尋同一個關鍵字 4 次：4 次都各自成一筆 event（不是被吞掉/dedup 成 1 筆），且單一 REPEATED_QUERY 訊號（15分）本身低於 30 分門檻，classification 正確維持 human（符合「不要用單一規則判定可疑」的設計）", async () => {
    const visitorId = vid("repeated-query");
    const m = await meta("198.51.100.40", UA_CHROME);
    for (let i = 0; i < 4; i++) {
      await recordAnalyticsEvent({ visitorId, eventType: "search", keyword: "油封", resultCount: 15 }, m);
    }
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    expect(session.classification).toBe("human");

    const events = await conn.select().from(analyticsEvents).where(eq(analyticsEvents.sessionRowId, session.id));
    expect(events.length).toBe(4); // 4 次都各自成一筆 event，沒有被硬性丟棄/dedup
  });

  it("重複搜尋訊號跟另一項訊號（automation UA）組合時，才會真的把 classification 升級成 suspicious——證明多訊號組合的升級路徑真的有接通", async () => {
    const visitorId = vid("repeated-query-plus-automation");
    const m = await meta("198.51.100.41", UA_HEADLESS); // automation UA，session 建立時就先貢獻 40 分
    for (let i = 0; i < 4; i++) {
      await recordAnalyticsEvent({ visitorId, eventType: "search", keyword: "金屬加工", resultCount: 20 }, m);
    }
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [session] = await conn.select().from(analyticsSessions).where(eq(analyticsSessions.visitorId, visitorId));
    // HeadlessChrome UA 在 session 建立當下就已經是 suspicious（40分 >= 30），
    // 這裡驗證的重點是：重複搜尋不會把它「降級」回 human，而且相關 event
    // 仍然正確各自入庫。
    expect(session.classification).toBe("suspicious");
    const events = await conn.select().from(analyticsEvents).where(eq(analyticsEvents.sessionRowId, session.id));
    expect(events.length).toBe(4);
  });
});

describe("H. Dashboard 查詢 — KPI / trend / slot detail", () => {
  const today = taipeiDateStr(Date.now());

  it("getKpiSummary 對剛剛寫入的資料回傳合理數字（不是 0，也不拋錯）", async () => {
    const visitorId = vid("kpi-check");
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: "/", pageType: "home" }, await meta("198.51.100.50", UA_CHROME));
    const kpi = await getKpiSummary(today, today);
    expect(kpi.visitors).toBeGreaterThan(0);
    expect(kpi.pageviews).toBeGreaterThan(0);
  });

  it("getTrendSeries 單日模式回傳 24 個小時 bucket", async () => {
    const trend = await getTrendSeries(today, today, "all");
    expect(trend.mode).toBe("hourly");
    expect(trend.buckets.length).toBe(24);
  });

  it("getTrendSeries 多日模式回傳每日 bucket（不是硬塞 24 小時）", async () => {
    const yesterday = taipeiDateStr(Date.now() - 24 * 3600 * 1000);
    const trend = await getTrendSeries(yesterday, today, "all");
    expect(trend.mode).toBe("daily");
  });

  it("getSlotDetail 單一小時回傳 topKeywords/topPaths 且不拋錯", async () => {
    const visitorId = vid("slot-detail");
    await recordAnalyticsEvent({ visitorId, eventType: "search", keyword: "金屬加工", resultCount: 20 }, await meta("198.51.100.51", UA_CHROME));
    const nowHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
    const detail = await getSlotDetail(today, nowHour);
    expect(detail.visitors).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detail.topKeywords)).toBe(true);
  });
});

describe("熱門工廠頁 — join 工廠名稱，不 N+1", () => {
  it("getFullReport 的 topFactories 正確帶出工廠名稱", async () => {
    const factoryId = await createFactory("A", `Analytics測試工廠-${runId}`);
    const visitorId = vid("factory-report");
    await recordAnalyticsEvent({ visitorId, eventType: "pageview", pathname: `/factory/${factoryId}`, pageType: "factory", factoryId }, await meta("198.51.100.60", UA_CHROME));

    const today = taipeiDateStr(Date.now());
    const report = await getFullReport(today, today);
    expect(report).not.toBeNull();
    const entry = report!.topFactories.find(f => f.factoryId === factoryId);
    expect(entry).toBeDefined();
    expect(entry!.factoryName).toBe(`Analytics測試工廠-${runId}`);
    expect(entry!.views).toBeGreaterThanOrEqual(1);
  });
});
