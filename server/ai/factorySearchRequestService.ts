import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, getAdminUserIds } from "../db";
import { aiFactorySearchRequests, users, factories, type AiFactorySearchRequest } from "../../drizzle/schema";
import { createPlatformNotifications } from "../notifications";

/**
 * Phase 6A.1／OXM Action Registry + AI Action Planner 整合後：Factory Search
 * 人工協尋（見對話中「這不是顧問Handoff」）。
 *
 * 架構變化（見對話中「OXM Action Registry + AI Action Planner」）：這個檔案
 * 不再自己判斷「要不要」觸發人工協尋——那個語意判斷現在由
 * server/ai/actionPlanner.ts 的 AI Action Planner 負責（見那裡的「不要用任何
 * 固定的數字門檻當作唯一判斷依據」）。這個檔案只保留「Planner 已經決定要
 * request_factory_sourcing／cancel_factory_sourcing 之後，怎麼安全、
 * idempotent、CAS 地把這個決定寫進 DB、怎麼 claim+notify、怎麼 retry」這一整層
 * 執行邏輯——這些全部沿用不變（見「八、保留既有 aiFactorySearchRequests
 * 執行層」）。
 *
 * 設計原則：
 * 1. Core Capabilities（見舊「十三」）預設等於 Phase 6A 既有的 rankingSignals；
 *    Action Planner 也可能依對話語意輸出自己理解的 requestedCapabilities，
 *    chatService.ts 會把兩者合併／以 Planner 輸出優先，細節見那裡的呼叫。
 * 2. Direct Capability Evidence 在 server/db.ts 的 searchFactories
 *    ranking-only 分支計算，只用公開安全欄位，禁止 adminNote/contactStatus/
 *    ownerId/rejectionReason/deletedAt/內部認證證據等。
 * 3. 狀態機的 CAS（compare-and-swap）沿用 server/ai/handoffContextService.ts
 *    claimHandoffForSubmission() 同一種「nullable timestamp / status 當鎖」
 *    設計：UPDATE ... WHERE status = 舊狀態，affectedRows===1 才算贏得轉移。
 */

/** 保留舊名稱給呼叫端當 reason 分類用——現在是 AI 自己標記的分類，不是程式算出來的布林條件（見 actionPlanner.ts）。 */
export type ManualSourcingTriggerReason = "hard_zero" | "capability_gap" | "quantity_gap" | "other";

export interface ManualSourcingResult {
  triggered: boolean;
  reason: ManualSourcingTriggerReason | null;
  requestId: number | null;
}

/** claim 超過這個時間還卡在 notifying，視為前一次 claim 已經死掉，允許 retry 重新搶。 */
const NOTIFICATION_CLAIM_STALE_MS = 5 * 60 * 1000;

