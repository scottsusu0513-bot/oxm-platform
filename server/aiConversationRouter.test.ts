/**
 * ai.chat / ai.getActiveConversation 的路由層整合測試——走真實本機測試資料庫
 * （受 server/test-db-guard.ts 保護），用 appRouter.createCaller(ctx) 直接
 * 呼叫 tRPC procedure。diagnosis.ts／routing.ts／memory.ts 的
 * generateConversationSummary 整層 mock 掉（不打真實 OpenAI API），只驗證
 * conversation 的建立/延續/收尾/權限邏輯。
 */
import { describe, expect, it, vi, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "./db";
import { aiConversations, aiEnterpriseMemories } from "../drizzle/schema";
import { getTaipeiQuotaDate } from "./ai/taipeiTime";
import { AI_FACTORY_DAILY_TURN_LIMIT } from "../shared/ai/aiQuotaConfig";
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

// 不能直接 mock "./ai/memory" 的 generateConversationSummary：
// endConversationAndSummarize 在同一個檔案內直接呼叫它（同模組內部參照），
// vitest 的 vi.mock 只能攔截「跨模組匯入」的呼叫，攔截不到同檔案內部呼叫，
// mock 了也不會生效（曾經在這裡踩過這個坑，實際打了真實 OpenAI API）。改成
// mock 更底層、真正跨模組邊界的 "./ai/provider"，generateConversationSummary
// 透過 getAiChatProvider() 呼叫它，這一層一定會被正確攔截。
const mockCompleteJson = vi.fn();
vi.mock("./ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/provider")>();
  return { ...actual, getAiChatProvider: () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }) };
});

// Phase 13.0.1（見對話「二、四」）：這個檔案整份測的是 conversation 建立/延續
// /收尾/權限這些「AI 已正式開放」前提下才有意義的行為，不是 Coming Soon 本身
// ——Coming Soon 短路發生在 ai.chat 最前面，早於這裡要測的 entitlement／
// conversation 邏輯，兩者互斥。file-level 明確 opt-in "live"：上面幾行
// static import（getDb／financeTestFixtures 等）已經把 env.ts 用預設值
// hoist-評估過一次，所以光設 process.env 不夠，需要跟
// server/aiKillSwitchRouter.test.ts 的 K1-K3 同一招——vi.resetModules() 讓
// env.ts／routers.ts 用這裡設定的 "live" 重新求值一次，afterAll 還原，避免
// 污染同 worker 內其他測試檔案。
const ORIGINAL_AI_RELEASE_MODE = process.env.OXM_AI_RELEASE_MODE;
process.env.OXM_AI_RELEASE_MODE = "live";
vi.resetModules();

