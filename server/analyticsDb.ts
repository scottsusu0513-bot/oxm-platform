/**
 * Analytics 2.0 — DB 層（見對話中「OXM Analytics 2.0」）。獨立於既有
 * server/db.ts（那支檔案已經非常大），沿用它的 `getDb()` 連線，不重寫
 * 連線邏輯。
 *
 * 唯一時間規則：所有跟 DB 比較的時間點都先在 shared/analyticsTz.ts 轉成
 * 明確的 UTC 字面值字串，絕不把 JS `Date` 物件直接傳給 drizzle 的 sql``
 * 參數綁定——見該檔案開頭註解說明的 mysql2 時區重複偏移風險（上一輪 audit
 * 實際踩到的 bug）。
 */
import { randomUUID } from "crypto";
import { and, eq, gte, lte, sql, inArray, desc } from "drizzle-orm";
import { getDb } from "./db";
import { analyticsSessions, analyticsEvents, analyticsSecurityEvents, factories } from "../drizzle/schema";
import { taipeiDateStr, taipeiHour, addDaysToDateStr } from "../shared/analyticsTz";
import {
  parseUserAgent, matchKnownBot, hasAutomationUaSignature, classifyReferrer, extractReferrerHost,
  computeSuspiciousScore, finalizeClassification, normalizePlatform,
  type Platform, type FinalClassification,
} from "./analyticsClassify";
import { hashIp, anonymizeIpPrefix } from "./_core/requestMeta";
import { ALLOWED_PAGE_TYPES } from "../shared/analyticsPageType";

export { ALLOWED_PAGE_TYPES }; // 讓 routers.ts 繼續可以從這裡 import，不用改呼叫端

const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 分鐘無活動視為新 session
const NEW_VISITOR_WINDOW_MS = 5 * 60 * 1000; // 同 IP 5 分鐘內新 visitorId 數
const SEARCH_RATE_WINDOW_MS = 60 * 1000; // 同 IP 1 分鐘內搜尋次數
const REPEATED_QUERY_WINDOW_MS = 60 * 1000; // 同 session 1 分鐘內重複關鍵字

