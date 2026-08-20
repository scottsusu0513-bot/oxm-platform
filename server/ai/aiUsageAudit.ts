import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { factoryAiDailyUsage, aiUsageTurns, aiModelCalls, factories, users } from "../../drizzle/schema";
import { getTaipeiQuotaDate } from "./taipeiTime";
import { AI_FACTORY_DAILY_TURN_LIMIT } from "../../shared/ai/aiQuotaConfig";
import { getPermanentlyFailedConversationsCount } from "./conversationService";

/**
 * Phase 8.2（見對話中「三十二、三十三」）：這個檔案只做兩件事——
 * 1. Counter／turn-count 一致性稽核（auditFactoryDailyCounterIntegrity）。
 * 2. Admin 未來要用的最低限度聚合查詢（getDailyUsageSummary／breakdown 系列）。
 * 完全不查 aiConversations／aiMessages（不碰任何逐字內容），也不是
 * Admin Dashboard UI 本身——這裡只是資料查詢能力，畫面留給 Phase 9。
 *
 * aiModelCalls 本身沒有 quotaDate 欄位（只有 aiUsageTurns／
 * factoryAiDailyUsage 有），只有 createdAt。直接對 createdAt 做 MySQL DATE()
 * 在 Taipei 日期邊界附近會算錯，需要換算成正確的時間範圍 [start, end) 再查。
 *
 * P0 稽核踩到的真實地雷（見對話中「四」）：這裡原本直接抄 server/db.ts 的
 * toSqlUtc() 寫法，假設「把 UTC 時間格式化成字串傳給 SQL 就對」——但實測
 * 這台 DB 的 @@session.time_zone 是 SYSTEM（= Asia/Taipei，不是 UTC！），
 * MySQL 的 TIMESTAMP／DATETIME 欄位沒有時區資訊，NOW() 存進去的是「台灣
 * 當地牆上時間」的字串，跟 UTC 字串直接比較會整整差 8 小時、查到 0 筆。
 * 不能硬編碼假設 DB session 時區一定是 UTC 或一定是 Taipei（換一台 DB
 * server 設定就可能不一樣）——改成執行當下用 TIMESTAMPDIFF(SECOND,
 * UTC_TIMESTAMP(), NOW()) 直接問 DB 自己的 UTC 位移量，再用這個位移量把
 * 「台灣某一天」的真實 UTC 邊界換算成「這個 DB session 實際儲存格式」的
 * naive 字串，不管 DB session 時區設定是什麼都正確。
 */
function toSqlDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function getDbUtcOffsetSeconds(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  if (!db) return 0;
  const [[row]] = (await db.execute(
    sql`SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) as offsetSeconds`
  )) as unknown as [{ offsetSeconds: number }[], unknown];
  return row?.offsetSeconds ?? 0;
}