function getAffectedRows(result: unknown): number {
  return (result as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0;
}

/**
 * 人類可讀摘要，deterministic 組出來（不是 raw conversation、不是第二次 LLM
 * 輸出）——plannerReason 是 Action Planner 這次判斷的內部理由，附在最後供
 * admin 參考，不是決定要不要建立這筆 request 的依據（那個判斷已經在呼叫端
 * 由 Planner 做完了）。
 */
function buildRequestSummary(params: {
  mainIndustries: string[];
  regions: string[];
  coreCapabilities: string[];
  missingCapabilities: string[];
  candidateCount: number;
  directCapabilityMatchCount: number;
  requestedMatchCount: number | null;
  plannerReason?: string;
}): string {
  const { mainIndustries, regions, coreCapabilities, missingCapabilities, candidateCount, directCapabilityMatchCount, requestedMatchCount, plannerReason } = params;
  const scope = [...regions, ...mainIndustries].join("、") || "未指定地區／產業";
  const parts: string[] = [`尋找${scope}`];
  if (coreCapabilities.length > 0) parts.push(`核心需求為${coreCapabilities.join("／")}`);

  if (candidateCount === 0) {
    parts.push("平台目前無符合硬性條件（地區／產業）的候選工廠");
  } else if (missingCapabilities.length > 0) {
    parts.push(`平台有${candidateCount}家候選，但目前無公開資料可明確確認${missingCapabilities.join("／")}能力`);
  } else {
    parts.push(`平台有${candidateCount}家候選，已明確確認${directCapabilityMatchCount}家符合核心能力`);
  }

  if (requestedMatchCount != null) {
    parts.push(`使用者希望至少有${requestedMatchCount}家可比較（目前已確認${directCapabilityMatchCount}家）`);
  }
  if (plannerReason) parts.push(`AI 判斷：${plannerReason}`);
  return parts.join("；").slice(0, 500);
}

/** 同一 conversation 目前這筆 active（pending）request（見「十」）。 */
export async function getPendingFactorySearchRequestForConversation(conversationId: number): Promise<AiFactorySearchRequest | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiFactorySearchRequests)
    .where(and(eq(aiFactorySearchRequests.conversationId, conversationId), eq(aiFactorySearchRequests.status, "pending")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 唯一對外入口，供 chatService.ts 在 Action Planner 判斷
 * action==="request_factory_sourcing" 之後呼叫。純粹「持久化這個已經做完的
 * 決定」，本身不做任何 trigger 判斷——同一 conversation 有既有 pending 就更新
 * （見「十二」），沒有就新增。
 */
export async function applyFactorySourcingDecision(params: {
  userId: number;
  conversationId: number;
  factoryId: number | null;
  mainIndustries: string[];
  regions: string[];
  coreCapabilities: string[];
  candidateCount: number;
  directCapabilityMatchCount: number;
  missingCapabilities: string[];
  /** Action Planner 已經換算好的絕對家數（含「再多找N家」的換算結果），或既有值、或 null。 */
  requestedMatchCount: number | null;
  plannerReason: string;
}): Promise<{ requestId: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await getPendingFactorySearchRequestForConversation(params.conversationId);
  const requestSummary = buildRequestSummary({
    mainIndustries: params.mainIndustries,
    regions: params.regions,
    coreCapabilities: params.coreCapabilities,
    missingCapabilities: params.missingCapabilities,
    candidateCount: params.candidateCount,
    directCapabilityMatchCount: params.directCapabilityMatchCount,
    requestedMatchCount: params.requestedMatchCount,
    plannerReason: params.plannerReason,
  });
  const hardFiltersJson = { mainIndustries: params.mainIndustries, regions: params.regions };

  if (existing) {
    await db.update(aiFactorySearchRequests)
      .set({
        hardFiltersJson,
        rankingSignalsJson: params.coreCapabilities,
        coreCapabilitiesJson: params.coreCapabilities,
        requestSummary,
        candidateCount: params.candidateCount,
        directCapabilityMatchCount: params.directCapabilityMatchCount,
        requestedMatchCount: params.requestedMatchCount,
      })
      .where(and(eq(aiFactorySearchRequests.id, existing.id), eq(aiFactorySearchRequests.status, "pending")));
    return { requestId: existing.id };
  }

  const [inserted] = await db.insert(aiFactorySearchRequests).values({
    userId: params.userId,
    factoryId: params.factoryId,
    conversationId: params.conversationId,
    status: "pending",
    hardFiltersJson,
    rankingSignalsJson: params.coreCapabilities,
    coreCapabilitiesJson: params.coreCapabilities,
    requestSummary,
    candidateCount: params.candidateCount,
    directCapabilityMatchCount: params.directCapabilityMatchCount,
    requestedMatchCount: params.requestedMatchCount,
  });
  const insertId = (inserted as unknown as { insertId: number }).insertId;
  return { requestId: insertId };
}

/**
 * Bookkeeping，不是 business trigger 判斷（見對話中「Resource≠Action」的
 * 精神延伸）：如果這一輪 Action Planner 判斷不需要 request/cancel（action 是
 * "none" 或 "search_factories"），但這段 conversation 還留著一筆更早的
 * pending request，代表這筆 pending 已經被這次新搜尋結果客觀上超越／取代
 * 了（例如舊版 Phase 6A.1 的 CASE 7：「改高雄」後新搜尋已經有符合核心能力的
 * 候選）——自動收尾，避免 admin 之後收到一筆早就過時的協尋通知。這不是「要
 * 不要人工協尋」的語意判斷，純粹是資料一致性維護，所以維持 deterministic、
 * 不需要 AI 介入。
 */
export async function resolvePendingRequestIfSuperseded(conversationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getPendingFactorySearchRequestForConversation(conversationId);
  if (!existing) return;
  await db.update(aiFactorySearchRequests)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(aiFactorySearchRequests.id, existing.id), eq(aiFactorySearchRequests.status, "pending")));
}

/**
 * 使用者主動表達取消意圖時呼叫（見「二十八」，訊號偵測現在由
 * server/ai/actionPlanner.ts 的 Action Planner 負責，不再是 diagnosis.ts）。
 * userId 一定要跟 request 的 owner 一致才能取消（見必測 CASE 11：User B 不能
 * 取消 User A 的 request）——WHERE 條件同時比對 conversationId + userId +
 * status='pending'，任何一個不符合都是 affectedRows=0，直接回傳 false，不
 * throw、不洩漏「這筆 request 是否存在」的資訊。
 */