export interface TrackEventInput {
  visitorId: string;
  eventType: "pageview" | "search";
  // pageview 欄位
  pathname?: string;
  queryString?: string;
  pageType?: string;
  factoryId?: number;
  prevPathname?: string;
  isLandingPage?: boolean;
  // search 欄位
  keyword?: string;
  filters?: Record<string, unknown>;
  useAIMode?: boolean;
  resultCount?: number;
  // 只在 session 還沒建立過（這個 visitorId 的第一個 event）時才會用到
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  platform?: string;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

function normalizeKeyword(kw: string | undefined): string | null {
  if (!kw) return null;
  const t = kw.trim().toLowerCase();
  return t.length > 0 ? t.slice(0, 200) : null;
}

/**
 * 找到或建立這個 visitorId 目前有效的 session（30 分鐘無活動視為新
 * session，見對話中「Session：同一 visitorId 在一段連續活動內的一次造訪，
 * 建議 30 分鐘 inactivity 重新建立 session」）。
 *
 * 只有「建立新 session」這條路徑才會做 newVisitorIdsPerIpRecent 這個查詢
 * （同 IP 短時間新 visitorId 數）——延續同一個既有 session 的後續 event
 * 不需要重算這個訊號，避免每次 pageview 都多打一次查詢（見對話中「不要
 * 因為每次 pageview 產生大量附帶 query」）。
 */
async function getOrCreateSession(
  visitorId: string,
  meta: RequestMeta,
  firstEventContext: {
    referrer?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string;
    utmContent?: string; utmTerm?: string; platform?: string;
  },
  nowMs: number,
): Promise<{ id: number; classification: FinalClassification; ipHash: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const ip = meta.ip;
  const ipHash = hashIp(ip);
  const ipPrefix = anonymizeIpPrefix(ip);
  const ua = meta.userAgent ?? "";

  const [existing] = await db.select().from(analyticsSessions)
    .where(eq(analyticsSessions.visitorId, visitorId))
    .orderBy(desc(analyticsSessions.lastEventAt))
    .limit(1);

  const isActive = existing && (nowMs - new Date(existing.lastEventAt).getTime()) < SESSION_INACTIVITY_MS;
  if (isActive) {
    await db.update(analyticsSessions)
      .set({ lastEventAt: new Date(nowMs), eventCount: sql`${analyticsSessions.eventCount} + 1` })
      .where(eq(analyticsSessions.id, existing.id));
    return { id: existing.id, classification: existing.classification as FinalClassification, ipHash: existing.ipHash ?? "" };
  }

  // 新 session：完整跑一次分類（known bot / automation UA / 同 IP 短時間
  // 新 visitorId 數）。
  const botName = matchKnownBot(ua);
  const automationUa = hasAutomationUaSignature(ua);
  const { deviceType, browser, os } = parseUserAgent(ua);
  const platform = normalizePlatform(firstEventContext.platform);

  let newVisitorIdsPerIpRecent = 0;
  if (ipHash) {
    // 用 JS Date 物件直接當 drizzle 參數（不是手動組 UTC 字串字面值）——
    // `analyticsSessions.startedAt` 本身也是由這支程式碼用 JS Date 物件寫入
    // （見下面的 insert，`startedAt: nowDate`），兩邊都走同一條 mysql2 參數
    // 綁定序列化路徑，不管這台機器的 mysql2/MySQL 時區慣例實際是什麼，寫入
    // 和比較都會用同一套換算，結果一定一致。這跟 shared/analyticsTz.ts 開頭
    // 說明的「不要把 JS Date 物件傳給 sql`` 參數」規則不衝突——那條規則是
    // 針對「欄位本身是由 MySQL 自己的 DEFAULT (now()) 或另一支完全不同的
        // 程式碼路徑寫入」的情況（例如舊版 pageViews.createdAt），這裡的欄位
    // 從頭到尾都是這支程式碼自己用 JS Date 寫入，序列化方式必然跟查詢時
    // 一致。
    const windowStart = new Date(nowMs - NEW_VISITOR_WINDOW_MS);
    const [row] = await db.select({ count: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})` })
      .from(analyticsSessions)
      .where(and(eq(analyticsSessions.ipHash, ipHash), gte(analyticsSessions.startedAt, windowStart)));
    newVisitorIdsPerIpRecent = Number(row?.count ?? 0);
  }

  const suspicious = computeSuspiciousScore({
    automationUa,
    newVisitorIdsPerIpRecent,
    searchesPerIpRecent: 0, // 新 session 第一筆 event 還沒有搜尋紀錄
    fixedIntervalPattern: false, // 由批次 anomaly detector 另外判斷，見 detectAnomalies
    mostlySingleEventSessions: false,
    repeatedQueryCount: 0,
    factoryEnumeration: false,
    cloudAsn: false,
  });
  const classification = finalizeClassification(botName, suspicious.level);

  const referrer = firstEventContext.referrer ?? null;
  const sourceClassification = classifyReferrer({ referrer, utmSource: firstEventContext.utmSource, platform });

  const nowDate = new Date(nowMs);
  const [inserted] = await db.insert(analyticsSessions).values({
    sessionKey: randomUUID(),
    visitorId,
    ipHash: ipHash || null,
    ipPrefix: ipPrefix || null,
    userAgent: ua.slice(0, 500),
    deviceType, browser, os, platform,
    referrer: referrer ? referrer.slice(0, 2000) : null,
    referrerHost: extractReferrerHost(referrer),
    utmSource: firstEventContext.utmSource?.slice(0, 255) ?? null,
    utmMedium: firstEventContext.utmMedium?.slice(0, 255) ?? null,
    utmCampaign: firstEventContext.utmCampaign?.slice(0, 255) ?? null,
    utmContent: firstEventContext.utmContent?.slice(0, 255) ?? null,
    utmTerm: firstEventContext.utmTerm?.slice(0, 255) ?? null,
    sourceClassification,
    classification,
    knownBotName: botName,
    suspiciousScore: suspicious.score,
    suspiciousSignals: suspicious.signals,
    eventCount: 1,
    startedAt: nowDate,
    lastEventAt: nowDate,
    date: taipeiDateStr(nowMs),
  }).$returningId();

  return { id: inserted.id, classification, ipHash };
}

/**
 * Analytics ingest 的唯一入口（見 server/routers.ts `analyticsV2.trackEvent`）。
 * 呼叫端已經做過：event schema 驗證、allowed event types、pathname 長度、
 * payload 大小限制、rate limit（見對話中「Analytics API 防灌」）——這裡只
 * 負責分類 + 寫入，任何錯誤都不應該讓呼叫端整個 request 失敗（tracking
 * failure 不可以讓頁面 error，見對話中「效能要求」），由呼叫端包 try/catch。
 */
export async function recordAnalyticsEvent(input: TrackEventInput, meta: RequestMeta): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const nowMs = Date.now();

  const session = await getOrCreateSession(input.visitorId, meta, {
    referrer: input.referrer, utmSource: input.utmSource, utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign, utmContent: input.utmContent, utmTerm: input.utmTerm,
    platform: input.platform,
  }, nowMs);

  let classification = session.classification;
  const keywordNormalized = normalizeKeyword(input.keyword);

  // search event 專屬的即時訊號：同 IP 短時間搜尋次數、同 session 短時間
  // 重複關鍵字——只在真的是 search event 時才查，不影響 pageview 的寫入
  // 路徑效能。
  if (input.eventType === "search") {
    let searchesPerIpRecent = 0;
    if (session.ipHash) {
      // 同上：用 JS Date 物件當參數，跟 analyticsEvents.createdAt 本身的
      // 寫入方式（見下面 insert 的 `createdAt: new Date(nowMs)`）一致。
      const windowStart = new Date(nowMs - SEARCH_RATE_WINDOW_MS);
      const [row] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .innerJoin(analyticsSessions, eq(analyticsEvents.sessionRowId, analyticsSessions.id))
        .where(and(
          eq(analyticsSessions.ipHash, session.ipHash),
          eq(analyticsEvents.eventType, "search"),
          gte(analyticsEvents.createdAt, windowStart),
        ));
      searchesPerIpRecent = Number(row?.count ?? 0);
    }

    let repeatedQueryCount = 0;
    if (keywordNormalized) {
      const windowStart = new Date(nowMs - REPEATED_QUERY_WINDOW_MS);
      const [row] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(and(
          eq(analyticsEvents.sessionRowId, session.id),
          eq(analyticsEvents.keywordNormalized, keywordNormalized),
          gte(analyticsEvents.createdAt, windowStart),
        ));
      repeatedQueryCount = Number(row?.count ?? 0);
    }

    // 只在偵測到「搜尋層級」的可疑訊號時才可能把分類從 human 升級——不會
    // 因此降級（known_bot/既有 suspicious 維持不變或更嚴重）。
    if (classification === "human" && (searchesPerIpRecent > 15 || repeatedQueryCount >= 3)) {
      const suspicious = computeSuspiciousScore({
        automationUa: false, newVisitorIdsPerIpRecent: 0, searchesPerIpRecent,
        fixedIntervalPattern: false, mostlySingleEventSessions: false, repeatedQueryCount,
        factoryEnumeration: false, cloudAsn: false,
      });
      if (suspicious.level !== "human") {
        classification = "suspicious";
        await db.update(analyticsSessions)
          .set({ classification: "suspicious", suspiciousScore: suspicious.score, suspiciousSignals: suspicious.signals })
          .where(eq(analyticsSessions.id, session.id));
      }
    }
  }

  await db.insert(analyticsEvents).values({
    sessionRowId: session.id,
    visitorId: input.visitorId,
    eventType: input.eventType,
    pathname: input.pathname?.slice(0, 500) ?? null,
    queryString: input.queryString?.slice(0, 1000) ?? null,
    pageType: input.pageType ?? null,
    factoryId: input.factoryId ?? null,
    isLandingPage: input.isLandingPage ?? false,
    prevPathname: input.prevPathname?.slice(0, 500) ?? null,
    keyword: input.keyword?.slice(0, 200) ?? null,
    keywordNormalized,
    filtersJson: input.filters ?? null,
    useAIMode: input.useAIMode ?? null,
    resultCount: input.resultCount ?? null,
    classification,
    date: taipeiDateStr(nowMs),
    hour: taipeiHour(nowMs),
    // 明確帶入 JS 算好的時間，不要依賴欄位的 DB-level DEFAULT (now())——見
    // shared/analyticsTz.ts 開頭註解：本機開發用 MySQL 的 NOW() 在這台機器
    // 上實測回傳的是「本機系統時區（Asia/Taipei）wall-clock」，跟這支程式
    // 其餘全部用 JS Date／UTC 字面值比較的慣例不一致，會讓「這個 event 是否
    // 落在某個時間窗內」的比較整個錯開一個時區偏移量。統一由應用層算好、
    // 明確寫入，才能保證跟後續查詢用同一套時間基準。
    createdAt: new Date(nowMs),
  });
}

export async function logSecurityEvent(evt: {
  eventType: string; severity: "info" | "low" | "medium" | "high" | "critical";
  ipHash?: string | null; visitorId?: string | null; sessionRowId?: number | null;
  userAgent?: string | null; path?: string | null; signals?: string[] | null;
  suspiciousScore?: number | null; actionTaken?: string | null; nowMs?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const nowMs = evt.nowMs ?? Date.now();
  await db.insert(analyticsSecurityEvents).values({
    eventType: evt.eventType, severity: evt.severity,
    ipHash: evt.ipHash ?? null, visitorId: evt.visitorId ?? null, sessionRowId: evt.sessionRowId ?? null,
    userAgent: evt.userAgent?.slice(0, 500) ?? null, path: evt.path?.slice(0, 500) ?? null,
    signals: evt.signals ?? null, suspiciousScore: evt.suspiciousScore ?? null, actionTaken: evt.actionTaken ?? null,
    date: taipeiDateStr(nowMs), hour: taipeiHour(nowMs),
    detectedAt: new Date(nowMs), // 見 recordAnalyticsEvent 同樣的說明，不依賴 DB-level DEFAULT (now())
  });
}

// ══════════════════════════ 查詢層 ══════════════════════════

function dateRangeCondition(col: any, startDate: string, endDate: string) {
  return and(gte(col, startDate), lte(col, endDate));
}

export interface KpiSummary {
  visitors: number;
  humanVisitors: number;
  botSuspiciousVisitors: number;
  pageviews: number;
}

/** Dashboard compact card 用的 KPI（見對話中「3.1 第一排 KPI」）。
 * 「訪客」＝ distinct visitorId（human+known_bot+suspicious 全部算），
 * 「真人訪客」＝ classification='human' 的 distinct visitorId，
 * 「Bot／可疑」＝ 訪客 - 真人訪客，
 * 「Pageviews」＝ eventType='pageview' 的 event 總數（不含 search event）。 */
export async function getKpiSummary(startDate: string, endDate: string): Promise<KpiSummary> {
  const db = await getDb();
  if (!db) return { visitors: 0, humanVisitors: 0, botSuspiciousVisitors: 0, pageviews: 0 };

  const [visitorRows] = await db.select({
    total: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})`,
    human: sql<number>`COUNT(DISTINCT CASE WHEN ${analyticsSessions.classification} = 'human' THEN ${analyticsSessions.visitorId} END)`,
  }).from(analyticsSessions).where(dateRangeCondition(analyticsSessions.date, startDate, endDate));