async function taipeiDayRangeInDbTime(
  db: Awaited<ReturnType<typeof getDb>>,
  quotaDate: string
): Promise<{ start: string; end: string }> {
  const offsetSeconds = await getDbUtcOffsetSeconds(db);
  const startUtc = new Date(`${quotaDate}T00:00:00+08:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const toDbTime = (d: Date) => toSqlDateTime(new Date(d.getTime() + offsetSeconds * 1000));
  return { start: toDbTime(startUtc), end: toDbTime(endUtc) };
}

/**
 * Phase 9.2（見對話中「四十」實測發現的真實 bug）：drizzle-orm 讀
 * timestamp／datetime 欄位時，會把 DB session 時區（這台是 Asia/Taipei，
 * 不是 UTC）存的牆上時間數字直接當成 UTC 貼上 Z——例如真實台灣時間
 * 19:33:40 被讀成 Date 物件 "...19:33:40.000Z"，而不是正確的
 * "...11:33:40.000Z"。raw SQL 聚合（例如 MAX()，用 sql<string> 型別讀）則是
 *完全不轉換、原樣回傳 "YYYY-MM-DD HH:MM:SS" 字串。兩者都不是真正的 UTC；
 * 如果直接序列化給前端、前端又用瀏覽器本地時區（這台剛好也是 Taipei）
 * 顯示，會疊加兩次 +8 小時位移（實測：19:33 台灣時間顯示成隔天 03:33，
 * 已用真實瀏覽器＋DB 資料重現並確認根因）。這個函式統一把 Date 物件或
 * 字串兩種輸入都當成「DB session 本地時間的數字」，用
 * getDbUtcOffsetSeconds() 量到的真實位移量換算回正確的 UTC ISO 字串，
 * 只有這裡（AI 管理 Recent Turns／工廠表 lastUsedAt）需要把時間戳序列化給
 * 前端，才需要這個修正——quota 邏輯本身（reserveAiTurn 等）只用 NOW()／
 * 日期字串比較，不受影響。
 */
function toTrueUtcIso(raw: Date | string, offsetSeconds: number): string {
  const pseudoUtcMs = raw instanceof Date ? raw.getTime() : new Date(`${raw.replace(" ", "T")}Z`).getTime();
  return new Date(pseudoUtcMs - offsetSeconds * 1000).toISOString();
}

export interface FactoryCounterMismatch {
  factoryId: number;
  quotaDate: string;
  counterUsedTurns: number;
  chargedTurnsCount: number;
  mismatch: boolean;
}

/**
 * 逐工廠比對 factoryAiDailyUsage.usedTurns 與
 * COUNT(aiUsageTurns WHERE quotaCharged=true) 是否一致。第一版只回報不一致
 * 清單，不自動修復（見「三十二」：本輪先做 audit capability）。
 */
export async function auditFactoryDailyCounterIntegrity(
  quotaDate: string = getTaipeiQuotaDate()
): Promise<FactoryCounterMismatch[]> {
  const db = await getDb();
  if (!db) return [];

  const counterRows = await db
    .select({ factoryId: factoryAiDailyUsage.factoryId, usedTurns: factoryAiDailyUsage.usedTurns })
    .from(factoryAiDailyUsage)
    .where(eq(factoryAiDailyUsage.quotaDate, quotaDate));

  const chargedRows = await db
    .select({ factoryId: aiUsageTurns.factoryId, cnt: sql<number>`COUNT(*)` })
    .from(aiUsageTurns)
    .where(and(eq(aiUsageTurns.quotaDate, quotaDate), eq(aiUsageTurns.quotaCharged, true)))
    .groupBy(aiUsageTurns.factoryId);

  const counterMap = new Map<number, number>();
  for (const row of counterRows) counterMap.set(row.factoryId, row.usedTurns);

  const chargedMap = new Map<number, number>();
  for (const row of chargedRows) {
    if (row.factoryId != null) chargedMap.set(row.factoryId, Number(row.cnt));
  }

  const factoryIds = new Set<number>(Array.from(counterMap.keys()).concat(Array.from(chargedMap.keys())));
  const results: FactoryCounterMismatch[] = [];
  for (const factoryId of Array.from(factoryIds)) {
    const counterUsedTurns = counterMap.get(factoryId) ?? 0;
    const chargedTurnsCount = chargedMap.get(factoryId) ?? 0;
    results.push({ factoryId, quotaDate, counterUsedTurns, chargedTurnsCount, mismatch: counterUsedTurns !== chargedTurnsCount });
  }
  return results;
}

export interface DailyUsageSummary {
  quotaDate: string;
  totalTurns: number;
  quotaChargedTurns: number;
  bypassTurns: number;
  failedTurns: number;
  /**
   * Phase 9.2（見對話中「九」）：admin 使用量拆兩種，都用 join users.role
   * 判斷「這一輪的操作者是不是 admin」——不是用 quotaCharged=false 直接
   * 當成 admin（那樣會把 provider 呼叫前失敗、被 failAiTurn 退款的一般
   * 工廠 turn 誤算成 admin 用量，兩者是完全不同的事）。
   */
  adminNoFactoryTurns: number;
  adminWithFactoryBypassTurns: number;
  uniqueFactories: number;
  uniqueActors: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelCallFailures: number;
}

const EMPTY_SUMMARY = (quotaDate: string): DailyUsageSummary => ({
  quotaDate, totalTurns: 0, quotaChargedTurns: 0, bypassTurns: 0, failedTurns: 0,
  adminNoFactoryTurns: 0, adminWithFactoryBypassTurns: 0, uniqueFactories: 0, uniqueActors: 0,
  modelCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCallFailures: 0,
});

/** 見對話中「三十三：Admin-ready Aggregate Queries」——今天總覽，不查任何逐字內容。 */
export async function getDailyUsageSummary(quotaDate: string = getTaipeiQuotaDate()): Promise<DailyUsageSummary> {
  const db = await getDb();
  if (!db) return EMPTY_SUMMARY(quotaDate);

  const [turnStats] = await db
    .select({
      totalTurns: sql<number>`COUNT(*)`,
      quotaChargedTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.quotaCharged} = TRUE THEN 1 ELSE 0 END), 0)`,
      bypassTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.quotaCharged} = FALSE THEN 1 ELSE 0 END), 0)`,
      failedTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
      uniqueFactories: sql<number>`COUNT(DISTINCT ${aiUsageTurns.factoryId})`,
      uniqueActors: sql<number>`COUNT(DISTINCT ${aiUsageTurns.actorUserId})`,
    })
    .from(aiUsageTurns)
    .where(eq(aiUsageTurns.quotaDate, quotaDate));

  const [adminStats] = await db
    .select({
      adminNoFactoryTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.factoryId} IS NULL THEN 1 ELSE 0 END), 0)`,
      adminWithFactoryBypassTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.factoryId} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(aiUsageTurns)
    .innerJoin(users, eq(aiUsageTurns.actorUserId, users.id))
    .where(and(eq(aiUsageTurns.quotaDate, quotaDate), eq(users.role, "admin")));

  const { start, end } = await taipeiDayRangeInDbTime(db, quotaDate);
  const [callStats] = await db
    .select({
      modelCalls: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${aiModelCalls.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${aiModelCalls.outputTokens}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${aiModelCalls.totalTokens}), 0)`,
      modelCallFailures: sql<number>`COALESCE(SUM(CASE WHEN ${aiModelCalls.success} = FALSE THEN 1 ELSE 0 END), 0)`,
    })
    .from(aiModelCalls)
    .where(sql`${aiModelCalls.createdAt} >= ${start} AND ${aiModelCalls.createdAt} < ${end}`);

  return {
    quotaDate,
    totalTurns: Number(turnStats?.totalTurns ?? 0),
    quotaChargedTurns: Number(turnStats?.quotaChargedTurns ?? 0),
    bypassTurns: Number(turnStats?.bypassTurns ?? 0),
    failedTurns: Number(turnStats?.failedTurns ?? 0),
    adminNoFactoryTurns: Number(adminStats?.adminNoFactoryTurns ?? 0),
    adminWithFactoryBypassTurns: Number(adminStats?.adminWithFactoryBypassTurns ?? 0),
    uniqueFactories: Number(turnStats?.uniqueFactories ?? 0),
    uniqueActors: Number(turnStats?.uniqueActors ?? 0),
    modelCalls: Number(callStats?.modelCalls ?? 0),
    inputTokens: Number(callStats?.inputTokens ?? 0),
    outputTokens: Number(callStats?.outputTokens ?? 0),
    totalTokens: Number(callStats?.totalTokens ?? 0),
    modelCallFailures: Number(callStats?.modelCallFailures ?? 0),
  };
}

export interface UsageBreakdownRow {
  key: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  failures: number;
}

async function breakdownByColumn(
  quotaDate: string,
  column: typeof aiModelCalls.model | typeof aiModelCalls.layer
): Promise<UsageBreakdownRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { start, end } = await taipeiDayRangeInDbTime(db, quotaDate);
  const rows = await db
    .select({
      key: column,
      modelCalls: sql<number>`COUNT(*)`,
      inputTokens: sql<number>`COALESCE(SUM(${aiModelCalls.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${aiModelCalls.outputTokens}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${aiModelCalls.totalTokens}), 0)`,
      failures: sql<number>`COALESCE(SUM(CASE WHEN ${aiModelCalls.success} = FALSE THEN 1 ELSE 0 END), 0)`,
    })
    .from(aiModelCalls)
    .where(sql`${aiModelCalls.createdAt} >= ${start} AND ${aiModelCalls.createdAt} < ${end}`)
    .groupBy(column);
  return rows.map(r => ({
    key: String(r.key),
    modelCalls: Number(r.modelCalls),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    totalTokens: Number(r.totalTokens),
    failures: Number(r.failures),
  }));
}

export function getDailyUsageBreakdownByModel(quotaDate: string = getTaipeiQuotaDate()): Promise<UsageBreakdownRow[]> {
  return breakdownByColumn(quotaDate, aiModelCalls.model);
}

export function getDailyUsageBreakdownByLayer(quotaDate: string = getTaipeiQuotaDate()): Promise<UsageBreakdownRow[]> {
  return breakdownByColumn(quotaDate, aiModelCalls.layer);
}

export interface FactoryUsageBreakdownRow {
  factoryId: number | null;
  turns: number;
  quotaChargedTurns: number;
}

/** 依工廠拆——用 aiUsageTurns（不是 aiModelCalls），因為「工廠用了多少次」的權威定義是 turn，不是 model call 數。 */
export async function getDailyUsageBreakdownByFactory(quotaDate: string = getTaipeiQuotaDate()): Promise<FactoryUsageBreakdownRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      factoryId: aiUsageTurns.factoryId,
      turns: sql<number>`COUNT(*)`,
      quotaChargedTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.quotaCharged} = TRUE THEN 1 ELSE 0 END), 0)`,
    })
    .from(aiUsageTurns)
    .where(eq(aiUsageTurns.quotaDate, quotaDate))
    .groupBy(aiUsageTurns.factoryId);
  return rows.map(r => ({ factoryId: r.factoryId, turns: Number(r.turns), quotaChargedTurns: Number(r.quotaChargedTurns) }));
}

