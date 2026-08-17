import { randomBytes } from "crypto";
import { and, eq, lt, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { aiHandoffContexts, aiCaseAssessments, type AiHandoffContext } from "../../drizzle/schema";
import { type HandoffEligibleServiceKey } from "../../shared/ai/handoffServices";
import type { ConfirmedFieldProvenance } from "./handoffPrefill";

/**
 * Handoff context 的有效期限：30 分鐘～1 小時建議區間的中間值。這不是長期
 * memory，只是「使用者點了 CTA 之後，多久內要完成表單」的合理寬限——choose
 * 45 分鐘：短到不會變成事實上的長期 token，長到使用者填表單、被電話打斷、
 * 回來繼續填都還來得及，不需要每次都重新從 AI 發起一次 handoff。
 */
export const HANDOFF_CONTEXT_TTL_MS = 45 * 60 * 1000;

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createHandoffContext(params: {
  userId: number;
  factoryId: number | null;
  serviceKey: HandoffEligibleServiceKey;
  prefillData: Record<string, unknown>;
  confirmedFields: Record<string, ConfirmedFieldProvenance>;
  handoffSummary: string;
  sourceConversationId: number | null;
}): Promise<AiHandoffContext> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const token = generateToken();
  const now = Date.now();
  await db.insert(aiHandoffContexts).values({
    token,
    userId: params.userId,
    factoryId: params.factoryId,
    serviceKey: params.serviceKey,
    prefillDataJson: params.prefillData,
    confirmedFieldsJson: params.confirmedFields,
    handoffSummary: params.handoffSummary,
    sourceConversationId: params.sourceConversationId,
    expiresAt: new Date(now + HANDOFF_CONTEXT_TTL_MS),
  });
  const [created] = await db.select().from(aiHandoffContexts).where(eq(aiHandoffContexts.token, token)).limit(1);
  if (!created) throw new Error("Failed to load newly created handoff context");
  return created;
}

/**
 * 權限查詢：只回傳「這個 userId 擁有」的 handoff context，找不到或不是本人
 * 一律回傳 undefined——不能只靠 token 不可猜測就當安全（見對話中「十、
 * Handoff Context 權限」），一定要同時檢查 userId 是否相符。
 */
export async function getHandoffContextForUser(
  token: string,
  userId: number
): Promise<AiHandoffContext | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(aiHandoffContexts)
    .where(and(eq(aiHandoffContexts.token, token), eq(aiHandoffContexts.userId, userId)))
    .limit(1);
  return rows[0];
}

/**
 * Phase 5 retry job 專用：不需要 token／userId（那是給使用者端權限查詢用
 * 的），這裡是內部批次工作直接用 id 讀回一筆 context 供重新生成 assessment
 * 使用，找不到就回傳 undefined。
 */
export async function getHandoffContextById(id: number): Promise<AiHandoffContext | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(aiHandoffContexts).where(eq(aiHandoffContexts.id, id)).limit(1);
  return rows[0];
}

export function isHandoffContextUsable(context: AiHandoffContext): boolean {
  if (context.consumedAt) return false;
  if (context.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export async function acknowledgeHandoffContext(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiHandoffContexts)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(aiHandoffContexts.id, id), isNull(aiHandoffContexts.acknowledgedAt)));
}

/**
 * 表單真的送出成功時呼叫——標記 consumedAt，不物理刪除（短期保留供 Phase 5
 * 建 AI 初判參考，見對話中「二十九」），過期後才由 cleanup job 清除。
 */
export async function consumeHandoffContext(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiHandoffContexts)
    .set({ consumedAt: new Date() })
    .where(eq(aiHandoffContexts.id, id));
}

/**
 * 表單頁 submitApplication 成功後呼叫——只有 token 存在、屬於這個 user、
 * 服務別對得上、而且還沒過期／還沒被消費過時才標記 consumedAt；任何一項
 * 對不上都靜默略過，不拋錯，因為 handoff context 是否健康絕對不能影響
 * 使用者本次送出申請這個主要動作本身（見對話中「三十、使用者最後提交的
 * 表單值才是 authoritative」）。
 */
/**
 * Phase 5：submitApplication 需要在「消費 token」之前先讀出這筆 context 的
 * 內容（serviceKey／confirmedFieldsJson／handoffSummary），才能把它交給
 * case assessment 生成使用。讀取邏輯完全複製 consumeHandoffTokenIfValid 的
 * 判斷（同一 user、同一 serviceKey、還沒過期／還沒被消費過），但這裡是唯讀
 * ——不修改 consumedAt，也不改動 consumeHandoffTokenIfValid 本身的既有行為
 * 與回傳型別（避免影響 Phase 4 既有呼叫端與測試）。
 */
