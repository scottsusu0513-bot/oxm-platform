import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiCaseAssessments, type AiCaseAssessment } from "../../drizzle/schema";
import type { HandoffEligibleServiceKey } from "../../shared/ai/handoffServices";

/**
 * Phase 5：AI Case Assessment 的純 DB CRUD 層，跟 handoffContextService.ts
 * 同一種風格——直接用 getDb()，不透過 server/db.ts（那個檔案已經很大，這裡
 * 是完全獨立的一張表，沒有必要再塞進去）。
 *
 * 同一 serviceKey + caseId 最多一筆（DB 有 aica_service_case_uq unique index
 * 保底，見對話中「二十六、不要因重試造成重複 assessment」），這裡的
 * createPendingAssessment 只在案件剛建立、確定還沒有這筆時呼叫一次；重試
 * 一律 UPDATE 既有這筆（markAssessmentCompleted／markAssessmentFailed）。
 */

export async function createPendingAssessment(params: {
  userId: number;
  factoryId: number | null;
  serviceKey: HandoffEligibleServiceKey;
  caseId: number;
  handoffContextId: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(aiCaseAssessments).values({
    userId: params.userId,
    factoryId: params.factoryId,
    serviceKey: params.serviceKey,
    caseId: params.caseId,
    handoffContextId: params.handoffContextId,
    status: "pending",
  });
  const [created] = await db
    .select({ id: aiCaseAssessments.id })
    .from(aiCaseAssessments)
    .where(and(eq(aiCaseAssessments.serviceKey, params.serviceKey), eq(aiCaseAssessments.caseId, params.caseId)))
    .limit(1);
  if (!created) throw new Error("Failed to load newly created case assessment");
  return created.id;
}

/**
 * Missing-assessment recovery 專用（見對話中「六、Recovery 不得建立重複
 * assessment」）：create-if-missing／upsert-safe——先查一次是否已存在（多數
 * 情況下就是這裡攔下重複執行、避免真的去撞 unique index）；如果查的當下還
 * 不存在，才真的 INSERT，但 INSERT 仍可能因為「另一個 worker 剛好搶先建立」
 * 而撞上 UNIQUE(serviceKey, caseId) 丟錯——這種情況不是真正的失敗，重新讀
 * 一次既有 row 直接回傳（created:false），讓呼叫端知道「不是我建立的，不用
 * 重複排入這次要處理的清單」；如果重讀還是找不到，才代表是真正的資料庫錯誤，
 * 原樣往上丟。
 */
export async function createPendingAssessmentIfMissing(params: {
  userId: number;
  factoryId: number | null;
  serviceKey: HandoffEligibleServiceKey;
  caseId: number;
  handoffContextId: number | null;
}): Promise<{ row: AiCaseAssessment; created: boolean }> {
  const existing = await getAssessmentForCase(params.serviceKey, params.caseId);
  if (existing) return { row: existing, created: false };
  try {
    await createPendingAssessment(params);
  } catch (err) {
    const raced = await getAssessmentForCase(params.serviceKey, params.caseId);
    if (raced) return { row: raced, created: false };
    throw err;
  }
  const created = await getAssessmentForCase(params.serviceKey, params.caseId);
  if (!created) throw new Error("Failed to load newly created case assessment (if-missing)");
  return { row: created, created: true };
}

export async function markAssessmentCompleted(
  id: number,
  params: { assessmentJson: Record<string, unknown>; assessmentText: string }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiCaseAssessments)
    .set({ status: "completed", assessmentJson: params.assessmentJson, assessmentText: params.assessmentText, lastError: null })
    .where(eq(aiCaseAssessments.id, id));
}

/**
 * 失敗只記錄狀態與錯誤訊息，絕不把第一次失敗的 LLM 輸出（如果有殘缺片段）
 *當成正式內容存進 assessmentJson（見對話中「二十五、不要保存第一次錯誤的
 * LLM輸出當正式內容」）——這裡完全不寫 assessmentJson/assessmentText，維持
 * 上一次成功值（第一次失敗時是 null）。
 */
