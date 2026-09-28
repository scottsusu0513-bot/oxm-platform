/**
 * Phase 11.2「三十一：Cross-factory Leakage Tests」驗證——P1、P3、P4、P5。
 *
 * 走真實本機測試資料庫、真實 membership-transition code path（db.ownerSoftDeleteFactory／
 * db.acceptInvitation／db.delistFactory／db.approveFactoryWithBadgeSync），
 * 只 mock diagnosis／routing／provider（不打真實 OpenAI API），用
 * appRouter.createCaller(ctx) 直接呼叫 tRPC procedure，沿用
 * aiConversationRouter.test.ts 的既有慣例。
 *
 * P1／P3 特別驗證「實際傳進 Layer 1 Diagnosis 的 enterpriseMemory 參數」，不是
 * 只驗 DB row——這是 Phase 11.1 Audit 認定的 P0（cross-factory memory
 * injection）唯一真正有意義的驗證方式：DB 裡有沒有殘留舊資料不是重點，重點是
 * 「這次對話會不會把它餵給 LLM」。
 *
 * P2（Admin no-factory 不注入 memory）、P6（conversation 刪除後 usage
 * metadata 仍在）、P7（摘要失敗原文保留）、P8（摘要+merge 成功才刪原文）已在
 * aiConversationRouter.test.ts／memory.test.ts／retryFailedAiSummaries.test.ts
 * 覆蓋，這裡不重複。
 */
import { describe, expect, it, vi, afterEach, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb, ownerSoftDeleteFactory, acceptInvitation, delistFactory, approveFactoryWithBadgeSync } from "./db";
import { aiEnterpriseMemories } from "../drizzle/schema";
import { createTestFactory, deleteTestFactory } from "./_core/financeTestFixtures";

const mockRunEnterpriseDiagnosis = vi.fn();
vi.mock("./ai/diagnosis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/diagnosis")>();
  return { ...actual, runEnterpriseDiagnosis: (...args: unknown[]) => mockRunEnterpriseDiagnosis(...args) };
});

const mockRunOxmRouting = vi.fn();
vi.mock("./ai/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/routing")>();
  return { ...actual, runOxmRouting: (...args: unknown[]) => mockRunOxmRouting(...args) };
});

const mockCompleteJson = vi.fn();
vi.mock("./ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/provider")>();
  return { ...actual, getAiChatProvider: () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }) };
});

// Phase 13.0.1（見對話「二、五」）：這個檔案測的是 factory-scoped Enterprise
// Memory／membership 轉換，是「AI 已正式開放」前提下才有意義的行為，不是
// Coming Soon 本身。file-level 明確 opt-in "live"：上面幾行 static import
// （getDb／financeTestFixtures 等）已經把 env.ts 用預設值 hoist-評估過一次，
// 所以光設 process.env 不夠，需要跟 server/aiKillSwitchRouter.test.ts 的
// K1-K3 同一招——vi.resetModules() 讓 env.ts／routers.ts 用這裡設定的 "live"
// 重新求值一次，afterAll 還原，避免污染同 worker 內其他測試檔案。不改動
// memory production 邏輯本身。
const ORIGINAL_AI_RELEASE_MODE = process.env.OXM_AI_RELEASE_MODE;
process.env.OXM_AI_RELEASE_MODE = "live";
vi.resetModules();