export async function getUsableHandoffContext(
  token: string | null | undefined,
  userId: number,
  expectedServiceKey: HandoffEligibleServiceKey
): Promise<AiHandoffContext | null> {
  if (!token) return null;
  const context = await getHandoffContextForUser(token, userId);
  if (!context) return null;
  if (context.serviceKey !== expectedServiceKey) return null;
  if (!isHandoffContextUsable(context)) return null;
  return context;
}

/**
 * 可靠性修正（見對話中「一～四、Handoff Submit Idempotency」）：同一
 * aiHandoffContext 最多只能催生一筆正式 case，這個 invariant 不能只靠
 * 「案件建立後才 linkage」（那樣兩個併發 request 可能都先各自建立了案件，
 * 事後才發現只能 linkage 到一筆），必須在案件建立「之前」就先原子性地
 * 宣告「這個 handoff 由我來處理」——這裡用 consumedAt 本身當這把鎖：
 * `UPDATE ... WHERE consumedAt IS NULL` 是一個 compare-and-swap，同一時間
 * 只有一個 request 能把 affectedRows 改成 1，其餘全部是 0。
 *
 * 回傳三種結果：
 * - "rejected"：token 不存在／不屬於這個 user／service 不符／已過期——這些
 *   都不能靜默降級成 direct entry（見「二」），一律由呼叫端拒絕整個請求。
 * - "already_submitted"：這個 handoff 之前已經成功建立過案件（submittedCaseId
 *   有值），代表這是同一個 token 的重複／遺失回應後的 retry（見「三」），
 *   呼叫端應該直接回傳既有案件的結果，不能再建立第二筆。
 * - "claimed"：這個 request 拿到了鎖，接下來可以放心走完業務驗證與案件建立
 *   ——如果之後任何一步失敗，呼叫端必須呼叫 releaseHandoffClaim 把鎖還回去，
 *   讓 token 之後還能被合法重試，而不是永久卡死。
 *
 * 併發情境（見「四」）：如果 CAS 沒搶到（affectedRows=0），代表要嘛已經有
 * 別的 request 正在處理中（consumedAt 有值但 submittedCaseId 還沒有）、要嘛
 * 已經處理完成（submittedCaseId 有值）。前者短暫等待幾百毫秒後重新檢查，最多
 * 重試 CLAIM_WAIT_ATTEMPTS 次；如果一直等不到結果（極端情況：贏家 process
 * 中途崩潰、永遠不會 finalize 或 release），最終回傳 "rejected"——寧可讓少數
 * 極端併發情境的使用者被要求重新嘗試，也不能建立第二筆案件（核心 invariant：
 * 一個 aiHandoffContext 最多一筆正式 case，不是「最多 linkage 到一筆」）。
 */
export type HandoffClaimResult =
  | { outcome: "rejected"; reason: string }
  | { outcome: "already_submitted"; caseId: number }
  | { outcome: "claimed"; handoffContext: AiHandoffContext };

const CLAIM_WAIT_ATTEMPTS = 6;
const CLAIM_WAIT_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function claimHandoffForSubmission(params: {
  token: string;
  userId: number;
  serviceKey: HandoffEligibleServiceKey;
}): Promise<HandoffClaimResult> {
  for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt++) {
    const context = await getHandoffContextForUser(params.token, params.userId);
    if (!context) return { outcome: "rejected", reason: "handoff not found or not owned by this user" };
    if (context.serviceKey !== params.serviceKey) return { outcome: "rejected", reason: "service key mismatch" };

    if (context.consumedAt != null) {
      if (context.submittedCaseId != null) {
        return { outcome: "already_submitted", caseId: context.submittedCaseId };
      }
      // 已經被鎖住、但還沒 finalize——可能是另一個併發 request 正在處理中，
      // 短暫等待後重新檢查（見「四」）。
      await delay(CLAIM_WAIT_DELAY_MS);
      continue;
    }

    // expiresAt 是透過 createHandoffContext 用 JS Date 物件寫入的（見
    // handoffContextService.ts 的 createHandoffContext），跟這裡用
    // getHandoffContextForUser／drizzle .select() 讀回來的 JS Date 走的是
    // 同一套 mysql2 序列化／反序列化路徑，兩邊自成一致，直接用 JS Date 比較
    // 是正確的（不像 caseAssessmentService.ts 的 stale-pending 判斷是拿「純
    // SQL 端寫入」的值跟這裡的值比較，那種情況混用 JS Date 與 SQL NOW() 才會
    // 因為 mysql2 timezone 設定跟 DB session 不一致而出錯——這裡完全不混用，
    // 沒有這個問題）。
    if (context.expiresAt.getTime() < Date.now()) {
      return { outcome: "rejected", reason: "handoff expired" };
    }

    const db = await getDb();
    if (!db) return { outcome: "rejected", reason: "db unavailable" };
    const result = await db
      .update(aiHandoffContexts)
      .set({ consumedAt: new Date() })
      .where(and(eq(aiHandoffContexts.id, context.id), isNull(aiHandoffContexts.consumedAt)));
    const affectedRows = (result[0] as { affectedRows?: number }).affectedRows ?? 0;
    if (affectedRows === 1) {
      return { outcome: "claimed", handoffContext: context };
    }
    // 沒搶到鎖（被別的併發 request 搶先）——重新進入迴圈檢查最新狀態（見「四」）。
  }
  return { outcome: "rejected", reason: "concurrent submission still in progress, please retry" };
}

