/**
 * server/ai/handoffContextService.ts 驗證，對應對話中「三十一~三十八」必測
 * 案例中跟 handoff context 生命週期／權限相關的部分：
 * - 建立後只有本人能讀（十、Handoff Context 權限）
 * - 過期／已消費後不可再用來預填
 * - acknowledge／consume 各自獨立、冪等
 * - consumeHandoffTokenIfValid 對任何「對不上」的情況一律靜默略過，不拋錯
 * - cleanup 只清「過期且從未被使用過」的
 *
 * DB 走真實本機測試資料庫。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiHandoffContexts } from "../../drizzle/schema";
import {
  createHandoffContext,
  getHandoffContextForUser,
  isHandoffContextUsable,
  acknowledgeHandoffContext,
  consumeHandoffContext,
  consumeHandoffTokenIfValid,
  cleanupExpiredHandoffContexts,
  HANDOFF_CONTEXT_TTL_MS,
} from "./handoffContextService";

const runId = `ai-handoff-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userAId: number;
let userBId: number;

async function createTestUser(label: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}-${label}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Handoff Svc ${runId}-${label}`}, ${`${runId}-${label}@example.test`})`);
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

describe("createHandoffContext / getHandoffContextForUser — 權限", () => {
  it("擁有者可以用 token 讀到自己的 handoff context", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "erp",
      prefillData: { needType: "erp_adoption" }, confirmedFields: { needType: { sourceFact: "needType" } },
      handoffSummary: "測試摘要", sourceConversationId: null,
    });
    const found = await getHandoffContextForUser(created.token, userAId);
    expect(found?.id).toBe(created.id);
    expect(found?.prefillDataJson).toEqual({ needType: "erp_adoption" });
  });

  it("User B 拿 User A 的 token 讀不到（回傳 undefined，不是這筆資料，不洩漏 prefillData）", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "erp",
      prefillData: { needType: "erp_adoption" }, confirmedFields: { needType: { sourceFact: "needType" } },
      handoffSummary: "測試摘要", sourceConversationId: null,
    });
    const asUserB = await getHandoffContextForUser(created.token, userBId);
    expect(asUserB).toBeUndefined();
  });

  it("不存在的 token：回傳 undefined", async () => {
    const found = await getHandoffContextForUser("not-a-real-token", userAId);
    expect(found).toBeUndefined();
  });
});

describe("isHandoffContextUsable — 過期／已消費判斷", () => {
  it("剛建立的 context：可用", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    expect(isHandoffContextUsable(created)).toBe(true);
  });

  it("已過期（expiresAt 在過去）：不可用", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    const db = await getDb();
    await db!.update(aiHandoffContexts).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiHandoffContexts.id, created.id));
    const refreshed = await getHandoffContextForUser(created.token, userAId);
    expect(isHandoffContextUsable(refreshed!)).toBe(false);
  });

  it("已消費（consumedAt 有值）：不可用，即使還沒過期", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    await consumeHandoffContext(created.id);
    const refreshed = await getHandoffContextForUser(created.token, userAId);
    expect(isHandoffContextUsable(refreshed!)).toBe(false);
  });

  it("有效期限確實是 45 分鐘（TTL 常數）", () => {
    expect(HANDOFF_CONTEXT_TTL_MS).toBe(45 * 60 * 1000);
  });
});

describe("acknowledgeHandoffContext — Blocking Modal 確認", () => {
  it("第一次呼叫寫入 acknowledgedAt；第二次呼叫（冪等）不會報錯，值不變", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    await acknowledgeHandoffContext(created.id);
    const first = await getHandoffContextForUser(created.token, userAId);
    expect(first?.acknowledgedAt).toBeInstanceOf(Date);

    await acknowledgeHandoffContext(created.id); // 冪等：refresh 時可能再呼叫一次
    const second = await getHandoffContextForUser(created.token, userAId);
    expect(second?.acknowledgedAt?.getTime()).toBe(first?.acknowledgedAt?.getTime());
  });
});

describe("consumeHandoffTokenIfValid — submitApplication 成功後呼叫的安全消費", () => {
  it("token/user/serviceKey 都對得上、還有效：標記 consumedAt", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    await consumeHandoffTokenIfValid({ token: created.token, userId: userAId, expectedServiceKey: "gov_subsidy" });
    const refreshed = await getHandoffContextForUser(created.token, userAId);
    expect(refreshed?.consumedAt).toBeInstanceOf(Date);
  });

  it("token 為 null/undefined：靜默略過，不拋錯", async () => {
    await expect(consumeHandoffTokenIfValid({ token: undefined, userId: userAId, expectedServiceKey: "erp" })).resolves.toBeUndefined();
  });

  it("serviceKey 對不上（拿 erp 的 token 去消費 gov_subsidy）：靜默略過，不消費", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "erp",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    await consumeHandoffTokenIfValid({ token: created.token, userId: userAId, expectedServiceKey: "gov_subsidy" });
    const refreshed = await getHandoffContextForUser(created.token, userAId);
    expect(refreshed?.consumedAt).toBeNull();
  });

  it("userId 對不上（別人的 token）：靜默略過，不消費，不拋錯", async () => {
    const created = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "erp",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    await expect(consumeHandoffTokenIfValid({ token: created.token, userId: userBId, expectedServiceKey: "erp" })).resolves.toBeUndefined();
    const asOwner = await getHandoffContextForUser(created.token, userAId);
    expect(asOwner?.consumedAt).toBeNull();
  });
});

describe("cleanupExpiredHandoffContexts", () => {
  it("只刪除過期且從未消費過的；未過期的、已消費過的都保留", async () => {
    const db = await getDb();

    const expiredUnconsumed = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    const expiredConsumed = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });
    const stillFresh = await createHandoffContext({
      userId: userAId, factoryId: null, serviceKey: "finance",
      prefillData: {}, confirmedFields: {}, handoffSummary: "s", sourceConversationId: null,
    });

    await db!.update(aiHandoffContexts).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(aiHandoffContexts.id, expiredUnconsumed.id));
    await db!.update(aiHandoffContexts).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(aiHandoffContexts.id, expiredConsumed.id));
    await consumeHandoffContext(expiredConsumed.id);

    const result = await cleanupExpiredHandoffContexts();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const [rows] = await db!.execute(sql`SELECT id FROM aiHandoffContexts WHERE id IN (${expiredUnconsumed.id}, ${expiredConsumed.id}, ${stillFresh.id})`) as unknown as [{ id: number }[], unknown];
    const remainingIds = rows.map(r => r.id);
    expect(remainingIds).not.toContain(expiredUnconsumed.id); // 過期且沒消費過 → 被清掉
    expect(remainingIds).toContain(expiredConsumed.id); // 過期但已消費過 → 保留供 Phase 5 參考
    expect(remainingIds).toContain(stillFresh.id); // 還沒過期 → 保留
  });
});
