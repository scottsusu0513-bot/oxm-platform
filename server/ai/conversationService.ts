import { and, desc, eq, lt } from "drizzle-orm";
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

/** 收尾時產生摘要或寫入 Enterprise Memory 失敗，原文暫時保留、標記待重試（見「四、摘要成功前，原文不能刪」）。 */
export async function markConversationSummaryFailed(conversationId: number, error: unknown): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const message = error instanceof Error ? error.message : String(error);
  const [current] = await db.select({ retryCount: aiConversations.retryCount }).from(aiConversations).where(eq(aiConversations.id, conversationId)).limit(1);
  await db
    .update(aiConversations)
    .set({
      status: "failed",
      retryCount: (current?.retryCount ?? 0) + 1,
      // 只存錯誤訊息本身，不含任何聊天內容——lastSummaryError 只是給重試 job
      // 判斷用，不應該外流使用者對話內容。
      lastSummaryError: message.slice(0, 2000),
    })
    .where(eq(aiConversations.id, conversationId));
}

/** 收尾重試 job 用：找出所有等待重試的失敗對話（見 server/jobs/retryFailedAiSummaries.ts）。 */
export async function getFailedConversations(): Promise<AiConversation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiConversations).where(eq(aiConversations.status, "failed"));
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