export interface ActorUsageBreakdownRow {
  actorUserId: number;
  turns: number;
  quotaChargedTurns: number;
}

/** 依實際操作帳號拆——回答「哪個 user 實際送出」，不含任何訊息內容。 */
export async function getDailyUsageBreakdownByActor(quotaDate: string = getTaipeiQuotaDate()): Promise<ActorUsageBreakdownRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      actorUserId: aiUsageTurns.actorUserId,
      turns: sql<number>`COUNT(*)`,
      quotaChargedTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.quotaCharged} = TRUE THEN 1 ELSE 0 END), 0)`,
    })
    .from(aiUsageTurns)
    .where(eq(aiUsageTurns.quotaDate, quotaDate))
    .groupBy(aiUsageTurns.actorUserId);
  return rows.map(r => ({ actorUserId: r.actorUserId, turns: Number(r.turns), quotaChargedTurns: Number(r.quotaChargedTurns) }));
}

export interface ErrorCategoryBreakdownRow {
  errorCategory: string;
  calls: number;
}

/** 見對話中「十七」：只統計失敗且有 errorCategory 的 call，不含任何 raw error message。 */
export async function getDailyUsageBreakdownByErrorCategory(quotaDate: string = getTaipeiQuotaDate()): Promise<ErrorCategoryBreakdownRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { start, end } = await taipeiDayRangeInDbTime(db, quotaDate);
  const rows = await db
    .select({ errorCategory: aiModelCalls.errorCategory, calls: sql<number>`COUNT(*)` })
    .from(aiModelCalls)
    .where(sql`${aiModelCalls.createdAt} >= ${start} AND ${aiModelCalls.createdAt} < ${end} AND ${aiModelCalls.success} = FALSE`)
    .groupBy(aiModelCalls.errorCategory);
  return rows.map(r => ({ errorCategory: r.errorCategory ?? "other", calls: Number(r.calls) }));
}

export interface FactoryUsageRow {
  factoryId: number;
  factoryName: string;
  usedTurns: number;
  limit: number;
  remaining: number;
  actorsCount: number;
  modelCalls: number;
  totalTokens: number;
  lastUsedAt: string | null;
}

/**
 * 見對話中「十：今日實際有使用 AI 的工廠」——只列 usedTurns（quotaCharged
 * 的 turn 數）> 0 的工廠，不列全平台 approved factory。limit 只能來自
 * AI_FACTORY_DAILY_TURN_LIMIT，remaining 一律 server 算，不讓前端自己減。
 * 三個批次查詢（turns 分組／factories 名稱／model calls 分組）避免 N+1，
 * 不管今天有幾間工廠用過，固定是 3 次查詢。
 */
export async function getTodayActiveFactoriesUsage(quotaDate: string = getTaipeiQuotaDate()): Promise<FactoryUsageRow[]> {
  const db = await getDb();
  if (!db) return [];
  const offsetSeconds = await getDbUtcOffsetSeconds(db);

  const turnRows = await db
    .select({
      factoryId: aiUsageTurns.factoryId,
      usedTurns: sql<number>`COALESCE(SUM(CASE WHEN ${aiUsageTurns.quotaCharged} = TRUE THEN 1 ELSE 0 END), 0)`,
      actorsCount: sql<number>`COUNT(DISTINCT ${aiUsageTurns.actorUserId})`,
      lastUsedAt: sql<string>`MAX(${aiUsageTurns.createdAt})`,
    })
    .from(aiUsageTurns)
    .where(and(eq(aiUsageTurns.quotaDate, quotaDate), sql`${aiUsageTurns.factoryId} IS NOT NULL`))
    .groupBy(aiUsageTurns.factoryId);

  // 只列「今天真的有扣過額度」的工廠——factoryId 有出現但 usedTurns=0
  // 代表這間工廠今天只有 admin bypass 或退款失敗的 row，不算「有使用」。
  const activeRows = turnRows.filter(r => Number(r.usedTurns) > 0 && r.factoryId != null);
  if (activeRows.length === 0) return [];

  const factoryIds = activeRows.map(r => r.factoryId as number);

  const [factoryRows, callRows] = await Promise.all([
    db.select({ id: factories.id, name: factories.name }).from(factories).where(inArray(factories.id, factoryIds)),
    db
      .select({
        factoryId: aiModelCalls.factoryId,
        modelCalls: sql<number>`COUNT(*)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiModelCalls.totalTokens}), 0)`,
      })
      .from(aiModelCalls)
      .where(inArray(aiModelCalls.factoryId, factoryIds))
      .groupBy(aiModelCalls.factoryId),
  ]);

  const nameMap = new Map<number, string>(factoryRows.map(f => [f.id, f.name]));
  const callMap = new Map<number, { modelCalls: number; totalTokens: number }>(
    callRows.filter(c => c.factoryId != null).map(c => [c.factoryId as number, { modelCalls: Number(c.modelCalls), totalTokens: Number(c.totalTokens) }])
  );

  const results: FactoryUsageRow[] = activeRows.map(r => {
    const factoryId = r.factoryId as number;
    const usedTurns = Number(r.usedTurns);
    const calls = callMap.get(factoryId) ?? { modelCalls: 0, totalTokens: 0 };
    return {
      factoryId,
      factoryName: nameMap.get(factoryId) ?? `#${factoryId}`,
      usedTurns,
      limit: AI_FACTORY_DAILY_TURN_LIMIT,
      remaining: Math.max(0, AI_FACTORY_DAILY_TURN_LIMIT - usedTurns),
      actorsCount: Number(r.actorsCount),
      modelCalls: calls.modelCalls,
      totalTokens: calls.totalTokens,
      lastUsedAt: r.lastUsedAt ? toTrueUtcIso(r.lastUsedAt, offsetSeconds) : null,
    };
  });

  // 見對話中「十二」：usedTurns DESC，同值再用 totalTokens DESC 當 tie-break，維持 deterministic。
  results.sort((a, b) => b.usedTurns - a.usedTurns || b.totalTokens - a.totalTokens);
  return results;
}

