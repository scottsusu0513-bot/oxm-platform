import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { aiConversations, aiMessages, type AiConversation, type AiMessage } from "../../drizzle/schema";
import type { ConversationState } from "./conversationState";

/** Context Builder 餵給 Layer 1/Layer 2 的預設訊息視窗大小，見 contextBuilder.ts。 */
export const RECENT_MESSAGE_WINDOW = 10;

/**
 * 找這個使用者目前 active 的對話（沒有就回傳 undefined）。
 *
 * 這裡刻意不再有「還在 30 天窗口內」這種時間判斷——conversation 的生命週期
 * 已經改成「當次互動的暫存工作區」：只要還是 active，就代表上一次使用階段
 * 還沒有被正常收尾（可能是同一頁面繼續聊、也可能是使用者離開後留下的孤兒
 * 對話，等下一次開新的使用階段時才會被收尾），不是靠時間過期判斷。
 */
export async function getActiveConversationForUser(userId: number): Promise<AiConversation | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.userId, userId), eq(aiConversations.status, "active")))
    .orderBy(desc(aiConversations.lastMessageAt), desc(aiConversations.id))
    .limit(1);
  return rows[0];
}

export async function createConversation(userId: number, factoryId: number | null): Promise<AiConversation> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const result = await db.insert(aiConversations).values({
    userId,
    factoryId,
    status: "active",
    lastMessageAt: now,
  });
  const id = result[0].insertId as number;
  const [conversation] = await db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1);
  if (!conversation) throw new Error("Failed to load newly created conversation");
  return conversation;
}

/** 權限查詢：只回傳「這個 userId 擁有」的 conversation，找不到或不是本人一律回傳 undefined。 */
export async function getConversationForUser(
  conversationId: number,
  userId: number
): Promise<AiConversation | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function appendMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  await db.insert(aiMessages).values({ conversationId, role, content, createdAt: now });
  await db.update(aiConversations).set({ lastMessageAt: now }).where(eq(aiConversations.id, conversationId));
}

export async function updateConversationState(conversationId: number, state: ConversationState): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(aiConversations)
    .set({ currentStateJson: state as unknown as Record<string, unknown> })
    .where(eq(aiConversations.id, conversationId));
}

/**
 * Phase 10.2 P1（見對話中「十七」）：conversation state 與這一輪最後的
 * assistant message 是同一輪 turn 收尾的最後兩筆寫入，語意上應該同時成功或
 * 同時失敗——分成 updateConversationState() + appendMessage() 兩次獨立呼叫
 * 時，中間如果 process 剛好死掉／DB 斷線，會留下「state 已經反映這輪判斷
 * 結果、但 assistant message 沒寫入」的不一致（下次載入這個 conversation
 * 時，訊息歷史停在使用者最後一句，state 卻已經是這輪的結果，兩者對不上）。
 * 這裡用一個小交易把兩者包在一起——不牽動 appendMessage()／
 * updateConversationState() 本身（其他呼叫端，例如寫入使用者剛送出的訊息，
 * 仍然只需要單獨呼叫 appendMessage()，不需要也不應該被這個交易影響），只在
 * chatService.ts 真正「同一輪 state + assistant message 一起收尾」的兩個
 * 地方改用這支。
 */
export async function updateConversationStateAndAppendMessage(
  conversationId: number,
  state: ConversationState,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(aiConversations)
      .set({ currentStateJson: state as unknown as Record<string, unknown>, lastMessageAt: now })
      .where(eq(aiConversations.id, conversationId));
    await tx.insert(aiMessages).values({ conversationId, role, content, createdAt: now });
  });
}