  const [pvRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventType, "pageview"), dateRangeCondition(analyticsEvents.date, startDate, endDate)));

  const visitors = Number(visitorRows?.total ?? 0);
  const humanVisitors = Number(visitorRows?.human ?? 0);
  return {
    visitors,
    humanVisitors,
    botSuspiciousVisitors: visitors - humanVisitors,
    pageviews: Number(pvRow?.count ?? 0),
  };
}

export type ClassificationFilter = "all" | "human" | "bot_suspicious";

/** 流量圖資料（單日 → 每小時 0-23；多日 → 每日），見對話中「四、流量圖」。 */
export async function getTrendSeries(
  startDate: string, endDate: string, classFilter: ClassificationFilter,
): Promise<{ mode: "hourly" | "daily"; buckets: { key: string; visitors: number }[] }> {
  const db = await getDb();
  if (!db) return { mode: "daily", buckets: [] };

  const classCondition = classFilter === "human"
    ? eq(analyticsSessions.classification, "human")
    : classFilter === "bot_suspicious"
      ? sql`${analyticsSessions.classification} != 'human'`
      : sql`1=1`;

  if (startDate === endDate) {
    const hourly = await db.select({
      h: sql<number>`HOUR(${analyticsSessions.startedAt} + INTERVAL 8 HOUR)`,
      count: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})`,
    }).from(analyticsSessions)
      .where(and(eq(analyticsSessions.date, startDate), classCondition))
      .groupBy(sql`HOUR(${analyticsSessions.startedAt} + INTERVAL 8 HOUR)`);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ key: String(h), visitors: 0 }));
    for (const r of hourly) {
      const idx = Number(r.h);
      if (idx >= 0 && idx < 24) buckets[idx].visitors = Number(r.count);
    }
    return { mode: "hourly", buckets };
  }

  const daily = await db.select({
    d: analyticsSessions.date,
    count: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})`,
  }).from(analyticsSessions)
    .where(and(dateRangeCondition(analyticsSessions.date, startDate, endDate), classCondition))
    .groupBy(analyticsSessions.date)
    .orderBy(analyticsSessions.date);

  return { mode: "daily", buckets: daily.map(r => ({ key: r.d, visitors: Number(r.count) })) };
}

