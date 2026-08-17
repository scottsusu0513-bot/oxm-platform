/**
 * ai.createHandoff / ai.getHandoffContext / ai.acknowledgeHandoff 的路由層
 * 整合測試——走真實本機測試資料庫，用 appRouter.createCaller(ctx) 直接呼叫
 * tRPC procedure。不需要 mock provider——createHandoff 不再呼叫任何 LLM，
 * prefill 完全來自 state.confirmedFacts 的 deterministic mapping（見對話中
 * 「一、正式表單預填不得重新從 raw transcript 推論」）。
 *
 * 對應對話中「三十一~三十八」必測案例：server 端重新驗證 handoffReady／
 * primaryService（不信任 client）、只有可 handoff 服務才能建立、權限（User A
 * 建立、User B 讀不到）、confirmedFacts 沒有的欄位不得預填。
 */
import { describe, expect, it, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "./db";
import { aiHandoffContexts } from "../drizzle/schema";
import { createConversation, appendMessage, updateConversationState } from "./ai/conversationService";
import type { ConversationState } from "./ai/conversationState";

const { appRouter } = await import("./routers");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `ai-handoff-router-${userId}`, email: `ai-handoff-router-${userId}@example.test`,
    name: "AI Handoff Router Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: false,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

const runId = `ai-handoff-router-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AI Handoff Router ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
}

function fullState(overrides: Partial<ConversationState>): ConversationState {
  return {
    companyContextKnown: false,
    observedProblem: "工單和庫存全靠人工",
    likelyBottleneck: "缺乏系統化管理",
    bottleneckStatus: "clear",
    primaryBusinessDirection: "先系統化管理",
    secondaryConcern: null,
    candidateServiceKeys: [],
    serviceRelationship: null,
    userWantsAction: false,
    handoffReady: false,
    confirmedFacts: {},
    unresolvedQuestion: null,
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterAll(async () => {
  const conn = await getDb();
  if (!conn || createdUserIds.length === 0) return;
  await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
});

describe("ai.createHandoff", () => {
  it("server 端重新驗證：conversation 沒有 handoffReady 時，即使 client 傳了 conversationId 也拒絕", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我們工單全靠人工");
    await updateConversationState(conversation.id, fullState({ handoffReady: false, candidateServiceKeys: ["erp"] }));

    const caller = appRouter.createCaller(ctxFor(userId));
    await expect(caller.ai.createHandoff({ conversationId: conversation.id })).rejects.toThrow();
  });

  it("primaryService 不是本輪支援的 5 個服務之一（例如 factory_search）：拒絕", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "幫我找台中的 CNC 廠");
    await updateConversationState(conversation.id, fullState({ handoffReady: true, candidateServiceKeys: ["factory_search"] }));

    const caller = appRouter.createCaller(ctxFor(userId));
    await expect(caller.ai.createHandoff({ conversationId: conversation.id })).rejects.toThrow();
  });

  it("成功案例：handoffReady + erp + confirmedFacts.needType 是合法代碼 → 建立 handoff context，prefillData 正確、有 provenance", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我們工單和庫存全靠人工，我確定想導 ERP。");
    await updateConversationState(conversation.id, fullState({
      handoffReady: true, candidateServiceKeys: ["erp"],
      confirmedFacts: { needType: "erp_adoption" },
    }));

    const caller = appRouter.createCaller(ctxFor(userId));
    const result = await caller.ai.createHandoff({ conversationId: conversation.id });

    expect(result.serviceKey).toBe("erp");
    expect(result.applyPath).toBe("/erp-optimization/apply");
    expect(result.token).toBeTruthy();

    const db = await getDb();
    const [row] = await db!.select().from(aiHandoffContexts).where(eq(aiHandoffContexts.token, result.token));
    expect(row?.userId).toBe(userId);
    expect(row?.serviceKey).toBe("erp");
    expect(row?.prefillDataJson).toEqual({ needType: "erp_adoption" });
    expect(row?.confirmedFieldsJson).toEqual({ needType: { sourceFact: "needType" } });
    expect(row?.consumedAt).toBeNull();
    expect(row?.acknowledgedAt).toBeNull();
  });

  it("不能猜測（CASE A/B 對應到路由層）：confirmedFacts 完全沒有 needType 時，即使對話逐字稿裡有很多描述，prefillData 仍然是空的", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我們工單和庫存全部人工管理，想把它系統化，麻煩轉交顧問。");
    await updateConversationState(conversation.id, fullState({
      handoffReady: true, candidateServiceKeys: ["erp"],
      confirmedFacts: {}, // Layer 1 沒有把這句話萃取成任何明確的 needType 事實
    }));

    const caller = appRouter.createCaller(ctxFor(userId));
    const result = await caller.ai.createHandoff({ conversationId: conversation.id });

    const db = await getDb();
    const [row] = await db!.select().from(aiHandoffContexts).where(eq(aiHandoffContexts.token, result.token));
    expect(row?.prefillDataJson).toEqual({});
    expect(row?.confirmedFieldsJson).toEqual({});
  });

  it("沒有帶 conversationId：改用這個 user 目前的 active conversation", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "訂單穩定，客戶都 90 天帳期，週轉壓力很大。");
    await updateConversationState(conversation.id, fullState({ handoffReady: true, candidateServiceKeys: ["finance"] }));

    const caller = appRouter.createCaller(ctxFor(userId));
    const result = await caller.ai.createHandoff({});
    expect(result.serviceKey).toBe("finance");
  });
});

describe("ai.getHandoffContext — 權限（十、三十八）", () => {
  it("擁有者可以讀到自己的 prefillData", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "我確定想導 ERP。");
    await updateConversationState(conversation.id, fullState({
      handoffReady: true, candidateServiceKeys: ["erp"],
      confirmedFacts: { needType: "erp_adoption" },
    }));
    const caller = appRouter.createCaller(ctxFor(userId));
    const created = await caller.ai.createHandoff({ conversationId: conversation.id });

    const context = await caller.ai.getHandoffContext({ token: created.token });
    expect(context?.serviceKey).toBe("erp");
    expect(context?.prefillData).toEqual({ needType: "erp_adoption" });
  });

  it("User B 拿 User A 的 token：回傳 null，不洩漏 prefillData／serviceKey", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const conversation = await createConversation(userA, null);
    await appendMessage(conversation.id, "user", "我確定想導 ERP。");
    await updateConversationState(conversation.id, fullState({ handoffReady: true, candidateServiceKeys: ["erp"] }));
    const callerA = appRouter.createCaller(ctxFor(userA));
    const created = await callerA.ai.createHandoff({ conversationId: conversation.id });

    const callerB = appRouter.createCaller(ctxFor(userB));
    const context = await callerB.ai.getHandoffContext({ token: created.token });
    expect(context).toBeNull();
  });

  it("不存在的 token：回傳 null，不拋錯", async () => {
    const userId = await createTestUser();
    const caller = appRouter.createCaller(ctxFor(userId));
    const context = await caller.ai.getHandoffContext({ token: "does-not-exist-at-all" });
    expect(context).toBeNull();
  });
});

describe("ai.acknowledgeHandoff — 權限", () => {
  it("擁有者可以 acknowledge 自己的 handoff", async () => {
    const userId = await createTestUser();
    const conversation = await createConversation(userId, null);
    await appendMessage(conversation.id, "user", "訂單穩定，客戶都 90 天帳期。");
    await updateConversationState(conversation.id, fullState({ handoffReady: true, candidateServiceKeys: ["finance"] }));
    const caller = appRouter.createCaller(ctxFor(userId));
    const created = await caller.ai.createHandoff({ conversationId: conversation.id });

    const result = await caller.ai.acknowledgeHandoff({ token: created.token });
    expect(result.success).toBe(true);
    const context = await caller.ai.getHandoffContext({ token: created.token });
    expect(context?.acknowledgedAt).toBeTruthy();
  });

  it("User B 嘗試 acknowledge User A 的 handoff：拋錯（NOT_FOUND），不會被標記", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const conversation = await createConversation(userA, null);
    await appendMessage(conversation.id, "user", "訂單穩定，客戶都 90 天帳期。");
    await updateConversationState(conversation.id, fullState({ handoffReady: true, candidateServiceKeys: ["finance"] }));
    const callerA = appRouter.createCaller(ctxFor(userA));
    const created = await callerA.ai.createHandoff({ conversationId: conversation.id });

    const callerB = appRouter.createCaller(ctxFor(userB));
    await expect(callerB.ai.acknowledgeHandoff({ token: created.token })).rejects.toThrow();

    const context = await callerA.ai.getHandoffContext({ token: created.token });
    expect(context?.acknowledgedAt).toBeNull();
  });
});