export async function cancelFactorySearchRequestForConversation(params: {
  conversationId: number;
  userId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(aiFactorySearchRequests)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(
      eq(aiFactorySearchRequests.conversationId, params.conversationId),
      eq(aiFactorySearchRequests.userId, params.userId),
      eq(aiFactorySearchRequests.status, "pending"),
    ));
  return getAffectedRows(result) === 1;
}

function buildAdminNotificationMessage(request: AiFactorySearchRequest, requesterName: string, factoryName: string | null): string {
  const hardFilters = request.hardFiltersJson as { mainIndustries: string[]; regions: string[] };
  const coreCapabilities = (request.coreCapabilitiesJson as string[]) ?? [];
  const scope = [...hardFilters.regions, ...hardFilters.mainIndustries].join("、") || "未指定";
  const lines = [
    `使用者：${requesterName}`,
    `User ID：${request.userId}`,
    factoryName ? `公司：${factoryName}（Factory ID：${request.factoryId}）` : null,
    "",
    `需求：${scope}`,
    coreCapabilities.length > 0 ? `核心能力：${coreCapabilities.join("、")}` : null,
    "",
    `平台搜尋狀態：`,
    `${scope}候選 ${request.candidateCount} 家`,
    `明確符合核心能力候選 ${request.directCapabilityMatchCount} 家`,
    request.requestedMatchCount != null
      ? `使用者希望：${request.requestedMatchCount} 家（尚缺 ${Math.max(request.requestedMatchCount - request.directCapabilityMatchCount, 0)} 家）`
      : null,
    "",
    `Request ID：#${request.id}`,
    "請協助人工找廠／確認能力。",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

export type NotifyOutcome = "notified" | "failed" | "skipped_cancelled" | "skipped_not_claimable";

/**
 * Atomic claim（CAS，見 handoffContextService.ts claimHandoffForSubmission 的
 * 同一種設計）→ notifyAdmins 等價實作（awaited、真的能感知失敗，不是既有
 * notifyHelper.ts 的 fire-and-forget 版本——這裡需要真實的成功/失敗訊號才能
 * 驅動狀態機與 retry，見對話中「P」）→ 成功轉 notified，失敗轉
 * notification_failed 並記錄錯誤、重試次數。
 *
 * 這個函式對外承諾：同一筆 request 最多真的被 claim 到「notifying」一次
 * （並行呼叫時只有一個會贏），加上底層 createPlatformNotifications 本身的
 * dedupeKey 唯一索引（見 notifications.ts／server/db.ts
 * createCommunityNotificationsBatch），雙重保證同一筆 request 不會通知 admin
 * 兩次。
 */
export async function claimAndNotifyFactorySearchRequest(request: AiFactorySearchRequest): Promise<NotifyOutcome> {
  const db = await getDb();
  if (!db) return "failed";

  const staleThreshold = new Date(Date.now() - NOTIFICATION_CLAIM_STALE_MS);
  const claimResult = await db.update(aiFactorySearchRequests)
    .set({ status: "notifying", notificationClaimedAt: new Date() })
    .where(and(
      eq(aiFactorySearchRequests.id, request.id),
      or(
        inArray(aiFactorySearchRequests.status, ["pending", "notification_failed"]),
        and(eq(aiFactorySearchRequests.status, "notifying"), lt(aiFactorySearchRequests.notificationClaimedAt, staleThreshold)),
      ),
    ));

  if (getAffectedRows(claimResult) !== 1) {
    // 輸掉 CAS：可能同時被 cancel 贏走（見「二十七、Cancel/Notify Race」），
    // 也可能已經是 notified／正被另一個尚未過期的 claim 處理中。
    const [current] = await db.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, request.id)).limit(1);
    if (current?.status === "cancelled") return "skipped_cancelled";
    if (current?.status === "notified") return "notified";
    return "skipped_not_claimable";
  }

  try {
    const [requester] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, request.userId)).limit(1);
    const requesterName = requester?.name || requester?.email || `User#${request.userId}`;

    let factoryName: string | null = null;
    if (request.factoryId) {
      const [f] = await db.select({ name: factories.name }).from(factories).where(eq(factories.id, request.factoryId)).limit(1);
      factoryName = f?.name ?? null;
    }

    const message = buildAdminNotificationMessage(request, requesterName, factoryName);
    const adminIds = await getAdminUserIds();
    await createPlatformNotifications(adminIds.map(uid => ({
      recipientUserId: uid,
      eventType: "ai_factory_search_manual_sourcing",
      eventGroup: "ai_factory_search",
      message,
      actionUrl: null,
      titleSnapshot: "AI 工廠人工協尋需求",
      dedupeKey: `ai_factory_search_request:${request.id}:u${uid}`,
    })));

    await db.update(aiFactorySearchRequests)
      .set({ status: "notified", notifiedAt: new Date() })
      .where(and(eq(aiFactorySearchRequests.id, request.id), eq(aiFactorySearchRequests.status, "notifying")));
    return "notified";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(aiFactorySearchRequests)
      .set({
        status: "notification_failed",
        notificationRetryCount: sql`${aiFactorySearchRequests.notificationRetryCount} + 1`,
        lastNotificationError: message.slice(0, 1000),
      })
      .where(and(eq(aiFactorySearchRequests.id, request.id), eq(aiFactorySearchRequests.status, "notifying")));
    return "failed";
  }
}