/** 案件建立成功後呼叫——把 claim 轉正為正式 linkage（見「三」）。 */
export async function finalizeHandoffSubmission(handoffContextId: number, caseId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiHandoffContexts)
    .set({ submittedCaseId: caseId, submittedAt: new Date() })
    .where(and(eq(aiHandoffContexts.id, handoffContextId), isNull(aiHandoffContexts.submittedCaseId)));
}

/**
 * 案件建立失敗（業務驗證拒絕或非預期錯誤）時呼叫——釋放 claim，讓這個 token
 * 之後還能被合法重試。WHERE 子句加上 isNull(submittedCaseId) 是安全防線：
 * 絕對不會不小心把一筆已經真的成功建立案件的 handoff 重新打開。
 */
export async function releaseHandoffClaim(handoffContextId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(aiHandoffContexts)
    .set({ consumedAt: null })
    .where(and(eq(aiHandoffContexts.id, handoffContextId), isNull(aiHandoffContexts.submittedCaseId)));
}

/**
 * Missing-assessment recovery（見對話中「五、新增 Missing Assessment
 * Recovery」）：找出「已經成功送出正式案件（consumedAt／submittedCaseId 都
 * 有值），但完全沒有對應 aiCaseAssessment row」的 handoff——這正是 pending
 * row INSERT 連續失敗那種情境唯一留下的 durable 線索。用 LEFT JOIN + 對方
 * id 是 null 判斷「不存在」，不用 NOT EXISTS 子查詢也能達到一樣效果，且
 * drizzle 對 leftJoin 的型別支援更直接。
 */
export async function listSubmittedHandoffContextsMissingAssessment(): Promise<AiHandoffContext[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ handoff: aiHandoffContexts })
    .from(aiHandoffContexts)
    .leftJoin(
      aiCaseAssessments,
      and(
        eq(aiCaseAssessments.serviceKey, aiHandoffContexts.serviceKey),
        eq(aiCaseAssessments.caseId, aiHandoffContexts.submittedCaseId)
      )
    )
    .where(and(
      isNotNull(aiHandoffContexts.consumedAt),
      isNotNull(aiHandoffContexts.submittedCaseId),
      isNull(aiCaseAssessments.id)
    ));
  return rows.map(r => r.handoff);
}

export async function consumeHandoffTokenIfValid(params: {
  token: string | null | undefined;
  userId: number;
  expectedServiceKey: HandoffEligibleServiceKey;
}): Promise<void> {
  if (!params.token) return;
  const context = await getHandoffContextForUser(params.token, params.userId);
  if (!context) return;
  if (context.serviceKey !== params.expectedServiceKey) return;
  if (!isHandoffContextUsable(context)) return;
  await consumeHandoffContext(context.id);
}

/**
 * 本地可手動執行的清理：刪除已過期、且從未被使用者送出過（consumedAt 為
 * null）的 handoff context——已經 consumed 的即使過期也保留（供 Phase 5
 * 參考），見對話中「二十九」。不設定 production cron，只提供函式本身。
 */
export async function cleanupExpiredHandoffContexts(): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db) return { deleted: 0 };
  const result = await db
    .delete(aiHandoffContexts)
    .where(and(lt(aiHandoffContexts.expiresAt, new Date()), isNull(aiHandoffContexts.consumedAt)));
  const deleted = (result[0].affectedRows as number) ?? 0;
  return { deleted };
}
