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

const { appRouter } = await import("./routers");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `ai-conv-router-${userId}`, email: `ai-conv-router-${userId}@example.test`,
    name: "AI Conv Router Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
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

describe("ai.chat（登入使用者，Conversation = 當次互動暫存工作區）", () => {
  it("第一次對話沒有 conversationId 輸入也能成立，伺服器建立新的 conversation", async () => {
    mockAiReply("詢價的人變少，還是有詢價但沒成交？");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));

    const result = await caller.ai.chat({ message: "最近都沒什麼訂單。" });

    expect(result.conversationId).toBeTypeOf("number");
    expect(result.reply).toBe("詢價的人變少，還是有詢價但沒成交？");

    const active = await caller.ai.getActiveConversation();
    expect(active?.conversationId).toBe(result.conversationId);
  });

  it("client 帶著同一個 conversationId 延續同一段對話（模擬同頁面收合再打開）", async () => {
    mockAiReply("先問一題");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));
    const first = await caller.ai.chat({ message: "第一句" });

    mockAiReply("接得上");
    const second = await caller.ai.chat({ message: "第二句", conversationId: first.conversationId! });

    expect(second.conversationId).toBe(first.conversationId);
  });

  it("client 沒帶 conversationId（模擬 refresh／新的使用階段）：不會延續上一段，會建立新的一筆", async () => {
    mockAiReply("ok");
    const caller = appRouter.createCaller(ctxFor(await createTestUser()));
    const first = await caller.ai.chat({ message: "第一句" });

    mockAiReply("new session reply");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    const second = await caller.ai.chat({ message: "沒有帶 conversationId 的新訊息" });

    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it("新的使用階段開始時，會先把上一段殘留的 active 對話收尾：產生摘要寫進 Enterprise Memory，並刪除原文", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const caller = appRouter.createCaller(ctxFor(userId));
    const first = await caller.ai.chat({ message: "我是做銘板的，最近老客戶一直流失。" });

    mockAiReply("第二段回覆");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    const second = await caller.ai.chat({ message: "幫我找台中的 CNC 加工廠。" });

    expect(second.conversationId).not.toBe(first.conversationId);

    const db = await getDb();
    // 舊 conversation 已經被刪除，不留孤兒資料。
    const oldRows = await db!.select().from(aiConversations).where(eq(aiConversations.id, first.conversationId!));
    expect(oldRows).toHaveLength(0);

    // Enterprise Memory 正確寫入。
    const [memory] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.userId, userId));
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
  });

  it("CASE 1（merge 而非 blind overwrite）：第三段對話沒有新資訊時，不會洗掉第一段真正重要的企業記憶", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const caller = appRouter.createCaller(ctxFor(userId));
    const first = await caller.ai.chat({ message: "我是做銘板的，最近老客戶一直流失。" });

    mockAiReply("第二段回覆");
    mockSummary("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。", true);
    await caller.ai.chat({ message: "幫我找台中的 CNC 加工廠。" }); // 觸發收尾第一段，寫入真正的企業記憶

    mockAiReply("第三段回覆");
    mockSummary("本次未提供可形成企業判斷的關鍵資訊。", false); // 第三段只是「哈囉，沒事，先這樣」這類，這是「這次對話」自己的摘要
    await caller.ai.chat({ message: "哈囉，沒事，先這樣。" }); // 觸發收尾第二段

    const db = await getDb();
    const [memory] = await db!.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.userId, userId));
    // 核心斷言：第一段真正重要的企業資訊沒有被第二段「沒事」的對話洗掉。
    expect(memory?.summaryText).toBe("銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。");
    expect(memory?.hasMeaningfulBusinessInfo).toBe(true);
    // 但最近一次互動本身誠實記錄成沒有新資訊。
    expect(memory?.lastInteractionHadMeaningfulInfo).toBe(false);
  });

  it("摘要產生失敗時：舊 conversation 標記 failed、原文保留，新對話仍然正常建立、使用者不受影響", async () => {
    mockAiReply("第一段內容");
    const userId = await createTestUser();
    const caller = appRouter.createCaller(ctxFor(userId));
    const first = await caller.ai.chat({ message: "你好" });

    mockAiReply("第二段回覆");
    mockCompleteJson.mockRejectedValueOnce(new Error("LLM summary boom"));
    const second = await caller.ai.chat({ message: "新的一輪" });

    expect(second.conversationId).not.toBe(first.conversationId);
    expect(second.reply).toBe("第二段回覆"); // 使用者這一輪完全不受收尾失敗影響

    const db = await getDb();
    const [oldRow] = await db!.select().from(aiConversations).where(eq(aiConversations.id, first.conversationId!));
    expect(oldRow?.status).toBe("failed");
    expect(oldRow?.retryCount).toBe(1);
  });
});

describe("ai.chat — 權限：不能用別人的 conversationId 續聊別人的對話", () => {
  it("attacker 帶著 victim 的 conversationId，只會被當成沒帶處理，attacker 拿到自己全新的 conversation，victim 的對話不受影響", async () => {
    mockAiReply("victim's reply");
    const victimCaller = appRouter.createCaller(ctxFor(await createTestUser()));
    const victimResult = await victimCaller.ai.chat({ message: "victim's message" });

    mockAiReply("attacker's reply");
    const attackerCaller = appRouter.createCaller(ctxFor(await createTestUser()));
    const attackerResult = await attackerCaller.ai.chat({
      message: "attacker trying to hijack",
      conversationId: victimResult.conversationId!,
    });

    expect(attackerResult.conversationId).not.toBe(victimResult.conversationId);

    // victim 的對話完全沒被動過（沒有被 attacker 的訊息汙染，也沒有被收尾）。
    const db = await getDb();
    const [victimRow] = await db!.select().from(aiConversations).where(eq(aiConversations.id, victimResult.conversationId!));
    expect(victimRow?.status).toBe("active");
  });
});

describe("ai.chat — 訪客路徑不受影響", () => {
  it("未登入使用者呼叫不會建立任何 conversation（conversationId 回傳 null）", async () => {
    mockAiReply("guest reply");
    const result = await appRouter.createCaller(guestCtx()).ai.chat({ message: "hi" });
    expect(result.conversationId).toBeNull();
  });
});