const { appRouter } = await import("./routers");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// Phase 8.2（見對話中 Phase 8.1 entitlement 上線後的回歸修正）：這個檔案測的
// 是 conversation 建立/延續/收尾/權限邏輯本身，跟「這個使用者有沒有資格用
// AI」是兩件事——用 isAdmin: true 讓這裡的測試使用者直接 bypass
// entitlement／quota 門檔（admin 不需要 factory 身分），不必為每個測試都建
// 一間 approved 工廠 fixture，也不會把兩種完全不同的關注點混在同一份測試
// 意圖裡。guest 路徑的專屬行為改到 entitlement 檔案測（見下方 guest 測試
// 已更新為驗證 status:"denied"）。
function ctxFor(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `ai-conv-router-${userId}`, email: `ai-conv-router-${userId}@example.test`,
    name: "AI Conv Router Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: true,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

// Phase 8.2：clientTurnId 現在是必填欄位（見對話中「五：P0 retry 去重」），
// 這個檔案測的是不同 turn 之間的行為（不是同一 turn 的 retry），每次呼叫都
// 給一個全新、彼此不同的值即可。
let clientTurnIdSeq = 0;
function nextClientTurnId(): string {
  clientTurnIdSeq += 1;
  return `ai-conv-router-turn-${clientTurnIdSeq}`;
}

// Phase 11.2（見「一、正式架構決策」）：Enterprise Memory 現在是
// factory-scoped，只有 approved 工廠身分才可能有 memory 讀寫——這裡另外提供
// 一個「approved 工廠 owner、非 admin」的 ctx，給真的需要驗證 Enterprise
// Memory 寫入行為的測試使用（跟上面 ctxFor 的 admin／無工廠 ctx 分開，避免
// 混淆兩種完全不同的關注點）。
function ctxForFactoryOwner(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `ai-conv-router-owner-${userId}`, email: `ai-conv-router-owner-${userId}@example.test`,
    name: "AI Conv Router Factory Owner Test", loginMethod: "manus", role: "user", isFactoryOwner: true,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: false,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function guestCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const runId = `ai-conv-router-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let userSeq = 0;

// 每個需要「乾淨、還沒有 active conversation」狀態的測試都呼叫這個建立一個
// 全新使用者，避免同一個 userId 的殘留對話汙染到下一個測試。
async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AI Conv Router ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
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

afterAll(async () => {
  const conn = await getDb();
  if (!conn || createdUserIds.length === 0) return;
  await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
});

afterAll(() => {
  if (ORIGINAL_AI_RELEASE_MODE === undefined) delete process.env.OXM_AI_RELEASE_MODE;
  else process.env.OXM_AI_RELEASE_MODE = ORIGINAL_AI_RELEASE_MODE;
});

describe("ai.chat（登入使用者，Conversation = 當次互動暫存工作區）", () => {
  it("第一次對話沒有 conversationId 輸入也能成立，伺服器建立新的 conversation", async () => {
    mockAiReply("詢價的人變少，還是有詢價但沒成交？");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));

    const result = await caller.ai.chat({ message: "最近都沒什麼訂單。", clientTurnId: nextClientTurnId() });

    expect(result.conversationId).toBeTypeOf("number");
    expect(result.reply).toBe("詢價的人變少，還是有詢價但沒成交？");

    const active = await caller.ai.getActiveConversation();
    expect(active?.conversationId).toBe(result.conversationId);
  });

  it("client 帶著同一個 conversationId 延續同一段對話（模擬同頁面收合再打開）", async () => {
    mockAiReply("先問一題");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));
    const first = await caller.ai.chat({ message: "第一句", clientTurnId: nextClientTurnId() });

    mockAiReply("接得上");
    const second = await caller.ai.chat({ message: "第二句", conversationId: first.conversationId!, clientTurnId: nextClientTurnId() });

    expect(second.conversationId).toBe(first.conversationId);
  });

  it("client 沒帶 conversationId（模擬 refresh／新的使用階段）：不會延續上一段，會建立新的一筆", async () => {
    mockAiReply("ok");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));
    const first = await caller.ai.chat({ message: "第一句", clientTurnId: nextClientTurnId() });

    mockAiReply("new session reply");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    const second = await caller.ai.chat({ message: "沒有帶 conversationId 的新訊息", clientTurnId: nextClientTurnId() });

    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it("新的使用階段開始時，會先把上一段殘留的 active 對話收尾：產生摘要寫進 Enterprise Memory，並刪除原文（Phase 11.2：factory-scoped，需要 approved 工廠身分）", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const factoryId = await createTestFactory(userId, `[AI_CONV_ROUTER_TEST] Factory ${userId}`);
    const caller = appRouter.createCaller(ctxForFactoryOwner(userId));
    const first = await caller.ai.chat({ message: "我是做銘板的，最近老客戶一直流失。", clientTurnId: nextClientTurnId() });

    mockAiReply("第二段回覆");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    const second = await caller.ai.chat({ message: "幫我找台中的 CNC 加工廠。", clientTurnId: nextClientTurnId() });

    expect(second.conversationId).not.toBe(first.conversationId);

    const db = await getDb();
    // 舊 conversation 已經被刪除，不留孤兒資料。
    const oldRows = await db!.select().from(aiConversations).where(eq(aiConversations.id, first.conversationId!));
    expect(oldRows).toHaveLength(0);

    // Enterprise Memory 正確寫入，key 是 factoryId（不是 userId）。
    const [memory] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryId));
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
    expect(memory?.lastActorUserId).toBe(userId);

    await deleteTestFactory(factoryId);
  });

  it("CASE 1（merge 而非 blind overwrite）：第三段對話沒有新資訊時，不會洗掉第一段真正重要的企業記憶（Phase 11.2：factory-scoped）", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const factoryId = await createTestFactory(userId, `[AI_CONV_ROUTER_TEST] Factory ${userId}`);
    const caller = appRouter.createCaller(ctxForFactoryOwner(userId));
    await caller.ai.chat({ message: "我是做銘板的，最近老客戶一直流失。", clientTurnId: nextClientTurnId() });

    mockAiReply("第二段回覆");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    await caller.ai.chat({ message: "幫我找台中的 CNC 加工廠。", clientTurnId: nextClientTurnId() }); // 觸發收尾第一段，寫入真正的企業記憶

    mockAiReply("第三段回覆");
    mockSummary("本次未提供可形成企業判斷的關鍵資訊。", false); // 第三段只是「哈囉，沒事，先這樣」這類，這是「這次對話」自己的摘要
    await caller.ai.chat({ message: "哈囉，沒事，先這樣。", clientTurnId: nextClientTurnId() }); // 觸發收尾第二段

    const db = await getDb();
    const [memory] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryId));
    // 核心斷言：第一段真正重要的企業資訊沒有被第二段「沒事」的對話洗掉。
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
    // 但最近一次互動本身誠實記錄成沒有新資訊。
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(false);

    await deleteTestFactory(factoryId);
  });

  it("Phase 11.2「五、三十七」：Admin 沒有 approved 工廠——新的使用階段收尾上一段對話時，完全不寫入 Enterprise Memory", async () => {
    mockAiReply("admin 第一段內容");
    const userId = await createTestUser();
    const caller = appRouter.createCaller(ctxFor(userId)); // isAdmin: true，未建立任何工廠
    await caller.ai.chat({ message: "我是 admin，這裡完全沒有工廠 context。", clientTurnId: nextClientTurnId() });

    mockCompleteJson.mockClear(); // 之前其他測試案例可能已經呼叫過，先歸零才能準確驗證「這次收尾完全不呼叫」。
    mockAiReply("admin 第二段回覆");
    const second = await caller.ai.chat({ message: "新的使用階段，觸發上一段收尾。", clientTurnId: nextClientTurnId() });
    expect(second.reply).toBe("admin 第二段回覆");
    expect(mockCompleteJson).not.toHaveBeenCalled(); // 完全不呼叫摘要模型，不燒 API 成本

    const db = await getDb();
    const memoryRows = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.lastActorUserId, userId));
    expect(memoryRows).toHaveLength(0);
  });

  it("摘要產生失敗時：舊 conversation 標記 failed、原文保留，新對話仍然正常建立、使用者不受影響（Phase 11.2：summary 只有 approved 工廠 context 才會被呼叫，這裡用 approved 工廠 owner）", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const factoryId = await createTestFactory(userId, `[AI_CONV_ROUTER_TEST] Factory ${userId}`);
    const caller = appRouter.createCaller(ctxForFactoryOwner(userId));
    const first = await caller.ai.chat({ message: "你好", clientTurnId: nextClientTurnId() });

    mockAiReply("第二段回覆");
    mockCompleteJson.mockRejectedValueOnce(new Error("LLM summary boom"));
    const second = await caller.ai.chat({ message: "新的一輪", clientTurnId: nextClientTurnId() });

    expect(second.conversationId).not.toBe(first.conversationId);
    expect(second.reply).toBe("第二段回覆"); // 使用者這一輪完全不受收尾失敗影響

    const db = await getDb();
    const [oldRow] = await db!.select().from(aiConversations).where(eq(aiConversations.id, first.conversationId!));
    expect(oldRow?.status).toBe("failed");
    expect(oldRow?.retryCount).toBe(1);

    await deleteTestFactory(factoryId);
  });
});

describe("ai.chat — 權限：不能用別人的 conversationId 續聊別人的對話", () => {
  it("attacker 帶著 victim 的 conversationId，只會被當成沒帶處理，attacker 拿到自己全新的 conversation，victim 的對話不受影響", async () => {
    mockAiReply("victim's reply");
    const victimCaller = appRouter.createCaller(ctxFor(await createTestUser()));
    const victimResult = await victimCaller.ai.chat({ message: "victim's message", clientTurnId: nextClientTurnId() });

    mockAiReply("attacker's reply");
    const attackerCaller = appRouter.createCaller(ctxFor(await createTestUser()));
    const attackerResult = await attackerCaller.ai.chat({
      message: "attacker trying to hijack",
      conversationId: victimResult.conversationId!,
      clientTurnId: nextClientTurnId(),
    });

    expect(attackerResult.conversationId).not.toBe(victimResult.conversationId);

    // victim 的對話完全沒被動過（沒有被 attacker 的訊息汙染，也沒有被收尾）。
    const db = await getDb();
    const [victimRow] = await db!.select().from(aiConversations).where(eq(aiConversations.id, victimResult.conversationId!));
    expect(victimRow?.status).toBe("active");
  });
});

// Phase 8.2（見對話中「一：guest 完全不可用 AI」＋「三十七、三十八：guest／
// no_factory／quota_exhausted 必須是 deterministic product state，不是
// generic 403」）：Phase 8.1 上線後，訪客已經不再是「無狀態但仍可用」，而是
// 在觸碰任何 AI 邏輯之前就被 entitlement gate 擋下——這裡直接驗證
// status:"denied"／reason:"guest"，且完全沒有呼叫 mockRunEnterpriseDiagnosis
// （不會先跑 Diagnosis 再擋，見「十」）、也沒有建立任何 conversation。
describe("ai.chat — entitlement gate（Phase 8.2：H11／H12／三十七／三十八）", () => {
  it("guest：回傳 status=denied/reason=guest，不建立 conversation，不呼叫任何 LLM", async () => {
    mockRunEnterpriseDiagnosis.mockClear();
    mockRunOxmRouting.mockClear();
    const result = await appRouter.createCaller(guestCtx()).ai.chat({ message: "hi", clientTurnId: nextClientTurnId() });
    expect(result).toEqual({ status: "denied", reason: "guest" });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
    expect(mockRunOxmRouting).not.toHaveBeenCalled();
  });

  it("已登入但沒有已核准工廠身分：回傳 status=denied/reason=no_factory，不呼叫任何 LLM", async () => {
    mockRunEnterpriseDiagnosis.mockClear();
    mockRunOxmRouting.mockClear();
    const userId = await createTestUser();
    // 這個 caller 刻意不用 ctxFor（isAdmin: true），改用一個既非 admin、也沒有
    // 工廠身分的普通使用者 ctx，驗證 no_factory 這條路徑本身。
    const plainUser: AuthenticatedUser = {
      id: userId, openId: `ai-conv-router-plain-${userId}`, email: `ai-conv-router-plain-${userId}@example.test`,
      name: "Plain User", loginMethod: "manus", role: "user", isFactoryOwner: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      isAdmin: false,
    } as AuthenticatedUser;
    const ctx: TrpcContext = { user: plainUser, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
    const result = await appRouter.createCaller(ctx).ai.chat({ message: "hi", clientTurnId: nextClientTurnId() });
    expect(result).toEqual({ status: "denied", reason: "no_factory" });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
    expect(mockRunOxmRouting).not.toHaveBeenCalled();
  });

  it("H11：已核准工廠當日額度用滿（20/20）：回傳 status=denied/reason=quota_exhausted，完全不呼叫任何 LLM（不能先扣成本才擋）", async () => {
    mockRunEnterpriseDiagnosis.mockClear();
    mockRunOxmRouting.mockClear();
    const db = await getDb();
    if (!db) throw new Error("no db");
    const userId = await createTestUser();
    const [factoryResult] = await db.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${userId}, ${`[H11_TEST] Factory ${userId}`}, ${JSON.stringify(["電子"])}, ${JSON.stringify(["ODM"])}, '新竹市', '<1000萬', '新竹市', 'approved', 'normal', FALSE, '[]', NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    const factoryId = factoryResult.insertId;
    const quotaDate = getTaipeiQuotaDate();
    await db.execute(sql`
      INSERT INTO factoryAiDailyUsage (factoryId, quotaDate, usedTurns) VALUES (${factoryId}, ${quotaDate}, ${AI_FACTORY_DAILY_TURN_LIMIT})
    `);

    const plainUser: AuthenticatedUser = {
      id: userId, openId: `ai-conv-router-quota-${userId}`, email: `ai-conv-router-quota-${userId}@example.test`,
      name: "Quota Exhausted Owner", loginMethod: "manus", role: "user", isFactoryOwner: true,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      isAdmin: false,
    } as AuthenticatedUser;
    const ctx: TrpcContext = { user: plainUser, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };

    const result = await appRouter.createCaller(ctx).ai.chat({ message: "hi", clientTurnId: nextClientTurnId() });
    expect(result.status).toBe("denied");
    if (result.status === "denied" && result.reason === "quota_exhausted") {
      expect(result.quota.exhausted).toBe(true);
      expect(result.quota.remaining).toBe(0);
    } else {
      throw new Error(`expected quota_exhausted, got ${JSON.stringify(result)}`);
    }
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
    expect(mockRunOxmRouting).not.toHaveBeenCalled();

    await db.execute(sql`DELETE FROM factoryAiDailyUsage WHERE factoryId = ${factoryId}`);
    await db.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  });
});