/** 依 createdAt 由舊到新，取最近 N 則——這是要餵給模型的視窗，見 contextBuilder.ts。 */
export async function getRecentMessages(conversationId: number, limit: number = RECENT_MESSAGE_WINDOW): Promise<AiMessage[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    // createdAt 是整秒精度的 timestamp，短時間內連續寫入可能有好幾筆落在
    // 同一秒——只排 createdAt 會讓同秒內的順序變成未定義。id 是自增主鍵，
    // 天生等於寫入順序，用來當第二排序鍵完全消除這個問題。
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** 收尾產生摘要用：拿這個 conversation 的完整逐字內容（不受視窗限制），見 server/ai/memory.ts。 */
export async function getAllMessages(conversationId: number): Promise<AiMessage[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id));
  return rows.reverse();
}

/** 摘要成功寫入 Enterprise Memory 之後才能呼叫——整筆刪除，aiMessages 靠 FK cascade 一併清掉。 */
export async function deleteConversationAndMessages(conversationId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(aiConversations).where(eq(aiConversations.id, conversationId));
}

/**
 * Phase 11.2（見對話中「二十二、Failed Summary Retention」）：收尾持續失敗
 * 不能無上限重試——超過這個次數後，retryFailedAiSummaries.ts 的排程不會再
 * 自動撿到它（見 getFailedConversations 只查 status='failed'），但原文依然
 * 保留（見下方 markConversationSummaryFailed，不會因為重試次數用完就默默把
 * 企業資料丟掉），只是變成需要人工判斷的 governance 案件。
 */
export const MAX_SUMMARY_RETRY_COUNT = 5;

/** 收尾時產生摘要或寫入 Enterprise Memory 失敗，原文暫時保留、標記待重試（見「四、摘要成功前，原文不能刪」）。達到 MAX_SUMMARY_RETRY_COUNT 後轉為 permanently_failed，停止自動重試但不刪除原文（見「二十二、二十三」）。 */
export async function markConversationSummaryFailed(conversationId: number, error: unknown): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const message = error instanceof Error ? error.message : String(error);
  const [current] = await db.select({ retryCount: aiConversations.retryCount }).from(aiConversations).where(eq(aiConversations.id, conversationId)).limit(1);
  const nextRetryCount = (current?.retryCount ?? 0) + 1;
  await db
    .update(aiConversations)
    .set({
      status: nextRetryCount >= MAX_SUMMARY_RETRY_COUNT ? "permanently_failed" : "failed",
      retryCount: nextRetryCount,
      // 只存錯誤訊息本身，不含任何聊天內容——lastSummaryError 只是給重試 job
      // 判斷用，不應該外流使用者對話內容。
      lastSummaryError: message.slice(0, 2000),
    })
    .where(eq(aiConversations.id, conversationId));
}

/** 收尾重試 job 用：找出所有等待重試的失敗對話（見 server/jobs/retryFailedAiSummaries.ts）。只查 status='failed'——已經達到 MAX_SUMMARY_RETRY_COUNT 上限、狀態變成 permanently_failed 的不會再被自動撿到。 */
export async function getFailedConversations(): Promise<AiConversation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiConversations).where(eq(aiConversations.status, "failed"));
}

/** Admin governance 可視性用（見對話中「二十三、Permanent Failed Visibility」）：達到重試上限、原文仍保留但不再自動重試的對話數量——只回傳數字，不查任何逐字內容。 */
export async function getPermanentlyFailedConversationsCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(aiConversations)
    .where(eq(aiConversations.status, "permanently_failed"));
  return Number(row?.count ?? 0);
}

/**
 * Inactivity finalizer 用（見 server/jobs/finalizeInactiveAiConversations.ts）：
 * 找出所有「最後一次互動已經超過 thresholdMs」且仍是 active 的對話——這裡的
 * 門檻只是用來判斷「這次互動已經結束」，不是「逐字對話保存期限」，兩者是
 * 不同的概念（30 天保存規則已經取消）。
 */
export async function getInactiveConversations(thresholdMs: number): Promise<AiConversation[]> {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - thresholdMs);
  return db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.status, "active"), lt(aiConversations.lastMessageAt, cutoff)));
}
