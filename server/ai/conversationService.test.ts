/**
 * server/ai/conversationService.ts 的 DB 整合測試——走真實本機測試資料庫
 * （受 server/test-db-guard.ts 保護，只能是 oxm_test）。
 *
 * Conversation 現在是「當次互動的暫存工作區」，沒有 30 天窗口、沒有
 * getOrCreateActiveConversation／closeConversation 這種概念了——建立與收尾
 * 的邏輯移到 chatService.ts／memory.ts（見 chatService.test.ts、
 * memory.test.ts），這裡只測純粹的 CRUD 與權限。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  getActiveConversationForUser,
  createConversation,
  getConversationForUser,
  appendMessage,
  getRecentMessages,
  getAllMessages,
  deleteConversationAndMessages,
  markConversationSummaryFailed,
  getFailedConversations,
  getInactiveConversations,
} from "./conversationService";
import { aiConversations } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const runId = `ai-conv-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userAId: number;
let userBId: number;

async function createTestUser(label: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}-${label}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`AI Conv Svc ${runId}-${label}`}, ${`${runId}-${label}@example.test`})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

beforeAll(async () => {
  userAId = await createTestUser("a");
  userBId = await createTestUser("b");
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`);
});

describe("createConversation / getActiveConversationForUser", () => {
  it("建立後可以用 getActiveConversationForUser 找到，status 是 active", async () => {
    const created = await createConversation(userAId, null);
    expect(created.userId).toBe(userAId);
    expect(created.status).toBe("active");

    const found = await getActiveConversationForUser(userAId);
    expect(found?.id).toBe(created.id);

    await deleteConversationAndMessages(created.id);
  });

  it("刪除之後，getActiveConversationForUser 找不到（沒有殘留孤兒對話）", async () => {
    const created = await createConversation(userAId, null);
    await deleteConversationAndMessages(created.id);

    const found = await getActiveConversationForUser(userAId);
    expect(found).toBeUndefined();
  });
});

describe("getConversationForUser — 權限", () => {
  it("擁有者可以讀到自己的 conversation", async () => {
    const conversation = await createConversation(userAId, null);
    const owned = await getConversationForUser(conversation.id, userAId);
    expect(owned?.id).toBe(conversation.id);
    await deleteConversationAndMessages(conversation.id);
  });

  it("另一個 user 拿同一個 conversationId 讀不到（回傳 undefined，不是這筆資料）", async () => {
    const conversation = await createConversation(userAId, null);
    const asUserB = await getConversationForUser(conversation.id, userBId);
    expect(asUserB).toBeUndefined();
    await deleteConversationAndMessages(conversation.id);
  });
});

describe("appendMessage / getRecentMessages — 視窗限制", () => {
  it("插入超過視窗大小的訊息數，getRecentMessages 只回傳最近 N 則、且按時間正序", async () => {
    const conversation = await createConversation(userAId, null);
    for (let i = 1; i <= 15; i++) {
      await appendMessage(conversation.id, i % 2 === 1 ? "user" : "assistant", `msg-${i}`);
    }

    const windowed = await getRecentMessages(conversation.id, 10);
    expect(windowed).toHaveLength(10);
    expect(windowed[0].content).toBe("msg-6");
    expect(windowed[9].content).toBe("msg-15");
    for (let i = 0; i < windowed.length - 1; i++) {
      expect(windowed[i].createdAt.getTime()).toBeLessThanOrEqual(windowed[i + 1].createdAt.getTime());
    }

    await deleteConversationAndMessages(conversation.id);
  });

  it("getAllMessages 回傳完整逐字稿（不受視窗限制），供收尾摘要使用", async () => {
    const conversation = await createConversation(userAId, null);
    for (let i = 1; i <= 12; i++) {
      await appendMessage(conversation.id, "user", `full-${i}`);
    }
    const all = await getAllMessages(conversation.id);
    expect(all).toHaveLength(12);
    await deleteConversationAndMessages(conversation.id);
  });
});

describe("appendMessage 延長 lastMessageAt", () => {
  it("寫入新訊息後，conversation 的 lastMessageAt 會更新到最新時間", async () => {
    const conversation = await createConversation(userBId, null);
    const before = conversation.lastMessageAt.getTime();
    // MySQL 的 timestamp 欄位是整秒精度，sleep 要跨過至少 1 秒的邊界。
    await new Promise(r => setTimeout(r, 1100));
    await appendMessage(conversation.id, "user", "hello");
    const refreshed = await getActiveConversationForUser(userBId);
    expect(refreshed?.lastMessageAt.getTime()).toBeGreaterThan(before);
    await deleteConversationAndMessages(conversation.id);
  });
});

describe("deleteConversationAndMessages — cascade 不留孤兒資料", () => {
  it("刪除 conversation 後，底下的 aiMessages 也一併消失", async () => {
    const conversation = await createConversation(userAId, null);
    await appendMessage(conversation.id, "user", "hi");
    await deleteConversationAndMessages(conversation.id);

    const messages = await getAllMessages(conversation.id);
    expect(messages).toHaveLength(0);
  });
});

describe("getInactiveConversations — inactivity finalizer 用的查詢", () => {
  it("lastMessageAt 超過門檻的 active 對話會被找到；還在門檻內的不會", async () => {
    const db = await getDb();
    const stale = await createConversation(userAId, null);
    const fresh = await createConversation(userAId, null);
    // 直接把 stale 的 lastMessageAt 改成 1 小時前，模擬「離開後很久沒回來」。
    await db!.update(aiConversations)
      .set({ lastMessageAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(aiConversations.id, stale.id));

    const inactive = await getInactiveConversations(30 * 60 * 1000); // 30 分鐘門檻
    const ids = inactive.map(c => c.id);
    expect(ids).toContain(stale.id);
    expect(ids).not.toContain(fresh.id); // fresh 剛建立，還在門檻內，不該被收尾

    await deleteConversationAndMessages(stale.id);
    await deleteConversationAndMessages(fresh.id);
  });

  it("status='failed' 的對話不會被 inactivity finalizer 撿到（那是重試 job 的責任，避免兩邊互搶）", async () => {
    const conversation = await createConversation(userAId, null);
    const db = await getDb();
    await db!.update(aiConversations)
      .set({ status: "failed", lastMessageAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(aiConversations.id, conversation.id));

    const inactive = await getInactiveConversations(30 * 60 * 1000);
    expect(inactive.map(c => c.id)).not.toContain(conversation.id);

    await deleteConversationAndMessages(conversation.id);
  });
});

describe("markConversationSummaryFailed / getFailedConversations — 失敗重試保底", () => {
  it("標記失敗後：status 變 failed、retryCount 累加、原文（conversation 本身）沒有被刪除", async () => {
    const conversation = await createConversation(userAId, null);
    await appendMessage(conversation.id, "user", "still here after failure");

    await markConversationSummaryFailed(conversation.id, new Error("LLM summary boom"));
    let owned = await getConversationForUser(conversation.id, userAId);
    expect(owned?.status).toBe("failed");
    expect(owned?.retryCount).toBe(1);
    expect(owned?.lastSummaryError).toContain("LLM summary boom");

    await markConversationSummaryFailed(conversation.id, new Error("still failing"));
    owned = await getConversationForUser(conversation.id, userAId);
    expect(owned?.retryCount).toBe(2);

    const messages = await getAllMessages(conversation.id);
    expect(messages).toHaveLength(1); // 原文完全沒被動過

    expect(await getFailedConversations()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: conversation.id })])
    );

    await deleteConversationAndMessages(conversation.id);
  });
});
