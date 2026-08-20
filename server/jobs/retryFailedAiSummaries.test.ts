/**
 * retryFailedAiSummaries() 驗證（見「十四、失敗摘要資料的技術保底」＋
 * Phase 11.2「二十二、Failed Summary Retention」）：對之前收尾失敗
 * （status='failed'）的 conversation 重新嘗試摘要，成功就整筆消失、仍失敗則
 * 保持 failed 並回報統計數字；達到 MAX_SUMMARY_RETRY_COUNT 上限後轉為
 * permanently_failed，停止自動重試但保留原文。provider mock 掉，DB 走真實
 * 本機測試資料庫。
 *
 * Phase 11.2：Enterprise Memory 收尾（summary/merge）只有 approved 工廠
 * context 才會真的呼叫 LLM（沒有工廠 context 直接安全刪除，見
 * server/ai/memory.ts），這裡全部改用 createTestFactory 建立真正的 approved
 * 工廠，才能驗證「重試/失敗」這件事本身。
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiConversations } from "../../drizzle/schema";
import { createTestFactory, deleteTestFactory } from "../_core/financeTestFixtures";

const mockCompleteJson = vi.fn();
vi.mock("../ai/provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
}));

import { retryFailedAiSummaries } from "./retryFailedAiSummaries";
import { createConversation, appendMessage, markConversationSummaryFailed, getConversationForUser, MAX_SUMMARY_RETRY_COUNT } from "../ai/conversationService";

const runId = `retry-ai-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;
let factoryId: number;

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
  factoryId = await createTestFactory(userId, `[RETRY_AI_SUMMARY_TEST] ${runId}`);
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  await deleteTestFactory(factoryId);
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("retryFailedAiSummaries", () => {
  it("重試成功：failed 的 conversation 消失，統計數字正確", async () => {
    const conversation = await createConversation(userId, factoryId);
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
    const conversation = await createConversation(userId, factoryId);
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

  it("Phase 11.2「二十二」：達到 MAX_SUMMARY_RETRY_COUNT 上限後轉為 permanently_failed，retry job 之後不再自動撿到，原文依然保留", async () => {
    const conversation = await createConversation(userId, factoryId);
    await appendMessage(conversation.id, "user", "永久失敗的內容");
    mockCompleteJson.mockRejectedValue(new Error("permanent failure"));

    // 手動連續標記失敗到剛好一次差達到上限（模擬先前已經重試過很多次）。
    for (let i = 1; i < MAX_SUMMARY_RETRY_COUNT; i++) {
      await markConversationSummaryFailed(conversation.id, new Error(`attempt ${i} failed`));
    }
    const db = await getDb();
    const [beforeLast] = await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id));
    expect(beforeLast?.status).toBe("failed"); // 還沒到上限，仍是 failed，retry job 還會撿到它
    expect(beforeLast?.retryCount).toBe(MAX_SUMMARY_RETRY_COUNT - 1);

    // 最後一次重試（第 MAX_SUMMARY_RETRY_COUNT 次）：達到上限，轉為 permanently_failed。
    const result = await retryFailedAiSummaries();
    expect(result.stillFailing).toBeGreaterThanOrEqual(1);

    const [afterLast] = await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id));
    expect(afterLast?.status).toBe("permanently_failed");
    expect(afterLast?.retryCount).toBe(MAX_SUMMARY_RETRY_COUNT);
    // 原文完全保留，不因為達到重試上限就被刪除。
    const owned = await getConversationForUser(conversation.id, userId);
    expect(owned?.status).toBe("permanently_failed");

    // retry job 之後不會再撿到它（getFailedConversations 只查 status='failed'）。
    mockCompleteJson.mockClear();
    const secondRun = await retryFailedAiSummaries();
    const stillPicked = secondRun.attempted > 0 &&
      (await db!.select().from(aiConversations).where(eq(aiConversations.id, conversation.id)))[0]?.retryCount === MAX_SUMMARY_RETRY_COUNT + 1;
    expect(stillPicked).toBe(false);

    expect(result.permanentlyFailedTotal).toBeGreaterThanOrEqual(1);
  });
});