/**
 * Phase 10.2 P1（見對話中「十三、十四、二十六、二十七」）：正常的一輪 AI turn
 * 從 reserveAiTurn 建立 status='started' 到 completeAiTurn／failAiTurn 收尾，
 * 全部在同一次 tRPC request 內同步完成，不應該長時間停留在 started——如果
 * 有，代表 server process 中途死掉、或某次執行真的卡住沒有走到收尾邏輯（見
 * Phase 10.1 稽核「client 端 Retry 允許時 server 端仍在執行前一次」的同一類
 * 風險）。這裡只做「偵測、回報數字」，刻意不做任何自動 fail／退款／刪除
 * （見「不要自動修復」）——避免在還沒徹底確認每一種卡住原因都安全可回收之前
 * 就自動改動 quota／turn 狀態，那本身又是另一個需要被同等小心處理的風險。
 */
const STALE_STARTED_TURN_THRESHOLD_MINUTES = 10;

export interface StaleStartedTurnsResult {
  count: number;
  thresholdMinutes: number;
}

export async function getStaleStartedTurns(
  thresholdMinutes: number = STALE_STARTED_TURN_THRESHOLD_MINUTES
): Promise<StaleStartedTurnsResult> {
  const db = await getDb();
  if (!db) return { count: 0, thresholdMinutes };
  const offsetSeconds = await getDbUtcOffsetSeconds(db);
  const cutoffUtc = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const cutoffDbTime = toSqlDateTime(new Date(cutoffUtc.getTime() + offsetSeconds * 1000));

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(aiUsageTurns)
    .where(and(eq(aiUsageTurns.status, "started"), sql`${aiUsageTurns.createdAt} < ${cutoffDbTime}`));

  return { count: Number(row?.count ?? 0), thresholdMinutes };
}