const { appRouter } = await import("./routers");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxForUser(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `cross-factory-${userId}`, email: `cross-factory-${userId}@example.test`,
    name: "Cross Factory Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: false,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

let clientTurnIdSeq = 0;
function nextClientTurnId(): string {
  clientTurnIdSeq += 1;
  return `cross-factory-turn-${clientTurnIdSeq}`;
}

function mockAiReply(reply: string) {
  mockRunEnterpriseDiagnosis.mockResolvedValue({
    observedProblem: "test", likelyBottleneck: null, bottleneckStatus: "unclear",
    evidence: [], alternativeHypotheses: [], secondaryConcern: null,
    recommendedBusinessDirection: null, nextBestQuestion: reply,
    shouldStopQuestioning: false, userWantsAction: false, confirmedFacts: {},
  });
  mockRunOxmRouting.mockResolvedValue({
    primaryService: null, secondaryService: null, relationship: null,
    serviceFitReason: "", shouldOfferHandoff: false, finalReply: reply,
  });
}

function mockSummary(summaryText: string, hasMeaningfulBusinessInfo: boolean) {
  mockCompleteJson.mockResolvedValue(JSON.stringify({ summaryText, hasMeaningfulBusinessInfo }));
}

const runId = `cross-factory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;
const createdUserIds: number[] = [];
const createdFactoryIds: number[] = [];

async function mkUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Cross Factory ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
}

async function mkFactory(ownerId: number, label: string): Promise<number> {
  const id = await createTestFactory(ownerId, `[CROSS_FACTORY_TEST] ${runId}-${label}`);
  createdFactoryIds.push(id);
  return id;
}

async function mkInvitation(factoryId: number, inviterUserId: number, inviteeUserId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [convR]: any = await conn.execute(
    sql`INSERT INTO conversations (userId, factoryId, lastMessageAt, createdAt) VALUES (${inviteeUserId}, ${factoryId}, NOW(), NOW())`
  );
  const convId = convR.insertId;
  const [r]: any = await conn.execute(
    sql`INSERT INTO factoryCoManagerInvitations (factoryId, inviterUserId, inviteeUserId, status, conversationId, expiresAt, createdAt) VALUES (${factoryId}, ${inviterUserId}, ${inviteeUserId}, 'pending', ${convId}, ${expiresAt}, NOW())`
  );
  return r.insertId;
}

afterEach(async () => {
  mockRunEnterpriseDiagnosis.mockReset();
  mockRunOxmRouting.mockReset();
  mockCompleteJson.mockReset();
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const factoryId of createdFactoryIds) {
    await deleteTestFactory(factoryId).catch(() => {}); // 測試中軟刪除過的工廠列仍存在，這裡實際清除測試資料
  }
  if (createdUserIds.length > 0) {
    await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
  }
});

afterAll(() => {
  if (ORIGINAL_AI_RELEASE_MODE === undefined) delete process.env.OXM_AI_RELEASE_MODE;
  else process.env.OXM_AI_RELEASE_MODE = ORIGINAL_AI_RELEASE_MODE;
});

describe("P1：Factory A owner 建立 A memory → owner 自助刪除 A（軟刪除）→ A 的記憶不再被注入", () => {
  it("刪除後 ai.chat 在 entitlement 就被擋下，Diagnosis 不會被呼叫、A 的舊記憶不會被餵給 LLM", async () => {
    const userId = await mkUser();
    const factoryA = await mkFactory(userId, "A-p1");

    // Day 1：U 是 Factory A owner，AI 記住 Factory A 的企業資訊。
    mockAiReply("了解，那目前主要是哪一種加工類型？");
    const callerOnA = appRouter.createCaller(ctxForUser(userId));
    await callerOnA.ai.chat({ message: "我們是做 CNC 車銑複合的。", clientTurnId: nextClientTurnId() });

    mockAiReply("收到");
    mockSummary("CNC 車銑複合；主力產品為精密零件。", true);
    // 觸發收尾（下一個使用階段），寫入 Factory A 的 Enterprise Memory。
    await callerOnA.ai.chat({ message: "先這樣，謝謝。", clientTurnId: nextClientTurnId() });

    const db = await getDb();
    const [memoryA] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryA));
    expect(memoryA?.summaryText).toBe("CNC 車銑複合；主力產品為精密零件。");

    // U 離開 Factory A（owner 自助刪除）。Production Hardening Batch 2 起，
    // owner 刪除改為軟刪除（status=delisted + deletedAt，工廠列保留，見
    // db.ownerSoftDeleteFactory）。工廠列仍以 U 為 ownerId，一人一間工廠的
    // 唯一性限制（uq_factory_owner_id／acceptInvitation 的 ownerId 檢查）會讓
    // U 無法再加入其他工廠——這是待產品決定的 lifecycle 問題，不在本測試
    // 斷言範圍；這裡只驗證核心安全性質：刪除後 A 的記憶不會再被餵給 LLM。
    await ownerSoftDeleteFactory(factoryA, userId);

    mockRunEnterpriseDiagnosis.mockClear();
    mockAiReply("好的，請問目前遇到什麼狀況？");
    const callerAfterDelete = appRouter.createCaller(ctxForUser(userId));
    const result = await callerAfterDelete.ai.chat({ message: "你還記得我是做什麼的嗎？", clientTurnId: nextClientTurnId() });

    // 核心斷言：已軟刪除的 Factory A 不再是 U 的有效企業身分，entitlement 在最前面
    // 就擋下（跟 P4 delisted 相同），Diagnosis 完全不會被呼叫，A 的記憶不可能被注入。
    expect(result).toMatchObject({ status: "denied", reason: "no_factory" });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
  });
});

describe("P3：Owner U1 產生 Factory A memory → Co-manager U2 開 AI → 讀到同一份 A memory（正式產品行為）", () => {
  it("U2 收到跟 U1 完全相同的 enterpriseMemory 內容", async () => {
    const ownerId = await mkUser();
    const factoryA = await mkFactory(ownerId, "A-p3");
    const coManagerId = await mkUser();
    const invitationId = await mkInvitation(factoryA, ownerId, coManagerId);
    await acceptInvitation(invitationId, coManagerId);

    // U1（owner）先跟 AI 聊，產生 Factory A 的企業記憶。
    mockAiReply("了解");
    const ownerCaller = appRouter.createCaller(ctxForUser(ownerId));
    await ownerCaller.ai.chat({ message: "我們主要做食品包裝設計。", clientTurnId: nextClientTurnId() });
    mockAiReply("收到");
    mockSummary("食品包裝設計；主力客戶為連鎖超商。", true);
    await ownerCaller.ai.chat({ message: "先這樣。", clientTurnId: nextClientTurnId() });

    // U2（co-manager）開新對話——必須讀到同一份 Factory A 記憶。
    mockRunEnterpriseDiagnosis.mockClear();
    mockAiReply("你好，我記得你們主要做食品包裝設計。");
    const coManagerCaller = appRouter.createCaller(ctxForUser(coManagerId));
    await coManagerCaller.ai.chat({ message: "你還記得我們公司是做什麼的嗎？", clientTurnId: nextClientTurnId() });

    expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].enterpriseMemory).toEqual({
      summaryText: "食品包裝設計；主力客戶為連鎖超商。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true,
    });
  });
});

describe("P4：Factory A 下架（delisted）→ entitlement denied、memory 不注入；重新 approved → 可讀回原本的 A memory", () => {
  it("delisted 期間 ai.chat 被 entitlement 擋下；re-approve 後恢復讀到原本記憶", async () => {
    const ownerId = await mkUser();
    const factoryA = await mkFactory(ownerId, "A-p4");

    mockAiReply("了解");
    const caller = appRouter.createCaller(ctxForUser(ownerId));
    await caller.ai.chat({ message: "我們做手工皮件。", clientTurnId: nextClientTurnId() });
    mockAiReply("收到");
    mockSummary("手工皮件；客製化訂單為主。", true);
    await caller.ai.chat({ message: "先這樣。", clientTurnId: nextClientTurnId() });

    const db = await getDb();
    const [memoryBeforeDelist] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryA));
    expect(memoryBeforeDelist?.summaryText).toBe("手工皮件；客製化訂單為主。");

    // 下架：entitlement 立即失效。
    const delisted = await delistFactory(factoryA);
    expect(delisted).toBe(true);

    mockRunEnterpriseDiagnosis.mockClear();
    const deniedResult = await caller.ai.chat({ message: "還在嗎？", clientTurnId: nextClientTurnId() });
    expect(deniedResult).toMatchObject({ status: "denied", reason: "no_factory" });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled(); // entitlement 擋在最前面，完全不會碰到 memory 讀取

    // 重新 approved（同一間工廠）：memory 沒有被清過，理應可以重新讀到。
    await approveFactoryWithBadgeSync(factoryA);

    mockRunEnterpriseDiagnosis.mockClear();
    mockAiReply("歡迎回來");
    const afterReapprove = await caller.ai.chat({ message: "你還記得我們是做什麼的嗎？", clientTurnId: nextClientTurnId() });
    expect(afterReapprove.status).toBe("ok");
    expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].enterpriseMemory).toEqual({
      summaryText: "手工皮件；客製化訂單為主。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true,
    });
  });
});

describe("P5：Factory A 被 owner 自助刪除（軟刪除）→ Enterprise Memory 跟著工廠列保留，不成為無主記憶，也不再被讀取", () => {
  it("ownerSoftDeleteFactory 後工廠列與 memory 都保留（memory 仍指向 A，不是 orphan），且 AI 不再讀取", async () => {
    const ownerId = await mkUser();
    const factoryA = await mkFactory(ownerId, "A-p5");

    mockAiReply("了解");
    const caller = appRouter.createCaller(ctxForUser(ownerId));
    await caller.ai.chat({ message: "我們是做塑膠射出成型的。", clientTurnId: nextClientTurnId() });
    mockAiReply("收到");
    mockSummary("塑膠射出成型；主力為汽車零件。", true);
    await caller.ai.chat({ message: "先這樣。", clientTurnId: nextClientTurnId() });

    const db = await getDb();
    const [before] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryA));
    expect(before).toBeTruthy();

    // Production Hardening Batch 2：owner 刪除改為軟刪除，不再物理刪除工廠列，
    // 所以 FK CASCADE 不會觸發——memory 跟工廠的其他歷史資料一樣保留。
    expect(await ownerSoftDeleteFactory(factoryA, ownerId)).toBe(true);

    const [factoryRow] = await db!.execute(sql`SELECT status, deletedAt FROM factories WHERE id = ${factoryA}`) as unknown as [{ status: string; deletedAt: Date | null }[], unknown];
    expect(factoryRow[0]).toMatchObject({ status: "delisted" });
    expect(factoryRow[0].deletedAt).not.toBeNull();

    const [after] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryA));
    expect(after?.summaryText).toBe("塑膠射出成型；主力為汽車零件。"); // 仍指向存在的工廠列，不是 orphan

    mockRunEnterpriseDiagnosis.mockClear();
    const denied = await caller.ai.chat({ message: "還記得嗎？", clientTurnId: nextClientTurnId() });
    expect(denied).toMatchObject({ status: "denied", reason: "no_factory" });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
  });
});
