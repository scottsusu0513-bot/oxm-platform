/**
 * buildTurnContext()（Context Builder）驗證：即使一個 conversation 累積了
 * 遠超過視窗大小的訊息，Layer 1/Layer 2 實際看到的歷史也只有最近
 * RECENT_MESSAGE_WINDOW 則，不會把整段對話全部送給模型。走真實本機測試
 * 資料庫。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { buildTurnContext } from "./contextBuilder";
import { createConversation, appendMessage, RECENT_MESSAGE_WINDOW, updateConversationState, deleteConversationAndMessages } from "./conversationService";
import { createEmptyConversationState } from "./conversationState";

const runId = `ctx-builder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Ctx Builder ${runId}`}, ${`${runId}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

beforeAll(async () => {
  userId = await createTestUser();
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

describe("buildTurnContext — 不會把整段對話全部送給模型", () => {
  it("conversation 有 100 則訊息時，history 只回傳最近 RECENT_MESSAGE_WINDOW 則", async () => {
    const conversation = await createConversation(userId, null);
    for (let i = 1; i <= 100; i++) {
      await appendMessage(conversation.id, i % 2 === 1 ? "user" : "assistant", `m${i}`);
    }

    const context = await buildTurnContext(conversation);

    expect(context.history).toHaveLength(RECENT_MESSAGE_WINDOW);
    expect(context.history[context.history.length - 1].content).toBe("m100");

    await deleteConversationAndMessages(conversation.id);
  });

  it("回傳 previousState（如果 conversation 有存的話）", async () => {
    const conversation = await createConversation(userId, null);
    const state = { ...createEmptyConversationState(true), observedProblem: "帳期造成的現金流壓力" };
    await updateConversationState(conversation.id, state);

    // 重新讀取 conversation row（updateConversationState 不會 mutate 傳入的物件）
    const db = await getDb();
    const { aiConversations } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [refreshed] = await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id));

    const context = await buildTurnContext(refreshed);
    expect(context.previousState?.observedProblem).toBe("帳期造成的現金流壓力");

    await deleteConversationAndMessages(conversation.id);
  });
});
