/**
 * retryFailedAiSummaries() 驗證（見「十四、失敗摘要資料的技術保底」）：對之前
 * 收尾失敗（status='failed'）的 conversation 重新嘗試摘要，成功就整筆消失、
 * 仍失敗則保持 failed 並回報統計數字。provider mock 掉，DB 走真實本機測試
 * 資料庫。
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiConversations } from "../../drizzle/schema";

const mockCompleteJson = vi.fn();
vi.mock("../ai/provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
}));

import { retryFailedAiSummaries } from "./retryFailedAiSummaries";
import { createConversation, appendMessage, markConversationSummaryFailed, getConversationForUser } from "../ai/conversationService";

const runId = `retry-ai-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Retry AI Summary ${runId}`}, ${`${runId}@example.test`})`);
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

describe("retryFailedAiSummaries", () => {
  it("重試成功：failed 的 conversation 消失，統計數字正確", async () => {
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "之前摘要失敗過的內容");
    await markConversationSummaryFailed(conversation.id, new Error("first attempt failed"));

    mockCompleteJson.mockResolvedValue(JSON.stringify({
      summaryText: "重試後成功的摘要",
      hasMeaningfulBusinessInfo: true,
    }));

    const result = await retryFailedAiSummaries();

    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned).toBeUndefined();
  });

  it("重試仍然失敗：conversation 保持 failed、retryCount 繼續累加，不會被刪除", async () => {
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "持續失敗的內容");
    await markConversationSummaryFailed(conversation.id, new Error("first attempt failed"));

    mockCompleteJson.mockRejectedValue(new Error("still failing"));

    const result = await retryFailedAiSummaries();

    expect(result.stillFailing).toBeGreaterThanOrEqual(1);
    const db = await getDb();
    const [row] = await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id));
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(2);
  });
});