export interface AiUsageDashboard {
  quotaDate: string;
  summary: DailyUsageSummary;
  factories: FactoryUsageRow[];
  byModel: UsageBreakdownRow[];
  byLayer: UsageBreakdownRow[];
  byErrorCategory: ErrorCategoryBreakdownRow[];
  counterMismatchCount: number;
  staleStartedTurns: StaleStartedTurnsResult;
  /**
   * Phase 11.2（見對話中「二十三、Permanent Failed Visibility」）：收尾摘要
   * 已經達到 MAX_SUMMARY_RETRY_COUNT 重試上限、不再被自動重試撿到，但原文仍
   * 保留的對話數——只是數字，不查任何逐字內容，讓 governance 案件至少不會
   * 完全 invisible。
   */
  permanentlyFailedSummaryCount: number;
}

/**
 * 見對話中「五、六」：合併成一支 query，前端 AI 管理主畫面（KPI／工廠表／
 * Model／Layer／失敗與額度記帳）一次拿齊，不用分 6 次 request。Recent
 * Turns 因為有獨立的分頁狀態，刻意不放進這支（見 getRecentAiUsageTurns）。
 * staleStartedTurns／permanentlyFailedSummaryCount 刻意不跟著 quotaDate
 * 篩選——兩者都是即時健康狀態，不是某一天的歷史統計，跟其他欄位的「某個
 * quotaDate 的資料」語意不同（見「十三」）。
 */
