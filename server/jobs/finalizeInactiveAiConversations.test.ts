/**
 * finalizeInactiveAiConversations()（見「六、新增 inactivity finalization」）
 * 驗證：最後一次互動超過門檻時間、仍是 active 的 conversation，要被主動收尾
 * （摘要 → merge 進 Enterprise Memory → 刪除原文）；還在門檻內的不受影響。
 * provider mock 掉，DB 走真實本機測試資料庫。
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiConversations } from "../../drizzle/schema";

const mockCompleteJson = vi.fn();
vi.mock("../ai/provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
}));

import { finalizeInactiveAiConversations } from "./finalizeInactiveAiConversations";
import { createConversation, appendMessage, getConversationForUser } from "../ai/conversationService";
import { getEnterpriseMemory } from "../ai/memory";

const runId = `finalize-inactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Finalize Inactive ${runId}`}, ${`${runId}@example.test`})`);
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

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("finalizeInactiveAiConversations", () => {
  it("CASE 3：模擬使用者離開超過門檻時間不回來 → 主動收尾，摘要成功、Enterprise Memory 更新、conversation/messages 刪除", async () => {
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我們是做銘板的，最近老客戶流失。");
    const db = await getDb();
    await db!.update(aiConversations)
      .set({ lastMessageAt: new Date(Date.now() - 60 * 60 * 1000) }) // 1 小時前，超過 30 分鐘門檻
      .where(eq(aiConversations.id, conversation.id));

    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "銘板製造；老客戶流失。",
      hasMeaningfulBusinessInfo: true,
    }));

    const result = await finalizeInactiveAiConversations(30 * 60 * 1000);

    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned).toBeUndefined(); // 原文已刪除

    const memory = await getEnterpriseMemory(userId);
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
  });

  it("還在門檻內（剛互動過）的 conversation 不會被收尾", async () => {
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "剛剛才講的話");

    const result = await finalizeInactiveAiConversations(30 * 60 * 1000);

    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned?.status).toBe("active"); // 沒有被動過
    expect(mockCompleteJson).not.toHaveBeenCalled();
    void result;
  });

  it("摘要失敗時：conversation 標記 failed，不會被刪除，統計數字反映在 stillFailing", async () => {
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "測試 inactivity finalizer 失敗情境");
    const db = await getDb();
    await db!.update(aiConversations)
      .set({ lastMessageAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(aiConversations.id, conversation.id));

    mockCompleteJson.mockRejectedValue(new Error("LLM summary boom"));

    const result = await finalizeInactiveAiConversations(30 * 60 * 1000);

    expect(result.stillFailing).toBeGreaterThanOrEqual(1);
    const [row] = await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id));
    expect(row?.status).toBe("failed");
  });
});