export async function markAssessmentFailed(id: number, errorMessage: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiCaseAssessments)
    .set({ status: "failed", lastError: errorMessage.slice(0, 2000) })
    .where(eq(aiCaseAssessments.id, id));
}

/** 只有 retry job 呼叫——每次真的「重新嘗試」才 +1，第一次生成失敗不算 retry。 */
export async function incrementAssessmentRetryCount(id: number, current: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiCaseAssessments)
    .set({ retryCount: current + 1 })
    .where(eq(aiCaseAssessments.id, id));
}

export async function getAssessmentForCase(
  serviceKey: HandoffEligibleServiceKey,
  caseId: number
): Promise<AiCaseAssessment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(aiCaseAssessments)
    .where(and(eq(aiCaseAssessments.serviceKey, serviceKey), eq(aiCaseAssessments.caseId, caseId)))
    .limit(1);
  return rows[0];
}

/**
 * 批次查詢——顧問案件列表一次把整批 case 的 assessment 一起帶出來，避免
 * N+1。刻意用 Map 回傳（key 是 caseId），呼叫端逐筆比對即可，找不到就是
 * null（一般直接表單案件本來就不會有任何一筆，見對話中「三十六」）。
 */
export async function getAssessmentsForCases(
  serviceKey: HandoffEligibleServiceKey,
  caseIds: number[]
): Promise<Map<number, AiCaseAssessment>> {
  const map = new Map<number, AiCaseAssessment>();
  if (caseIds.length === 0) return map;
  const db = await getDb();
  if (!db) return map;
  const rows = await db
    .select()
    .from(aiCaseAssessments)
    .where(and(eq(aiCaseAssessments.serviceKey, serviceKey), inArray(aiCaseAssessments.caseId, caseIds)));
  for (const row of rows) map.set(row.caseId, row);
  return map;
}

export async function listFailedAssessments(): Promise<AiCaseAssessment[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiCaseAssessments).where(eq(aiCaseAssessments.status, "failed"));
}

/**
 * 可靠性修正（見對話中「六、Fire-and-forget 的 stale pending 問題」）：
 * initiateCaseAssessment 的實際生成是 un-await 的 fire-and-forget，如果
 * process 剛好在生成完成前重啟，該筆 row 會永遠停在 status=pending，原本的
 * retryFailedAiCaseAssessments 只掃 status=failed，救不到這種狀況。這裡找出
 * 「已經 pending 超過合理門檻」的 row（updatedAt 在 onUpdateNow() 保證下，
 * 建立當下等於 createdAt，之後每次被 UPDATE 才會推進，所以可以拿來判斷
 * 「多久沒被動過」）交給 retry job 一併處理，同時刻意不去動剛建立、可能仍在
 * 正常生成中的 pending row（見「不要重試剛建立幾秒鐘、仍正常生成中的
 * pending」）。
 */
export async function listStalePendingAssessments(olderThanMs: number): Promise<AiCaseAssessment[]> {
  const db = await getDb();
  if (!db) return [];
  // 門檻比較完全交給 MySQL 自己的 NOW() 計算，不綁定任何 JS Date 參數——這個
  // pool 的 mysql2 timezone 設定跟 DB session 的實際 timezone 不一致（見
  // db.ts 的 toSqlUtc() 註解：「mysql2 pool.execute() converts Date objects
  // using the local timezone, which can corrupt UTC timestamps」），任何一邊
  // 用 JS Date 物件當參數綁定都可能被錯誤位移數小時；updatedAt 本身跟
  // DATE_SUB(NOW(), ...) 都是同一個 session 內的伺服器端值，互相比較不受這個
  // 問題影響。
  const minutes = Math.max(1, Math.floor(olderThanMs / 60000));
  return db
    .select()
    .from(aiCaseAssessments)
    .where(and(
      eq(aiCaseAssessments.status, "pending"),
      sql`${aiCaseAssessments.updatedAt} < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)`
    ));
}