export async function getAiUsageDashboard(quotaDate: string = getTaipeiQuotaDate()): Promise<AiUsageDashboard> {
  const [summary, factoriesUsage, byModel, byLayer, byErrorCategory, integrity, staleStartedTurns, permanentlyFailedSummaryCount] = await Promise.all([
    getDailyUsageSummary(quotaDate),
    getTodayActiveFactoriesUsage(quotaDate),
    getDailyUsageBreakdownByModel(quotaDate),
    getDailyUsageBreakdownByLayer(quotaDate),
    getDailyUsageBreakdownByErrorCategory(quotaDate),
    auditFactoryDailyCounterIntegrity(quotaDate),
    getStaleStartedTurns(),
    getPermanentlyFailedConversationsCount(),
  ]);
  return {
    quotaDate,
    summary,
    factories: factoriesUsage,
    byModel,
    byLayer,
    byErrorCategory,
    counterMismatchCount: integrity.filter(r => r.mismatch).length,
    staleStartedTurns,
    permanentlyFailedSummaryCount,
  };
}

export interface RecentAiUsageTurnRow {
  turnId: number;
  createdAt: string;
  completedAt: string | null;
  factoryId: number | null;
  factoryName: string | null;
  actorUserId: number;
  actorName: string | null;
  intent: string | null;
  resourceTarget: string | null;
  status: string;
  quotaCharged: boolean;
  modelCalls: number;
  totalTokens: number;
}