/**
 * Conversation finalize 時呼叫（見「二十三」）：如果這筆 conversation 有
 * status='pending' 的 request，嘗試 claim + notify；已經是 cancelled 的不通知。
 * 刻意獨立於 conversationSummary / mergeEnterpriseMemory 的 try/catch 之外
 * （見 server/ai/memory.ts），失敗不能擋住 summary/memory 正常收尾。
 */
export async function finalizeFactorySearchRequestForConversation(conversationId: number): Promise<AiFactorySearchRequest | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiFactorySearchRequests)
    .where(eq(aiFactorySearchRequests.conversationId, conversationId))
    .orderBy(sql`${aiFactorySearchRequests.id} DESC`)
    .limit(1);
  const request = rows[0];
  if (!request) return null;
  if (request.status === "pending") {
    await claimAndNotifyFactorySearchRequest(request);
  }
  const [latest] = await db.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, request.id)).limit(1);
  return latest ?? request;
}

/**
 * Deterministic 組出「這次對話有進行過人工協尋」的極短敘述，供
 * server/ai/memory.ts 併入 Conversation Summary（見「二十九」）——同一段文字
 * 隨後會透過既有 mergeEnterpriseMemory() 進入 Enterprise Memory（見
 * 「三十」），不需要另外維護兩套文字：cancelled 的措辭已經明確排除「結果
 * 未知」這種暗示還在等待的說法，避免「三十一」描述的錯誤殘留狀態。
 */
export function buildFinalizeSummaryClause(request: AiFactorySearchRequest | null): string | null {
  if (!request) return null;
  const hardFilters = request.hardFiltersJson as { mainIndustries: string[]; regions: string[] };
  const scope = [...hardFilters.regions, ...hardFilters.mainIndustries].join("、") || "工廠";
  if (request.status === "cancelled") {
    return `曾詢問${scope}相關工廠，後續表示不需要人工協尋。`;
  }
  return `人工協尋：${scope}；已交由 OXM 協助人工找廠，結果未知。`;
}

/**
 * Local/dev retry job（見「二十五」，本輪不上 production cron）：處理
 * notification_failed，以及 claim 後卡住超過 NOTIFICATION_CLAIM_STALE_MS 還
 * 沒有轉成 notified 的 notifying（例如 process 在 notify 成功但狀態更新前
 * crash）。不重新讀 raw conversation——request 自己已經是完整快照。
 */
export async function retryPendingFactorySearchNotifications(): Promise<{ attempted: number; succeeded: number; stillFailing: number }> {
  const db = await getDb();
  if (!db) return { attempted: 0, succeeded: 0, stillFailing: 0 };
  const staleThreshold = new Date(Date.now() - NOTIFICATION_CLAIM_STALE_MS);
  const rows = await db.select().from(aiFactorySearchRequests).where(
    or(
      eq(aiFactorySearchRequests.status, "notification_failed"),
      and(eq(aiFactorySearchRequests.status, "notifying"), lt(aiFactorySearchRequests.notificationClaimedAt, staleThreshold)),
    )
  );
  let succeeded = 0;
  let stillFailing = 0;
  for (const row of rows) {
    const outcome = await claimAndNotifyFactorySearchRequest(row);
    if (outcome === "notified") succeeded++;
    else if (outcome === "failed") stillFailing++;
  }
  return { attempted: rows.length, succeeded, stillFailing };
}