export interface SlotDetail {
  visitors: number;
  human: number;
  knownBot: number;
  suspicious: number;
  pageviews: number;
  topSources: { source: string; count: number }[];
  topPaths: { pathname: string; count: number }[];
  topKeywords: { keyword: string; count: number }[];
}

/** 點某個柱子後的 compact detail panel 資料（見對話中「4.1 柱子/資料點可
 * 點擊」）。單日模式傳 hour，多日模式傳 null（整天）。 */
export async function getSlotDetail(date: string, hour: number | null): Promise<SlotDetail> {
  const db = await getDb();
  if (!db) return { visitors: 0, human: 0, knownBot: 0, suspicious: 0, pageviews: 0, topSources: [], topPaths: [], topKeywords: [] };

  const sessionWhere = hour === null
    ? eq(analyticsSessions.date, date)
    : and(eq(analyticsSessions.date, date), sql`HOUR(${analyticsSessions.startedAt} + INTERVAL 8 HOUR) = ${hour}`);

  const [counts] = await db.select({
    visitors: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})`,
    human: sql<number>`COUNT(DISTINCT CASE WHEN ${analyticsSessions.classification}='human' THEN ${analyticsSessions.visitorId} END)`,
    knownBot: sql<number>`COUNT(DISTINCT CASE WHEN ${analyticsSessions.classification}='known_bot' THEN ${analyticsSessions.visitorId} END)`,
    suspicious: sql<number>`COUNT(DISTINCT CASE WHEN ${analyticsSessions.classification}='suspicious' THEN ${analyticsSessions.visitorId} END)`,
  }).from(analyticsSessions).where(sessionWhere);

  const sources = await db.select({
    source: analyticsSessions.sourceClassification,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsSessions).where(sessionWhere)
    .groupBy(analyticsSessions.sourceClassification)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(5);

  const eventWhere = hour === null
    ? eq(analyticsEvents.date, date)
    : and(eq(analyticsEvents.date, date), eq(analyticsEvents.hour, hour));

  const [pvRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(analyticsEvents).where(and(eventWhere, eq(analyticsEvents.eventType, "pageview")));

  const paths = await db.select({
    pathname: analyticsEvents.pathname,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsEvents)
    .where(and(eventWhere, eq(analyticsEvents.eventType, "pageview")))
    .groupBy(analyticsEvents.pathname)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(10);

  const keywords = await db.select({
    keyword: analyticsEvents.keywordNormalized,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsEvents)
    .where(and(eventWhere, eq(analyticsEvents.eventType, "search"), sql`${analyticsEvents.keywordNormalized} IS NOT NULL AND ${analyticsEvents.keywordNormalized} != ''`))
    .groupBy(analyticsEvents.keywordNormalized)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(10);

  return {
    visitors: Number(counts?.visitors ?? 0),
    human: Number(counts?.human ?? 0),
    knownBot: Number(counts?.knownBot ?? 0),
    suspicious: Number(counts?.suspicious ?? 0),
    pageviews: Number(pvRow?.count ?? 0),
    topSources: sources.map(s => ({ source: s.source ?? "unknown", count: Number(s.count) })),
    topPaths: paths.filter(p => p.pathname).map(p => ({ pathname: p.pathname as string, count: Number(p.count) })),
    topKeywords: keywords.filter(k => k.keyword).map(k => ({ keyword: k.keyword as string, count: Number(k.count) })),
  };
}

/** /admin/analytics 完整報表（見對話中「六、建立 /admin/analytics 完整
 * 分析頁」）。一次查完全部維度，呼叫端（tRPC procedure）一次回傳，前端不
 * 需要對每個區塊各自再發一次請求。工廠名稱在這裡 join 一次取得（不
 * N+1），見對話中「不 N+1 查工廠名稱」。 */
/** db 連線異常時的保底空報表——維持跟正常回傳完全相同的形狀（而不是
 * `null`），這樣 tRPC 的推論型別不會讓每個欄位都變成 optional，前端也不
 * 需要為了這個幾乎不會發生的 edge case 到處加 `?.`。 */
function emptyFullReport(kpi: KpiSummary, trend: { mode: "hourly" | "daily"; buckets: { key: string; visitors: number }[] }) {
  return {
    kpi, trend, sessions: 0,
    sources: [] as { source: string; count: number }[],
    referrerHosts: [] as { host: string; count: number }[],
    utmCampaigns: [] as { source: string | null; medium: string | null; campaign: string | null; count: number }[],
    landingPages: [] as { pathname: string; count: number }[],
    topPaths: [] as { pathname: string; count: number }[],
    topFactories: [] as { factoryId: number; factoryName: string; views: number; uniqueVisitors: number; human: number; botSuspicious: number }[],
    topSearches: [] as { keyword: string; count: number; uniqueVisitors: number; avgResults: number | null; aiCount: number; human: number; botSuspicious: number }[],
    devices: [] as { value: string; count: number }[],
    browsers: [] as { value: string; count: number }[],
    oses: [] as { value: string; count: number }[],
    countries: [] as { value: string; count: number }[],
    asns: [] as { value: string; count: number }[],
    anomalies: [] as { id: number; eventType: string; severity: string | null; detectedAt: Date; signals: unknown; suspiciousScore: number | null; actionTaken: string | null; date: string; hour: number | null }[],
  };
}

export async function getFullReport(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return emptyFullReport(
    { visitors: 0, humanVisitors: 0, botSuspiciousVisitors: 0, pageviews: 0 },
    { mode: startDate === endDate ? "hourly" : "daily", buckets: [] },
  );

  const kpi = await getKpiSummary(startDate, endDate);
  const trend = await getTrendSeries(startDate, endDate, "all");

  const sessionRange = dateRangeCondition(analyticsSessions.date, startDate, endDate);
  const eventRange = dateRangeCondition(analyticsEvents.date, startDate, endDate);

  const [sessionCountRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(analyticsSessions).where(sessionRange);

  const sources = await db.select({
    source: analyticsSessions.sourceClassification,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsSessions).where(sessionRange)
    .groupBy(analyticsSessions.sourceClassification).orderBy(desc(sql`COUNT(*)`));

  const referrerHosts = await db.select({
    host: analyticsSessions.referrerHost,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsSessions)
    .where(and(sessionRange, sql`${analyticsSessions.referrerHost} IS NOT NULL`))
    .groupBy(analyticsSessions.referrerHost).orderBy(desc(sql`COUNT(*)`)).limit(20);

  const utmCampaigns = await db.select({
    source: analyticsSessions.utmSource, medium: analyticsSessions.utmMedium, campaign: analyticsSessions.utmCampaign,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsSessions)
    .where(and(sessionRange, sql`${analyticsSessions.utmSource} IS NOT NULL`))
    .groupBy(analyticsSessions.utmSource, analyticsSessions.utmMedium, analyticsSessions.utmCampaign)
    .orderBy(desc(sql`COUNT(*)`)).limit(20);

  const landingPages = await db.select({
    pathname: analyticsEvents.pathname,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsEvents)
    .where(and(eventRange, eq(analyticsEvents.isLandingPage, true)))
    .groupBy(analyticsEvents.pathname).orderBy(desc(sql`COUNT(*)`)).limit(20);

  const topPaths = await db.select({
    pathname: analyticsEvents.pathname,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsEvents)
    .where(and(eventRange, eq(analyticsEvents.eventType, "pageview")))
    .groupBy(analyticsEvents.pathname).orderBy(desc(sql`COUNT(*)`)).limit(30);

  // 熱門工廠頁：只算真正進入 /factory/:id route 的 pageview（不是搜尋結果
  // 卡片曝光——見對話中「不要因為搜尋結果卡片出現就算 factory view」，本
  // 專案本來就沒有任何機制會在使用者點擊前預先發出 pageview event，這裡
  // 直接查 analyticsEvents 就是「真的進過 factory route」的完整集合）。
  const topFactoryRows = await db.select({
    factoryId: analyticsEvents.factoryId,
    views: sql<number>`COUNT(*)`,
    uniqueVisitors: sql<number>`COUNT(DISTINCT ${analyticsEvents.visitorId})`,
    human: sql<number>`COUNT(CASE WHEN ${analyticsEvents.classification}='human' THEN 1 END)`,
    botSuspicious: sql<number>`COUNT(CASE WHEN ${analyticsEvents.classification}!='human' THEN 1 END)`,
  }).from(analyticsEvents)
    .where(and(eventRange, eq(analyticsEvents.pageType, "factory"), sql`${analyticsEvents.factoryId} IS NOT NULL`))
    .groupBy(analyticsEvents.factoryId).orderBy(desc(sql`COUNT(*)`)).limit(20);

  const factoryIds = topFactoryRows.map(r => r.factoryId).filter((v): v is number => v != null);
  const factoryNames = factoryIds.length > 0
    ? await db.select({ id: factories.id, name: factories.name }).from(factories).where(inArray(factories.id, factoryIds))
    : [];
  const nameMap = new Map(factoryNames.map(f => [f.id, f.name]));
  const topFactories = topFactoryRows.map(r => ({
    factoryId: r.factoryId as number,
    factoryName: nameMap.get(r.factoryId as number) ?? "(已下架/找不到)",
    views: Number(r.views), uniqueVisitors: Number(r.uniqueVisitors),
    human: Number(r.human), botSuspicious: Number(r.botSuspicious),
  }));

  const topSearches = await db.select({
    keyword: analyticsEvents.keywordNormalized,
    count: sql<number>`COUNT(*)`,
    uniqueVisitors: sql<number>`COUNT(DISTINCT ${analyticsEvents.visitorId})`,
    avgResults: sql<number>`AVG(${analyticsEvents.resultCount})`,
    aiCount: sql<number>`COUNT(CASE WHEN ${analyticsEvents.useAIMode}=1 THEN 1 END)`,
    human: sql<number>`COUNT(CASE WHEN ${analyticsEvents.classification}='human' THEN 1 END)`,
    botSuspicious: sql<number>`COUNT(CASE WHEN ${analyticsEvents.classification}!='human' THEN 1 END)`,
  }).from(analyticsEvents)
    .where(and(eventRange, eq(analyticsEvents.eventType, "search"), sql`${analyticsEvents.keywordNormalized} IS NOT NULL AND ${analyticsEvents.keywordNormalized} != ''`))
    .groupBy(analyticsEvents.keywordNormalized).orderBy(desc(sql`COUNT(*)`)).limit(30);

  const devices = await db.select({ v: analyticsSessions.deviceType, count: sql<number>`COUNT(*)` })
    .from(analyticsSessions).where(sessionRange).groupBy(analyticsSessions.deviceType);
  const browsers = await db.select({ v: analyticsSessions.browser, count: sql<number>`COUNT(*)` })
    .from(analyticsSessions).where(sessionRange).groupBy(analyticsSessions.browser);
  const oses = await db.select({ v: analyticsSessions.os, count: sql<number>`COUNT(*)` })
    .from(analyticsSessions).where(sessionRange).groupBy(analyticsSessions.os);

  const anomalies = await db.select().from(analyticsSecurityEvents)
    .where(dateRangeCondition(analyticsSecurityEvents.date, startDate, endDate))
    .orderBy(desc(analyticsSecurityEvents.detectedAt)).limit(50);

  return {
    kpi, trend, sessions: Number(sessionCountRow?.count ?? 0),
    sources: sources.map(s => ({ source: s.source ?? "unknown", count: Number(s.count) })),
    referrerHosts: referrerHosts.map(r => ({ host: r.host as string, count: Number(r.count) })),
    utmCampaigns: utmCampaigns.map(u => ({ source: u.source, medium: u.medium, campaign: u.campaign, count: Number(u.count) })),
    landingPages: landingPages.filter(l => l.pathname).map(l => ({ pathname: l.pathname as string, count: Number(l.count) })),
    topPaths: topPaths.filter(p => p.pathname).map(p => ({ pathname: p.pathname as string, count: Number(p.count) })),
    topFactories,
    topSearches: topSearches.map(s => ({
      keyword: s.keyword as string, count: Number(s.count), uniqueVisitors: Number(s.uniqueVisitors),
      avgResults: s.avgResults != null ? Number(s.avgResults) : null,
      aiCount: Number(s.aiCount), human: Number(s.human), botSuspicious: Number(s.botSuspicious),
    })),
    devices: devices.map(d => ({ value: d.v ?? "other", count: Number(d.count) })),
    browsers: browsers.map(b => ({ value: b.v ?? "Other", count: Number(b.count) })),
    oses: oses.map(o => ({ value: o.v ?? "Other", count: Number(o.count) })),
    // 目前沒有 GeoIP 資料來源（見對話中「不使用未確認的付費 GeoIP」），
    // country/region/ASN 先回傳空陣列，前端顯示「尚未提供」而不是假造 0。
    countries: [] as { value: string; count: number }[],
    asns: [] as { value: string; count: number }[],
    anomalies: anomalies.map(a => ({
      id: a.id, eventType: a.eventType, severity: a.severity, detectedAt: a.detectedAt,
      signals: a.signals ?? [], suspiciousScore: a.suspiciousScore, actionTaken: a.actionTaken,
      date: a.date, hour: a.hour,
    })),
  };
}

// ══════════════════════════ 異常偵測 ══════════════════════════

/**
 * 9/23 類型異常偵測（見對話中「三十六、昨天 9/23 類型異常的偵測規則」）。
 * 保守判定：同時符合「新 visitorId 明顯暴增」+「搜尋事件明顯暴增」才判定
 * 為 anomaly，單一訊號（例如只是流量比較大）不足以觸發——見對話中「不要
 * 把流量增加直接等同攻擊」。
 *
 * baseline：同一天前面幾個小時的平均值（同日 baseline，不依賴跨日歷史
 * 資料——Analytics 2.0 才剛起算，還沒有足夠的「前幾週同小時」可比較）。
 */
export async function detectAnomaliesForDate(date: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const hourly = await db.select({
    h: sql<number>`HOUR(${analyticsSessions.startedAt} + INTERVAL 8 HOUR)`,
    newVisitors: sql<number>`COUNT(DISTINCT ${analyticsSessions.visitorId})`,
  }).from(analyticsSessions).where(eq(analyticsSessions.date, date))
    .groupBy(sql`HOUR(${analyticsSessions.startedAt} + INTERVAL 8 HOUR)`);

  const searchHourly = await db.select({
    h: analyticsEvents.hour,
    count: sql<number>`COUNT(*)`,
  }).from(analyticsEvents)
    .where(and(eq(analyticsEvents.date, date), eq(analyticsEvents.eventType, "search")))
    .groupBy(analyticsEvents.hour);

  const visitorByHour = new Map<number, number>(hourly.map(r => [Number(r.h), Number(r.newVisitors)]));
  const searchByHour = new Map<number, number>(searchHourly.map(r => [Number(r.h), Number(r.count)]));

  const visitorValues = Array.from(visitorByHour.values());
  if (visitorValues.length < 3) return; // 資料太少，不做 baseline 比較（保守）
  const avg = visitorValues.reduce((a, b) => a + b, 0) / visitorValues.length;

  for (const [hour, count] of Array.from(visitorByHour)) {
    const searchCount = searchByHour.get(hour) ?? 0;
    // 保守門檻：新訪客數 > baseline 的 3 倍「且」至少有一定絕對量（避免
    // baseline 本身極低時，3 倍門檻太容易觸發）、同時搜尋事件也明顯偏高。
    const visitorSpike = count > Math.max(avg * 3, 20);
    const searchSpike = searchCount > 30;
    if (visitorSpike && searchSpike) {
      const [existing] = await db.select().from(analyticsSecurityEvents)
        .where(and(
          eq(analyticsSecurityEvents.date, date), eq(analyticsSecurityEvents.hour, hour),
          eq(analyticsSecurityEvents.eventType, "NEW_VISITOR_SPIKE"),
        )).limit(1);
      if (existing) continue; // 避免重複寫入同一個時段的同一個 anomaly
      await db.insert(analyticsSecurityEvents).values({
        eventType: "NEW_VISITOR_SPIKE",
        severity: count > avg * 5 ? "high" : "medium",
        signals: ["HIGH_NEW_VISITOR_RATE", "SEARCH_RATE_SPIKE"],
        suspiciousScore: null,
        actionTaken: "marked_suspicious",
        date, hour,
      });
    }
  }
}

/**
 * 目前沒有成熟的排程／背景 job 基礎設施可以定期跑 detectAnomaliesForDate
 * （見對話中「沒有成熟 job 基礎設施就先不要做自動化」的同樣考量）。改成
 * admin 查看 Dashboard／完整報表時「順便」對這個查詢範圍內的每一天即時算
 * 一次——查詢量小（最多 31 天、每天兩個聚合查詢），且 detectAnomaliesForDate
 * 本身已經有 existing-row 檢查，不會重複寫入，多次呼叫是安全的。
 */
export async function ensureAnomaliesDetected(startDate: string, endDate: string): Promise<void> {
  const dates: string[] = [];
  let d = startDate;
  while (d <= endDate && dates.length < 31) {
    dates.push(d);
    d = addDaysToDateStr(d, 1);
  }
  await Promise.all(dates.map(date => detectAnomaliesForDate(date).catch(() => {})));
}

export interface AnomalySummary {
  count: number;
  items: { date: string; hour: number | null; eventType: string; severity: string | null }[];
}

/** Dashboard 的「一行異常指示燈」用（見對話中「五、異常指示」）：只給數量
 * 跟簡要清單，完整訊號／suspiciousScore 等細節留給 /admin/analytics。 */
export async function getAnomalySummary(startDate: string, endDate: string): Promise<AnomalySummary> {
  const db = await getDb();
  if (!db) return { count: 0, items: [] };
  const rows = await db.select({
    date: analyticsSecurityEvents.date, hour: analyticsSecurityEvents.hour,
    eventType: analyticsSecurityEvents.eventType, severity: analyticsSecurityEvents.severity,
  }).from(analyticsSecurityEvents)
    .where(dateRangeCondition(analyticsSecurityEvents.date, startDate, endDate))
    .orderBy(desc(analyticsSecurityEvents.date), desc(analyticsSecurityEvents.hour));
  return { count: rows.length, items: rows };
}