export interface RecentAiUsageTurnsPage {
  items: RecentAiUsageTurnRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * 見對話中「二十六、二十九」：quotaDate 不帶時是「全部日期最近 N 筆」
 * （活動feed 語意，不是今日限定）；factoryName／actorName／modelCalls／
 * totalTokens 全部批次查詢，不管 pageSize 多少都固定 4 次查詢，不會 N+1。
 * 只回傳 metadata，不含任何 prompt／reply 內容。
 */
export async function getRecentAiUsageTurns(params: {
  quotaDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<RecentAiUsageTurnsPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const db = await getDb();
  if (!db) return { items: [], page, pageSize, total: 0, totalPages: 0 };
  const offsetSeconds = await getDbUtcOffsetSeconds(db);

  const whereClause = params.quotaDate ? eq(aiUsageTurns.quotaDate, params.quotaDate) : undefined;

  const [totalRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(aiUsageTurns)
    .where(whereClause);
  const total = Number(totalRow?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize);
  if (total === 0) return { items: [], page, pageSize, total: 0, totalPages: 0 };

  const turnRows = await db
    .select()
    .from(aiUsageTurns)
    .where(whereClause)
    .orderBy(desc(aiUsageTurns.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const factoryIds = Array.from(new Set(turnRows.map(t => t.factoryId).filter((id): id is number => id != null)));
  const actorIds = Array.from(new Set(turnRows.map(t => t.actorUserId)));
  const turnIds = turnRows.map(t => t.id);

  const [factoryRows, actorRows, callRows] = await Promise.all([
    factoryIds.length > 0
      ? db.select({ id: factories.id, name: factories.name }).from(factories).where(inArray(factories.id, factoryIds))
      : Promise.resolve([] as { id: number; name: string }[]),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds)),
    db
      .select({
        turnId: aiModelCalls.turnId,
        modelCalls: sql<number>`COUNT(*)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiModelCalls.totalTokens}), 0)`,
      })
      .from(aiModelCalls)
      .where(inArray(aiModelCalls.turnId, turnIds))
      .groupBy(aiModelCalls.turnId),
  ]);

  const factoryNameMap = new Map<number, string>(factoryRows.map(f => [f.id, f.name]));
  const actorNameMap = new Map<number, string | null>(actorRows.map(a => [a.id, a.name]));
  const callMap = new Map<number, { modelCalls: number; totalTokens: number }>(
    callRows.filter(c => c.turnId != null).map(c => [c.turnId as number, { modelCalls: Number(c.modelCalls), totalTokens: Number(c.totalTokens) }])
  );

  const items: RecentAiUsageTurnRow[] = turnRows.map(t => {
    const calls = callMap.get(t.id) ?? { modelCalls: 0, totalTokens: 0 };
    return {
      turnId: t.id,
      createdAt: toTrueUtcIso(t.createdAt, offsetSeconds),
      completedAt: t.completedAt ? toTrueUtcIso(t.completedAt, offsetSeconds) : null,
      factoryId: t.factoryId,
      factoryName: t.factoryId != null ? (factoryNameMap.get(t.factoryId) ?? `#${t.factoryId}`) : null,
      actorUserId: t.actorUserId,
      actorName: actorNameMap.get(t.actorUserId) ?? null,
      intent: t.intent,
      resourceTarget: t.resourceTarget,
      status: t.status,
      quotaCharged: !!t.quotaCharged,
      modelCalls: calls.modelCalls,
      totalTokens: calls.totalTokens,
    };
  });

  return { items, page, pageSize, total, totalPages };
}
