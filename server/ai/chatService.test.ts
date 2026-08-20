/**
 * chatService.ts 編排邏輯驗證：不打真實 OpenAI API、不連真實 DB，
 * diagnosis.ts／routing.ts／factoryContext.ts／contextBuilder.ts／
 * conversationState.ts／conversationService.ts／memory.ts 全部 mock 掉。
 *
 * runAiChat()（無狀態路徑，訪客與測試腳本用）：
 * 1. 依序呼叫 Layer 1（diagnosis）再呼叫 Layer 2（routing），把 diagnosis
 *    結果正確傳給 routing。
 * 2. userId 有值時才查企業 context，並且同一份 context 同時給 Layer 1 與
 *    Layer 2。
 * 3. 回傳 routing 的 finalReply。
 * 4. Layer 2（routing）失敗時，不讓整輪對話直接報錯，改用 Layer 1 的內容
 *    組一句安全的 fallback 回覆。
 *
 * runPersistentAiChat()（登入使用者路徑，Conversation = 當次互動暫存工作
 * 區）：
 * 5. client 帶了合法（本人擁有、仍 active）的 conversationId → 直接延續，
 *    不觸發任何收尾。
 * 6. client 沒帶 conversationId（新的使用階段）、且這個使用者名下有殘留的
 *    active 對話 → 先呼叫 endConversationAndSummarize 收尾，再建立新的一筆。
 * 7. client 沒帶 conversationId、也沒有殘留的 active 對話 → 直接建立新的
 *    一筆，不呼叫 endConversationAndSummarize。
 * 8. 每一輪都會查 Enterprise Memory 並傳給 Layer 1。
 * 9. Layer 2 失敗時的 fallback 邏輯與無狀態路徑一致，且仍會更新 state 與寫入
 *    assistant message（不會讓對話卡住）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EnterpriseDiagnosis } from "./diagnosis";

const mockRunEnterpriseDiagnosis = vi.fn();
vi.mock("./diagnosis", () => ({
  runEnterpriseDiagnosis: (...args: unknown[]) => mockRunEnterpriseDiagnosis(...args),
}));

const mockRunOxmRouting = vi.fn();
vi.mock("./routing", () => ({
  runOxmRouting: (...args: unknown[]) => mockRunOxmRouting(...args),
}));

const mockGetAiFactoryContext = vi.fn();
const mockResolveApprovedAiFactoryContext = vi.fn();
vi.mock("./factoryContext", () => ({
  getAiFactoryContext: (...args: unknown[]) => mockGetAiFactoryContext(...args),
  resolveApprovedAiFactoryContext: (...args: unknown[]) => mockResolveApprovedAiFactoryContext(...args),
}));

const mockBuildTurnContext = vi.fn();
vi.mock("./contextBuilder", () => ({
  buildTurnContext: (...args: unknown[]) => mockBuildTurnContext(...args),
}));

const mockGetActiveConversationForUser = vi.fn();
const mockGetConversationForUser = vi.fn();
const mockCreateConversation = vi.fn();
const mockAppendMessage = vi.fn();
const mockUpdateConversationState = vi.fn();
// Phase 10.2 P1（見「十七」）：chatService.ts 收尾時已經改呼叫合併後的
// updateConversationStateAndAppendMessage（一個小交易），不再分開呼叫
// updateConversationState／appendMessage 兩次——這裡讓 mock 版本內部照樣轉呼叫
// 既有的 mockUpdateConversationState／mockAppendMessage，維持這個檔案原本
// 「驗證 chatService 有沒有用正確的 conversationId／state／role/content 呼叫
// 收尾邏輯」的測試意圖不變，不需要改寫底下每一個既有斷言。交易本身的原子性
// 由 conversationService.test.ts 用真實 DB 驗證，不在這裡（mock 層）重複。
const mockUpdateConversationStateAndAppendMessage = vi.fn();
vi.mock("./conversationService", () => ({
  getActiveConversationForUser: (...args: unknown[]) => mockGetActiveConversationForUser(...args),
  getConversationForUser: (...args: unknown[]) => mockGetConversationForUser(...args),
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  appendMessage: (...args: unknown[]) => mockAppendMessage(...args),
  updateConversationState: (...args: unknown[]) => mockUpdateConversationState(...args),
  updateConversationStateAndAppendMessage: (...args: unknown[]) => mockUpdateConversationStateAndAppendMessage(...args),
}));

const mockGetEnterpriseMemory = vi.fn();
const mockEndConversationAndSummarize = vi.fn();
vi.mock("./memory", () => ({
  getEnterpriseMemory: (...args: unknown[]) => mockGetEnterpriseMemory(...args),
  endConversationAndSummarize: (...args: unknown[]) => mockEndConversationAndSummarize(...args),
}));

// Phase 6A：找工廠 action 本身有自己專門的測試（factorySearchAction.test.ts），
// 這裡只驗證「Layer 2 判斷 primaryService==="factory_search" 時，chatService
// 有沒有呼叫它、並把結果原樣放進回傳值」的編排邏輯本身，不需要真的連 DB／
// 呼叫 semantic-search——mock 掉，維持這個檔案本來就宣告的「不連真實 DB」。
const mockRunFactorySearchAction = vi.fn();
vi.mock("./factorySearchAction", () => ({
  runFactorySearchAction: (...args: unknown[]) => mockRunFactorySearchAction(...args),
}));

// Phase 6B：AI 找消息——同上，自己有專門的測試（newsSearchAction.test.ts），
// 這裡只驗證 chatService 有沒有在正確時機呼叫它。
const mockRunNewsSearchAction = vi.fn();
vi.mock("./newsSearchAction", () => ({
  runNewsSearchAction: (...args: unknown[]) => mockRunNewsSearchAction(...args),
}));

// Phase 6C：AI 讀取政府補助方案——同上，自己有專門的測試
// （subsidyProgramsAction.test.ts），這裡只驗證 chatService 有沒有在正確時機
// 呼叫它。
const mockRunSubsidyProgramsAction = vi.fn();
vi.mock("./subsidyProgramsAction", () => ({
  runSubsidyProgramsAction: (...args: unknown[]) => mockRunSubsidyProgramsAction(...args),
}));

// Phase 6A.1／Action Registry：人工協尋 request 的 lifecycle 邏輯有自己專門的
// 測試（factorySearchRequestService.test.ts），這裡只驗證 chatService 有沒有
// 在正確的時機呼叫它、並把結果放進回傳值——維持這個檔案「不連真實 DB」的宣告。
const mockGetPendingFactorySearchRequestForConversation = vi.fn();
const mockCancelFactorySearchRequestForConversation = vi.fn();
const mockApplyFactorySourcingDecision = vi.fn();
const mockResolvePendingRequestIfSuperseded = vi.fn();
vi.mock("./factorySearchRequestService", () => ({
  getPendingFactorySearchRequestForConversation: (...args: unknown[]) => mockGetPendingFactorySearchRequestForConversation(...args),
  cancelFactorySearchRequestForConversation: (...args: unknown[]) => mockCancelFactorySearchRequestForConversation(...args),
  applyFactorySourcingDecision: (...args: unknown[]) => mockApplyFactorySourcingDecision(...args),
  resolvePendingRequestIfSuperseded: (...args: unknown[]) => mockResolvePendingRequestIfSuperseded(...args),
}));

// AI Action Planner 也有自己專門的測試（actionPlanner.test.ts），這裡只驗證
// chatService 有沒有在正確時機呼叫它、並依它的決定分派對應的執行函式。
const mockPlanNextOxmAction = vi.fn();
vi.mock("./actionPlanner", () => ({
  planNextOxmAction: (...args: unknown[]) => mockPlanNextOxmAction(...args),
}));

// Final Response Composer 也有自己專門的測試（responseComposer.test.ts），
// 這裡只驗證 chatService 有沒有在正確時機呼叫它、並把它的輸出當成這一輪真正
// 的 finalReply（見「OXM AI 已完成功能整體驗收修正」十一）。
const mockComposeFinalResponse = vi.fn();
vi.mock("./responseComposer", () => ({
  composeFinalResponse: (...args: unknown[]) => mockComposeFinalResponse(...args),
}));

// 見對話中「非 OXM 純閒聊收斂機制」二階段設計：casualPauseGate 自己有專門的
// 測試（casualPauseGate.test.ts），這裡只驗證 chatService 有沒有在
// warned／paused 狀態下正確呼叫它、並依它的判斷跳過或恢復完整 pipeline。
const mockCheckOutOfDomainResumeRelevance = vi.fn();
vi.mock("./casualPauseGate", () => ({
  checkOutOfDomainResumeRelevance: (...args: unknown[]) => mockCheckOutOfDomainResumeRelevance(...args),
}));

import { runAiChat, runPersistentAiChat } from "./chatService";
import { createEmptyConversationState } from "./conversationState";

const BASE_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "business_exploration",
  casualTurnDomainRelevant: true,
  observedProblem: "最近訂單變少",
  likelyBottleneck: null,
  bottleneckStatus: "unclear",
  evidence: [],
  alternativeHypotheses: [],
  secondaryConcern: null,
  recommendedBusinessDirection: null,
  nextBestQuestion: "詢價的人變少，還是有詢價但沒成交？",
  shouldStopQuestioning: false,
  userWantsAction: false,
  confirmedFacts: {},
};

describe("runAiChat 編排", () => {
  beforeEach(() => {
    mockRunEnterpriseDiagnosis.mockReset();
    mockRunOxmRouting.mockReset();
    mockGetAiFactoryContext.mockReset();
  });

  it("依序呼叫 Layer 1 再呼叫 Layer 2，把 diagnosis 結果傳給 routing，回傳 finalReply", async () => {
    mockGetAiFactoryContext.mockResolvedValue(null);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({
      primaryService: null,
      secondaryService: null,
      relationship: null,
      serviceFitReason: "",
      shouldOfferHandoff: false,
      finalReply: "詢價的人變少，還是有詢價但沒成交？",
    });

    const result = await runAiChat({ userId: null, history: [{ role: "user", content: "最近訂單變少" }] });

    expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
    expect(mockRunOxmRouting).toHaveBeenCalledTimes(1);
    expect(mockRunOxmRouting.mock.calls[0][0].diagnosis).toBe(BASE_DIAGNOSIS);
    expect(result.reply).toBe("詢價的人變少，還是有詢價但沒成交？");
    expect(result.factorySearchResult).toBeNull();
  });

  it("userId 有值：查一次企業 context，Layer 1 與 Layer 2 都拿到同一份", async () => {
    const ctx = { companyName: "測試工廠" } as any;
    mockGetAiFactoryContext.mockResolvedValue(ctx);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({
      primaryService: null,
      secondaryService: null,
      relationship: null,
      serviceFitReason: "",
      shouldOfferHandoff: false,
      finalReply: "ok",
    });

    await runAiChat({ userId: 42, history: [{ role: "user", content: "hi" }] });

    expect(mockGetAiFactoryContext).toHaveBeenCalledWith(42);
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].factoryContext).toBe(ctx);
    expect(mockRunOxmRouting.mock.calls[0][0].factoryContext).toBe(ctx);
  });

  it("userId 是 null：不查企業 context", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({
      primaryService: null,
      secondaryService: null,
      relationship: null,
      serviceFitReason: "",
      shouldOfferHandoff: false,
      finalReply: "ok",
    });

    await runAiChat({ userId: null, history: [{ role: "user", content: "hi" }] });

    expect(mockGetAiFactoryContext).not.toHaveBeenCalled();
  });

  it("Layer 2 失敗時：不拋錯，改用 diagnosis.nextBestQuestion 當 fallback 回覆", async () => {
    mockGetAiFactoryContext.mockResolvedValue(null);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockRejectedValue(new Error("routing boom"));

    const result = await runAiChat({ userId: null, history: [{ role: "user", content: "最近訂單變少" }] });

    expect(result.reply).toBe(BASE_DIAGNOSIS.nextBestQuestion);
    expect(result.factorySearchResult).toBeNull();
  });

  it("Layer 2 失敗、且 diagnosis 沒有 nextBestQuestion 時：改用 recommendedBusinessDirection", async () => {
    mockGetAiFactoryContext.mockResolvedValue(null);
    mockRunEnterpriseDiagnosis.mockResolvedValue({
      ...BASE_DIAGNOSIS,
      nextBestQuestion: null,
      recommendedBusinessDirection: "先處理成本結構",
    });
    mockRunOxmRouting.mockRejectedValue(new Error("routing boom"));

    const result = await runAiChat({ userId: null, history: [{ role: "user", content: "hi" }] });

    expect(result.reply).toBe("先處理成本結構");
    expect(result.factorySearchResult).toBeNull();
  });

  it("Layer 1 失敗時：直接往上拋錯（router 端已有統一錯誤處理，不在這裡吞掉）", async () => {
    mockGetAiFactoryContext.mockResolvedValue(null);
    mockRunEnterpriseDiagnosis.mockRejectedValue(new Error("diagnosis boom"));

    await expect(runAiChat({ userId: null, history: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      "diagnosis boom"
    );
    expect(mockRunOxmRouting).not.toHaveBeenCalled();
  });
});

describe("runPersistentAiChat 編排", () => {
  const NEW_CONVERSATION = { id: 101, userId: 42, factoryId: null, currentStateJson: null, status: "active" } as any;
  const CLIENT_HELD_CONVERSATION = { id: 55, userId: 42, factoryId: null, currentStateJson: null, status: "active" } as any;
  const ORPHANED_CONVERSATION = { id: 9, userId: 42, factoryId: null, currentStateJson: null, status: "active" } as any;
  const BASE_ROUTING = {
    primaryService: null,
    secondaryService: null,
    relationship: null,
    serviceFitReason: "",
    shouldOfferHandoff: false,
    finalReply: "詢價的人變少，還是有詢價但沒成交？",
    resourceTarget: "none" as const,
    factorySourcingContextRelevant: false,
    factoryResultAnalysisRequest: false,
    newsSearchContextRelevant: false,
    govSubsidyLookupRelevant: false,
    navigationTarget: null,
    platformHelpTarget: null,
    serviceTargets: [] as string[],
  };

  beforeEach(() => {
    mockRunEnterpriseDiagnosis.mockReset();
    mockRunOxmRouting.mockReset();
    mockResolveApprovedAiFactoryContext.mockReset();
    mockBuildTurnContext.mockReset();
    mockGetActiveConversationForUser.mockReset();
    mockGetConversationForUser.mockReset();
    mockCreateConversation.mockReset();
    mockAppendMessage.mockReset();
    mockUpdateConversationState.mockReset();
    mockUpdateConversationStateAndAppendMessage.mockReset();
    mockGetEnterpriseMemory.mockReset();
    mockEndConversationAndSummarize.mockReset();
    mockRunFactorySearchAction.mockReset();
    mockRunNewsSearchAction.mockReset();
    mockRunSubsidyProgramsAction.mockReset();
    mockGetPendingFactorySearchRequestForConversation.mockReset();
    mockCancelFactorySearchRequestForConversation.mockReset();
    mockApplyFactorySourcingDecision.mockReset();
    mockResolvePendingRequestIfSuperseded.mockReset();
    mockPlanNextOxmAction.mockReset();
    mockComposeFinalResponse.mockReset();
    mockCheckOutOfDomainResumeRelevance.mockReset();

    mockResolveApprovedAiFactoryContext.mockResolvedValue(null);
    mockGetPendingFactorySearchRequestForConversation.mockResolvedValue(null);
    mockPlanNextOxmAction.mockResolvedValue({ action: "none", reason: "", reasonCategory: "other", actionPayload: { requestedCapabilities: [], requestedCount: null } });
    mockComposeFinalResponse.mockResolvedValue("目前搜尋到的狀況是這樣。");
    mockGetActiveConversationForUser.mockResolvedValue(undefined);
    mockCreateConversation.mockResolvedValue(NEW_CONVERSATION);
    mockBuildTurnContext.mockResolvedValue({
      history: [{ role: "user", content: "最近訂單變少" }],
      previousState: null,
    });
    mockAppendMessage.mockResolvedValue(undefined);
    mockUpdateConversationState.mockResolvedValue(undefined);
    mockUpdateConversationStateAndAppendMessage.mockImplementation(
      async (conversationId: number, state: unknown, role: string, content: string) => {
        await mockUpdateConversationState(conversationId, state);
        await mockAppendMessage(conversationId, role, content);
      }
    );
    mockGetEnterpriseMemory.mockResolvedValue(null);
    mockEndConversationAndSummarize.mockResolvedValue({ success: true });
  });

  it("沒有帶 conversationId、也沒有殘留 active 對話：直接建立新的一筆，不觸發收尾", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    const result = await runPersistentAiChat({ userId: 42, message: "最近訂單變少" });

    expect(mockGetActiveConversationForUser).toHaveBeenCalledWith(42);
    expect(mockEndConversationAndSummarize).not.toHaveBeenCalled();
    expect(mockCreateConversation).toHaveBeenCalledWith(42, null);
    // user message 必須在組 context 之前就寫入，這樣 context builder 讀到的
    // 最近訊息才會包含這一句。
    const appendUserCallIndex = mockAppendMessage.mock.calls.findIndex(c => c[1] === "user");
    const buildContextCallOrder = mockBuildTurnContext.mock.invocationCallOrder[0];
    expect(mockAppendMessage.mock.invocationCallOrder[appendUserCallIndex]).toBeLessThan(buildContextCallOrder);
    expect(mockAppendMessage).toHaveBeenCalledWith(101, "user", "最近訂單變少");
    expect(mockAppendMessage).toHaveBeenCalledWith(101, "assistant", BASE_ROUTING.finalReply);
    expect(mockUpdateConversationState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      reply: BASE_ROUTING.finalReply,
      conversationId: 101,
      handoffOffer: null,
      factorySearchResult: null,
      newsSearchResult: null,
      subsidyProgramsResult: null,
      navigationAction: null,
      manualSourcing: null,
      govSubsidyRecommendation: null,
      factoryResultBoundary: false,
    });
  });

  it("Phase 4：shouldOfferHandoff=true 且 primaryService 是本輪支援的 5 個服務之一 → handoffOffer 有值", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "erp", shouldOfferHandoff: true });

    const result = await runPersistentAiChat({ userId: 42, message: "我確定想導 ERP" });

    expect(result.handoffOffer).toEqual({ serviceKey: "erp", displayName: "ERP 與產線優化" });
  });

  it("Phase 4：shouldOfferHandoff=true 但 primaryService 是找工廠（本輪不走 handoff CTA）→ handoffOffer 仍是 null", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "factory_search", shouldOfferHandoff: true });
    const fakeSearchResult = {
      candidates: [], total: 0, zeroResult: true,
      appliedFilters: { mainIndustries: [], regions: [], rankingSignals: [] },
      hasExplicitCapabilityMatch: false, directCapabilityMatchCount: 0, missingCoreCapabilities: [],
      viewAllUrl: "/search",
    };
    mockRunFactorySearchAction.mockResolvedValue(fakeSearchResult);
    mockPlanNextOxmAction.mockResolvedValue({ action: "none", reason: "x", reasonCategory: "other", actionPayload: { requestedCapabilities: [], requestedCount: null } });
    mockComposeFinalResponse.mockResolvedValue("目前這組條件平台上還沒有符合的工廠。");

    const result = await runPersistentAiChat({ userId: 42, message: "幫我找台中的 CNC 廠" });

    expect(result.handoffOffer).toBeNull();
    // Tool Result 與 Assistant Response 分離（見「十一」）：這輪 Composer 有
    // 跑，最終顯示給使用者的 reply 必須是它的輸出，不是 routing.finalReply
    // （那句只是內部組裝過程的中繼值，不是這輪真正要顯示的文字）。
    expect(result.reply).toBe("目前這組條件平台上還沒有符合的工廠。");
    expect(mockComposeFinalResponse).toHaveBeenCalledTimes(1);
    // Phase 6A：primaryService==="factory_search" 時應該呼叫 runFactorySearchAction
    // 並把結果原樣放進回傳值——找工廠不是顧問服務，不建立 handoff，但要真的觸發搜尋。
    expect(mockRunFactorySearchAction).toHaveBeenCalledTimes(1);
    expect(result.factorySearchResult).toBe(fakeSearchResult);
    // Action Planner：這輪剛搜尋過，應該呼叫一次；action=none 且沒有既有 pending，不呼叫任何執行函式。
    expect(mockPlanNextOxmAction).toHaveBeenCalledTimes(1);
    expect(mockApplyFactorySourcingDecision).not.toHaveBeenCalled();
    expect(mockCancelFactorySearchRequestForConversation).not.toHaveBeenCalled();
    expect(mockResolvePendingRequestIfSuperseded).not.toHaveBeenCalled();
    // action=none 且沒有既有 pending：沒有任何 request 可談，manualSourcing 維持初始值 null
    // （client 端 null 與 {triggered:false} 行為等價，見 FactorySearchResultCards.tsx）。
    expect(result.manualSourcing).toBeNull();
  });

  it("Action Planner 決定 request_factory_sourcing → 呼叫 applyFactorySourcingDecision，manualSourcing 反映結果", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "factory_search" });
    const fakeSearchResult = {
      candidates: [], total: 20, zeroResult: false,
      appliedFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"], rankingSignals: ["五軸加工"] },
      hasExplicitCapabilityMatch: false, directCapabilityMatchCount: 0, missingCoreCapabilities: ["五軸加工"],
      viewAllUrl: "/search",
    };
    mockRunFactorySearchAction.mockResolvedValue(fakeSearchResult);
    mockPlanNextOxmAction.mockResolvedValue({
      action: "request_factory_sourcing", reason: "沒有五軸直接證據", reasonCategory: "capability_gap",
      actionPayload: { requestedCapabilities: ["五軸加工"], requestedCount: null },
    });
    mockApplyFactorySourcingDecision.mockResolvedValue({ requestId: 77 });
    mockComposeFinalResponse.mockResolvedValue("我已經把五軸加工的需求交給 OXM 協助人工找廠了。");

    const result = await runPersistentAiChat({ userId: 42, message: "找台中五軸加工廠" });

    expect(mockApplyFactorySourcingDecision).toHaveBeenCalledTimes(1);
    const callArgs = mockApplyFactorySourcingDecision.mock.calls[0][0];
    expect(callArgs.userId).toBe(42);
    expect(callArgs.mainIndustries).toEqual(["金屬加工"]);
    expect(callArgs.plannerReason).toBe("沒有五軸直接證據");
    expect(result.manualSourcing).toEqual({ triggered: true, reason: "capability_gap", requestId: 77 });
    // applyFactorySourcingDecision 真的成功了，Composer 看得到 outcome:
    // "succeeded"，所以可以講出「已經交給OXM」這句話（見「P」）。
    expect(result.reply).toBe("我已經把五軸加工的需求交給 OXM 協助人工找廠了。");
    const composerArgs = mockComposeFinalResponse.mock.calls[0][0];
    expect(composerArgs.action).toEqual({ action: "request_factory_sourcing", reasonCategory: "capability_gap", outcome: "succeeded" });
  });

  it("Action Planner 決定 request_factory_sourcing 但實際寫入失敗 → Composer 必須看到 outcome:\"failed\"，不能假裝成功；manualSourcing 反映真實失敗", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "factory_search" });
    const fakeSearchResult = {
      candidates: [], total: 20, zeroResult: false,
      appliedFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"], rankingSignals: ["五軸加工"] },
      hasExplicitCapabilityMatch: false, directCapabilityMatchCount: 0, missingCoreCapabilities: ["五軸加工"],
      viewAllUrl: "/search",
    };
    mockRunFactorySearchAction.mockResolvedValue(fakeSearchResult);
    mockPlanNextOxmAction.mockResolvedValue({
      action: "request_factory_sourcing", reason: "沒有五軸直接證據", reasonCategory: "capability_gap",
      actionPayload: { requestedCapabilities: ["五軸加工"], requestedCount: null },
    });
    mockApplyFactorySourcingDecision.mockRejectedValue(new Error("DB 寫入失敗"));
    mockComposeFinalResponse.mockResolvedValue("目前搜尋結果我已經看到了，不過協尋需求剛剛送出時系統出了點問題，麻煩稍後再跟我說一次。");

    const result = await runPersistentAiChat({ userId: 42, message: "找台中五軸加工廠" });

    // 見「九」：outcome 一律由 server 實際執行結果決定，不信任 AI 自己樂觀假設。
    const composerArgs = mockComposeFinalResponse.mock.calls[0][0];
    expect(composerArgs.action).toEqual({ action: "request_factory_sourcing", reasonCategory: "capability_gap", outcome: "failed" });
    expect(result.reply).not.toContain("已經把五軸加工的需求交給");
    expect(result.manualSourcing).toEqual({ triggered: false, reason: null, requestId: null });
  });

  it("R11：request_factory_sourcing 真的寫入成功，但後續 composeFinalResponse 失敗 → 不能用通用備援文案掩蓋掉「其實已經成功」；manualSourcing 仍反映真實成功", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "factory_search" });
    const fakeSearchResult = {
      candidates: [], total: 20, zeroResult: false,
      appliedFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"], rankingSignals: ["五軸加工"] },
      hasExplicitCapabilityMatch: false, directCapabilityMatchCount: 0, missingCoreCapabilities: ["五軸加工"],
      viewAllUrl: "/search",
    };
    mockRunFactorySearchAction.mockResolvedValue(fakeSearchResult);
    mockPlanNextOxmAction.mockResolvedValue({
      action: "request_factory_sourcing", reason: "沒有五軸直接證據", reasonCategory: "capability_gap",
      actionPayload: { requestedCapabilities: ["五軸加工"], requestedCount: null },
    });
    // 側寫效果（DB 寫入）真的成功了。
    mockApplyFactorySourcingDecision.mockResolvedValue({ requestId: 77 });
    // 但緊接著 Composer 這次呼叫失敗（例如 provider 逾時／API 出錯）。
    mockComposeFinalResponse.mockRejectedValue(new Error("composer boom"));

    const result = await runPersistentAiChat({ userId: 42, message: "找台中五軸加工廠" });

    // R12：不能拋錯（不會讓使用者看到失敗、也不會觸發可能導致重複送出的 Retry）。
    expect(result.reply).toBeTruthy();
    // manualSourcing 仍然如實反映「這輪真的成功執行過」，不因為 Composer 失敗而被清空。
    expect(result.manualSourcing).toEqual({ triggered: true, reason: "capability_gap", requestId: 77 });
    // 不能是通用的 Layer 1 備援文案（那句話完全沒提到剛剛已經送出的需求，會讓使用者誤會）。
    expect(result.reply).not.toBe(BASE_DIAGNOSIS.nextBestQuestion);
    expect(result.reply).not.toBe(BASE_DIAGNOSIS.recommendedBusinessDirection);
    expect(result.reply).not.toBe("能再多說一點你現在遇到的狀況嗎？");
    // 必須清楚表達「已經送出」，不能暗示失敗或要求使用者重新操作。
    expect(result.reply).toContain("已經幫你送出人工找廠需求");
    expect(result.reply).not.toMatch(/失敗|請重新|再試一次|請再說一次/);
  });

  it("Action Planner 決定 cancel_factory_sourcing（有既有 pending，且 Layer 2 判斷這輪確實在講這件事）→ 呼叫 cancelFactorySearchRequestForConversation", async () => {
    mockGetPendingFactorySearchRequestForConversation.mockResolvedValue({
      id: 5, status: "pending", requestSummary: "尋找台中五軸加工廠", requestedMatchCount: null,
      hardFiltersJson: { mainIndustries: ["金屬加工"], regions: ["台中市"] }, coreCapabilitiesJson: ["五軸加工"],
      candidateCount: 20, directCapabilityMatchCount: 0, updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    } as any);
    // 見「三十」：pending request 一定伴隨著 currentFactorySearchState 一起
    // 建立，這裡模擬那個既有 snapshot，讓 shouldPlanFactoryAction 的 gate
    // （factorySourcingContextRelevant）能正確判斷這輪要不要考慮取消。
    mockBuildTurnContext.mockResolvedValue({
      history: [
        { role: "user", content: "找台中五軸加工廠" },
        { role: "assistant", content: "..." },
        { role: "user", content: "不用了，我只是問問" },
      ],
      previousState: {
        ...createEmptyConversationState(false),
        currentFactorySearchState: {
          hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
          coreCapabilities: ["五軸加工"], candidateCount: 20, directCapabilityMatchCount: 0,
          missingCoreCapabilities: ["五軸加工"], status: "SIMILAR_ONLY", requestedMatchCount: null,
          topResults: [], searchSummary: "台中市、金屬加工；核心能力：五軸加工",
          lastSearchAt: "2026-08-16T00:00:00.000Z",
        },
      },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, factorySourcingContextRelevant: true });
    mockPlanNextOxmAction.mockResolvedValue({
      action: "cancel_factory_sourcing", reason: "使用者表示不用了", reasonCategory: "other",
      actionPayload: { requestedCapabilities: [], requestedCount: null },
    });
    mockComposeFinalResponse.mockResolvedValue("收到，那這次就不用幫你留協尋需求了。");

    const result = await runPersistentAiChat({ userId: 42, message: "不用了，我只是問問" });

    // primaryService 不是 factory_search，這輪不會重新搜尋，但因為有既有
    // Factory Search Context 且 Layer 2 判斷相關，仍然要呼叫 planner。
    expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
    expect(mockPlanNextOxmAction).toHaveBeenCalledTimes(1);
    expect(mockCancelFactorySearchRequestForConversation).toHaveBeenCalledWith({ conversationId: 101, userId: 42 });
    expect(mockApplyFactorySourcingDecision).not.toHaveBeenCalled();
    expect(result.manualSourcing).toEqual({ triggered: false, reason: null, requestId: null });
  });

  it("R11b：cancel_factory_sourcing 真的取消成功，但後續 composeFinalResponse 失敗 → 一樣不能用通用備援文案掩蓋掉「其實已經取消成功」", async () => {
    mockGetPendingFactorySearchRequestForConversation.mockResolvedValue({
      id: 5, status: "pending", requestSummary: "尋找台中五軸加工廠", requestedMatchCount: null,
      hardFiltersJson: { mainIndustries: ["金屬加工"], regions: ["台中市"] }, coreCapabilitiesJson: ["五軸加工"],
      candidateCount: 20, directCapabilityMatchCount: 0, updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    } as any);
    mockBuildTurnContext.mockResolvedValue({
      history: [
        { role: "user", content: "找台中五軸加工廠" },
        { role: "assistant", content: "..." },
        { role: "user", content: "不用了，我只是問問" },
      ],
      previousState: {
        ...createEmptyConversationState(false),
        currentFactorySearchState: {
          hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
          coreCapabilities: ["五軸加工"], candidateCount: 20, directCapabilityMatchCount: 0,
          missingCoreCapabilities: ["五軸加工"], status: "SIMILAR_ONLY", requestedMatchCount: null,
          topResults: [], searchSummary: "台中市、金屬加工；核心能力：五軸加工",
          lastSearchAt: "2026-08-16T00:00:00.000Z",
        },
      },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, factorySourcingContextRelevant: true });
    mockPlanNextOxmAction.mockResolvedValue({
      action: "cancel_factory_sourcing", reason: "使用者表示不用了", reasonCategory: "other",
      actionPayload: { requestedCapabilities: [], requestedCount: null },
    });
    // 取消本身（DB 寫入）真的成功了。
    mockCancelFactorySearchRequestForConversation.mockResolvedValue(true);
    // 但緊接著 Composer 這次呼叫失敗。
    mockComposeFinalResponse.mockRejectedValue(new Error("composer boom"));

    const result = await runPersistentAiChat({ userId: 42, message: "不用了，我只是問問" });

    expect(result.reply).toBeTruthy();
    expect(result.reply).toContain("已經幫你取消這筆人工找廠需求");
    expect(result.reply).not.toBe(BASE_DIAGNOSIS.nextBestQuestion);
    expect(result.reply).not.toMatch(/失敗|請重新|再試一次|請再說一次/);
  });

  it("見「三十」：有既有 pending 協尋，但使用者這輪明顯在講完全不相關的新企業問題 → 不呼叫 Action Planner／Composer，不會把新問題誤當成工廠搜尋 follow-up", async () => {
    mockGetPendingFactorySearchRequestForConversation.mockResolvedValue({
      id: 5, status: "pending", requestSummary: "尋找台中五軸加工廠", requestedMatchCount: null,
      hardFiltersJson: { mainIndustries: ["金屬加工"], regions: ["台中市"] }, coreCapabilitiesJson: ["五軸加工"],
      candidateCount: 20, directCapabilityMatchCount: 0, updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    } as any);
    mockBuildTurnContext.mockResolvedValue({
      history: [
        { role: "user", content: "找台中五軸加工廠" },
        { role: "assistant", content: "..." },
        { role: "user", content: "我現在工廠訂單很少，能怎麼改善" },
      ],
      previousState: {
        ...createEmptyConversationState(false),
        currentFactorySearchState: {
          hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
          coreCapabilities: ["五軸加工"], candidateCount: 20, directCapabilityMatchCount: 0,
          missingCoreCapabilities: ["五軸加工"], status: "SIMILAR_ONLY", requestedMatchCount: null,
          topResults: [], searchSummary: "台中市、金屬加工；核心能力：五軸加工",
          lastSearchAt: "2026-08-16T00:00:00.000Z",
        },
      },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    // Layer 2 語意判斷這輪完全不相關（跟工廠搜尋無關的新企業問題）。
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, factorySourcingContextRelevant: false });

    const result = await runPersistentAiChat({ userId: 42, message: "我現在工廠訂單很少，能怎麼改善" });

    expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
    expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
    expect(mockComposeFinalResponse).not.toHaveBeenCalled();
    expect(mockCancelFactorySearchRequestForConversation).not.toHaveBeenCalled();
    expect(mockApplyFactorySourcingDecision).not.toHaveBeenCalled();
    expect(result.manualSourcing).toBeNull();
    // 一般企業診斷的 finalReply（routing.finalReply）正常顯示，不被工廠搜尋 wording 蓋掉。
    expect(result.reply).toBe(BASE_ROUTING.finalReply);
    // 既有的 Factory Search State 原樣保留在 background，不會因為聊了別的話題就被清空。
    const savedState = mockUpdateConversationState.mock.calls[0][1];
    expect(savedState.currentFactorySearchState.hardFilters).toEqual({ mainIndustries: ["金屬加工"], regions: ["台中市"] });
  });

  it("完全不相關的一般對話：沒有既有 pending、primaryService 不是 factory_search → 不呼叫 Action Planner（維持 2 次 LLM call 成本）", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "erp" });

    await runPersistentAiChat({ userId: 42, message: "我想問 ERP" });

    expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
    expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
  });

  // Current Factory Search State 架構修正（見對話中「Current Factory Search
  // State 沒有真正被保存」）：CASE 4「這些都沒有五軸加工啊」的核心場景——這輪
  // Layer 2 沒有重新分類成 factory_search（不重新搜尋），但既有
  // currentFactorySearchState 存在、且 Layer 2 語意判斷 factorySourcingContextRelevant
  // 為 true，Action Planner 仍然要能用「上一輪存下來的搜尋狀態」做判斷。
  const STORED_SNAPSHOT = {
    hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
    coreCapabilities: ["五軸加工"],
    candidateCount: 20,
    directCapabilityMatchCount: 0,
    missingCoreCapabilities: ["五軸加工"],
    requestedMatchCount: null,
    topResults: [{ factoryId: 1, companyName: "測試工廠", region: "台中市", relevanceTier: "general" }],
    searchSummary: "台中市、金屬加工；核心能力：五軸加工",
    lastSearchAt: "2026-08-16T00:00:00.000Z",
  };

  it("CASE 4 核心場景：這輪沒有重新搜尋，但既有 Factory Search State 存在且 Layer 2 判斷相關 → 仍然呼叫 Action Planner，用存下來的 snapshot（不是 null）", async () => {
    mockBuildTurnContext.mockResolvedValue({
      history: [
        { role: "user", content: "找台中五軸加工廠" },
        { role: "assistant", content: "..." },
        { role: "user", content: "這些都沒有五軸加工啊" },
      ],
      previousState: { ...createEmptyConversationState(false), currentFactorySearchState: STORED_SNAPSHOT },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    // 這輪 Layer 2 沒有把它分類成 factory_search（不會重新搜尋），但語意上判斷跟既有搜尋脈絡相關。
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, factorySourcingContextRelevant: true });
    mockPlanNextOxmAction.mockResolvedValue({
      action: "request_factory_sourcing", reason: "使用者否定了上一輪的搜尋結果，核心能力五軸加工完全沒有直接證據。",
      reasonCategory: "capability_gap", actionPayload: { requestedCapabilities: ["五軸加工"], requestedCount: null },
      assistantReply: "了解，我已經把五軸加工的需求交給 OXM 協助人工確認了。",
    });
    mockApplyFactorySourcingDecision.mockResolvedValue({ requestId: 99 });

    const result = await runPersistentAiChat({ userId: 42, message: "這些都沒有五軸加工啊" });

    expect(mockRunFactorySearchAction).not.toHaveBeenCalled(); // 不強迫重新搜尋（見「一」）
    expect(mockPlanNextOxmAction).toHaveBeenCalledTimes(1);
    const plannerArgs = mockPlanNextOxmAction.mock.calls[0][0];
    // Planner 拿到的 hardFilters/candidateCount 等來自「存下來的舊 snapshot」，不是憑空猜的。
    expect(plannerArgs.factorySearchState.hardFilters).toEqual(STORED_SNAPSHOT.hardFilters);
    expect(plannerArgs.factorySearchState.candidateCount).toBe(20);
    expect(plannerArgs.factorySearchState.missingCoreCapabilities).toEqual(["五軸加工"]);

    // applyFactorySourcingDecision 也要用同一份 server-authoritative snapshot 的資料，不是模型輸出的數字。
    expect(mockApplyFactorySourcingDecision).toHaveBeenCalledTimes(1);
    const applyArgs = mockApplyFactorySourcingDecision.mock.calls[0][0];
    expect(applyArgs.mainIndustries).toEqual(["金屬加工"]);
    expect(applyArgs.candidateCount).toBe(20);
    expect(result.manualSourcing).toEqual({ triggered: true, reason: "capability_gap", requestId: 99 });

    // 這輪寫回的 ConversationState 也要保留這個 Factory Search State（見「十四」）。
    const savedState = mockUpdateConversationState.mock.calls[0][1];
    expect(savedState.currentFactorySearchState.hardFilters).toEqual(STORED_SNAPSHOT.hardFilters);
  });

  it("CASE 13：既有 Factory Search State 存在，但 Layer 2 判斷這輪不相關（例如問 CITD）→ 不呼叫 Action Planner", async () => {
    mockBuildTurnContext.mockResolvedValue({
      history: [
        { role: "user", content: "找台中五軸加工廠" },
        { role: "assistant", content: "..." },
        { role: "user", content: "CITD可以補多少？" },
      ],
      previousState: { ...createEmptyConversationState(false), currentFactorySearchState: STORED_SNAPSHOT },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "gov_subsidy", factorySourcingContextRelevant: false });

    const result = await runPersistentAiChat({ userId: 42, message: "CITD可以補多少？" });

    expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
    expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
    expect(result.manualSourcing).toBeNull();
    // 既有的 Factory Search State 原樣保留，不會因為聊了別的話題就被清空。
    const savedState = mockUpdateConversationState.mock.calls[0][1];
    expect(savedState.currentFactorySearchState).toEqual(STORED_SNAPSHOT);
  });

  it("這輪真的重新搜尋 → nextState.currentFactorySearchState 用這次新結果覆蓋（不是沿用舊的）", async () => {
    mockBuildTurnContext.mockResolvedValue({
      history: [{ role: "user", content: "找台中五軸加工廠" }],
      previousState: { ...createEmptyConversationState(false), currentFactorySearchState: STORED_SNAPSHOT },
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "factory_search" });
    const freshResult = {
      candidates: [], total: 5, zeroResult: false,
      appliedFilters: { mainIndustries: ["金屬加工"], regions: ["高雄市"], rankingSignals: ["雷射切割"] },
      hasExplicitCapabilityMatch: true, directCapabilityMatchCount: 2, missingCoreCapabilities: [],
      viewAllUrl: "/search",
    };
    mockRunFactorySearchAction.mockResolvedValue(freshResult);
    mockPlanNextOxmAction.mockResolvedValue({ action: "none", reason: "x", reasonCategory: "other", actionPayload: { requestedCapabilities: [], requestedCount: null }, assistantReply: "這次在高雄找到幾家雷射切割廠。" });

    await runPersistentAiChat({ userId: 42, message: "找高雄雷射切割廠" });

    const savedState = mockUpdateConversationState.mock.calls[0][1];
    expect(savedState.currentFactorySearchState.hardFilters.regions).toEqual(["高雄市"]);
    expect(savedState.currentFactorySearchState.candidateCount).toBe(5);
  });

  it("client 帶了合法的 conversationId（本人擁有、仍 active）：直接延續，不建立新的、不查孤兒對話", async () => {
    mockGetConversationForUser.mockResolvedValue(CLIENT_HELD_CONVERSATION);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    const result = await runPersistentAiChat({ userId: 42, message: "第二句", conversationId: 55 });

    expect(mockGetConversationForUser).toHaveBeenCalledWith(55, 42);
    expect(mockGetActiveConversationForUser).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockEndConversationAndSummarize).not.toHaveBeenCalled();
    expect(mockAppendMessage).toHaveBeenCalledWith(55, "user", "第二句");
    expect(result.conversationId).toBe(55);
  });

  it("client 帶的 conversationId 不是本人的／查不到：視同沒帶，走新的使用階段邏輯", async () => {
    mockGetConversationForUser.mockResolvedValue(undefined); // 不是本人的，或不存在
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    const result = await runPersistentAiChat({ userId: 42, message: "hi", conversationId: 999 });

    expect(mockGetActiveConversationForUser).toHaveBeenCalledWith(42);
    expect(mockCreateConversation).toHaveBeenCalledWith(42, null);
    expect(result.conversationId).toBe(101);
  });

  it("沒有帶 conversationId、但這個使用者名下有殘留的 active 對話：先收尾（產生摘要）再建立新的一筆", async () => {
    mockGetActiveConversationForUser.mockResolvedValue(ORPHANED_CONVERSATION);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    const result = await runPersistentAiChat({ userId: 42, message: "新的一輪" });

    expect(mockEndConversationAndSummarize).toHaveBeenCalledWith(ORPHANED_CONVERSATION);
    expect(mockCreateConversation).toHaveBeenCalledWith(42, null);
    expect(result.conversationId).toBe(101); // 用的是新建立的那筆，不是孤兒那筆
  });

  it("有 approved 工廠 context 時：每一輪都會用 factoryId 查 Enterprise Memory 並傳給 Layer 1／Layer 2（Phase 11.2：factory-scoped）", async () => {
    mockResolveApprovedAiFactoryContext.mockResolvedValue({
      id: 7, context: { companyName: "測試工廠" } as any, role: "owner",
    });
    mockGetEnterpriseMemory.mockResolvedValue({
      summaryText: "銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true,
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    await runPersistentAiChat({ userId: 42, message: "你還記得我是做什麼的嗎？" });

    // Phase 11.2 P0 修正：查詢 key 是 factoryId（approved resolver 解析出來的
    // 工廠 id），不再是 userId——這正是「Factory A → Factory B 換工廠時不能
    // 讀到舊工廠記憶」的根因修正點，見 factoryContext.ts::resolveApprovedAiFactoryContext。
    expect(mockGetEnterpriseMemory).toHaveBeenCalledWith(7);
    const expectedMemory = {
      summaryText: "銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true,
    };
    // Layer 1（診斷）跟 Layer 2（組裝 finalReply）都要拿到同一份 memory——
    // Layer 2 才是真正組裝顯示給使用者文字的那一層，只傳給 Layer 1 沒辦法
    // 回答「你還記得我上次說什麼嗎」這種 meta 問題（見 routing.ts 註解）。
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].enterpriseMemory).toEqual(expectedMemory);
    expect(mockRunOxmRouting.mock.calls[0][0].enterpriseMemory).toEqual(expectedMemory);
  });

  it("沒有 approved 工廠 context 時：完全不呼叫 getEnterpriseMemory，Layer 1／Layer 2 拿到的 enterpriseMemory 是 null（Phase 11.2「三十七、No Memory Without Factory」）", async () => {
    mockResolveApprovedAiFactoryContext.mockResolvedValue(null);
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    await runPersistentAiChat({ userId: 42, message: "hi" });

    expect(mockGetEnterpriseMemory).not.toHaveBeenCalled();
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].enterpriseMemory).toBeNull();
    expect(mockRunOxmRouting.mock.calls[0][0].enterpriseMemory).toBeNull();
  });

  it("有解析到工廠時，把 factoryId 傳給 createConversation，並把白名單 context 傳給 Layer 1/Layer 2", async () => {
    const aiFactoryContext = { companyName: "測試工廠" } as any;
    mockResolveApprovedAiFactoryContext.mockResolvedValue({ id: 7, context: aiFactoryContext });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    await runPersistentAiChat({ userId: 42, message: "hi" });

    expect(mockCreateConversation).toHaveBeenCalledWith(42, 7);
    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].factoryContext).toBe(aiFactoryContext);
    expect(mockRunOxmRouting.mock.calls[0][0].factoryContext).toBe(aiFactoryContext);
  });

  it("Layer 2 失敗時：不拋錯，仍然更新 state 並寫入 assistant message（不會卡住對話）", async () => {
    mockRunEnterpriseDiagnosis.mockResolvedValue({
      ...BASE_DIAGNOSIS,
      nextBestQuestion: "備援問題",
    });
    mockRunOxmRouting.mockRejectedValue(new Error("routing boom"));

    const result = await runPersistentAiChat({ userId: 42, message: "最近訂單變少" });

    expect(result.reply).toBe("備援問題");
    expect(mockAppendMessage).toHaveBeenCalledWith(101, "assistant", "備援問題");
    expect(mockUpdateConversationState).toHaveBeenCalledTimes(1);
  });

  it("既有 previousState 存在時，會傳給 Layer 1（讓下一輪不用重新讀完整歷史也知道聊到哪）", async () => {
    const previousState = createEmptyConversationState(false);
    mockBuildTurnContext.mockResolvedValue({
      history: [{ role: "user", content: "有人問，但都嫌比中國貴" }],
      previousState,
    });
    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

    await runPersistentAiChat({ userId: 42, message: "有人問，但都嫌比中國貴" });

    expect(mockRunEnterpriseDiagnosis.mock.calls[0][0].previousState).toBe(previousState);
  });

  describe("非 OXM 純閒聊收斂機制（見對話中「非 OXM 純閒聊收斂機制」）", () => {
    it("既有 previousState.consecutiveOutOfDomainCasualTurns=2，這輪 conversationIntent=casual_conversation 且 casualTurnDomainRelevant=false → 傳給 routing 的值是 3，且 savedState 也是 3", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 2 };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "最近有什麼好看的電影" }],
        previousState,
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "casual_conversation", casualTurnDomainRelevant: false,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      await runPersistentAiChat({ userId: 42, message: "最近有什麼好看的電影" });

      expect(mockRunOxmRouting.mock.calls[0][0].consecutiveOutOfDomainCasualTurns).toBe(3);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.consecutiveOutOfDomainCasualTurns).toBe(3);
    });

    it("既有 previousState.consecutiveOutOfDomainCasualTurns=3，這輪跟企業相關（例如「今天工廠很煩」，casualTurnDomainRelevant=true）→ 重置為 0", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "今天工廠真的很煩" }],
        previousState,
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "casual_conversation", casualTurnDomainRelevant: true,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      await runPersistentAiChat({ userId: 42, message: "今天工廠真的很煩" });

      expect(mockRunOxmRouting.mock.calls[0][0].consecutiveOutOfDomainCasualTurns).toBe(0);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.consecutiveOutOfDomainCasualTurns).toBe(0);
    });

    it("既有 previousState.consecutiveOutOfDomainCasualTurns=3，這輪回到 OXM 主題（resource_request）→ 重置為 0，見 CASE 3", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "幫我找彰化金屬加工廠" }],
        previousState,
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "resource_request", casualTurnDomainRelevant: true,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      await runPersistentAiChat({ userId: 42, message: "幫我找彰化金屬加工廠" });

      expect(mockRunOxmRouting.mock.calls[0][0].consecutiveOutOfDomainCasualTurns).toBe(0);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.consecutiveOutOfDomainCasualTurns).toBe(0);
    });

    it("既有 previousState.consecutiveOutOfDomainCasualTurns=3，這輪回到 OXM 主題（informational，「OXM有哪些服務」）→ 重置為 0，見 CASE 4", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "OXM有哪些服務？" }],
        previousState,
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "informational", casualTurnDomainRelevant: true,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      await runPersistentAiChat({ userId: 42, message: "OXM有哪些服務？" });

      expect(mockRunOxmRouting.mock.calls[0][0].consecutiveOutOfDomainCasualTurns).toBe(0);
    });

    it("連續 4 輪都是 out-of-domain casual（見 CASE 1）：模擬 4 次真實依序呼叫，最終 state 累加到 4", async () => {
      let previousState: ReturnType<typeof createEmptyConversationState> | null = null;
      const messages = ["今天天氣真好", "有推薦的咖啡廳嗎", "最近有什麼好看的電影", "我養的貓很可愛"];
      for (const message of messages) {
        mockBuildTurnContext.mockResolvedValue({ history: [{ role: "user", content: message }], previousState });
        mockRunEnterpriseDiagnosis.mockResolvedValue({
          ...BASE_DIAGNOSIS, conversationIntent: "casual_conversation", casualTurnDomainRelevant: false,
        });
        mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);
        await runPersistentAiChat({ userId: 42, message });
        const callIndex = mockUpdateConversationState.mock.calls.length - 1;
        previousState = mockUpdateConversationState.mock.calls[callIndex][1];
      }
      expect(previousState?.consecutiveOutOfDomainCasualTurns).toBe(4);
    });
  });

  describe("casual pause 狀態機（見對話中「這次人工驗收確認兩個剩餘問題」Part A）", () => {
    const WARNED_TEXT =
      "我是 OXM 的企業助手，主要會把對話資源優先用在 OXM 相關服務與企業問題上。一般閒聊我可以陪你聊一下，但如果聊得比較久，我會優先把對話拉回找工廠、企業經營或 OXM 服務相關的內容，還請你體諒。";
    const PAUSED_TEXT =
      "OXM AI 已暫停一般閒聊。如果你有 OXM、找工廠、企業經營或相關服務需求，我就會繼續協助你。";

    it("上一輪 mode=normal、這一輪累加到 consecutiveOutOfDomainCasualTurns=4（第一次跨過門檻）→ 轉成 warned，finalReply 被覆蓋成固定文案，完整 pipeline 仍然有跑（因為需要 diagnosis 才能知道這輪是第 4 次）", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3, outOfDomainCasualMode: "normal" as const };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "我養的貓很可愛" }],
        previousState,
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "casual_conversation", casualTurnDomainRelevant: false,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      const result = await runPersistentAiChat({ userId: 42, message: "我養的貓很可愛" });

      expect(mockCheckOutOfDomainResumeRelevance).not.toHaveBeenCalled();
      expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
      expect(mockRunOxmRouting).toHaveBeenCalledTimes(1);
      expect(result.reply).toBe(WARNED_TEXT);
      expect(mockAppendMessage).toHaveBeenCalledWith(101, "assistant", WARNED_TEXT);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.outOfDomainCasualMode).toBe("warned");
      expect(savedState.consecutiveOutOfDomainCasualTurns).toBe(4);
    });

    it("上一輪 mode=warned，checkOutOfDomainResumeRelevance 判斷『不相關』（仍是純閒聊）→ 轉成 paused，只用固定文案回覆，完全不跑 Diagnosis/Routing/Planner/Composer", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 4, outOfDomainCasualMode: "warned" as const };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "豬排飯呢？" }],
        previousState,
      });
      mockCheckOutOfDomainResumeRelevance.mockResolvedValue(false);

      const result = await runPersistentAiChat({ userId: 42, message: "豬排飯呢？" });

      expect(mockCheckOutOfDomainResumeRelevance).toHaveBeenCalledWith("豬排飯呢？");
      expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
      expect(mockRunOxmRouting).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe(PAUSED_TEXT);
      expect(result.handoffOffer).toBeNull();
      expect(result.factorySearchResult).toBeNull();
      expect(result.manualSourcing).toBeNull();
      expect(mockAppendMessage).toHaveBeenCalledWith(101, "assistant", PAUSED_TEXT);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.outOfDomainCasualMode).toBe("paused");
    });

    it("上一輪 mode=paused，繼續判斷『不相關』（例如「那電影呢？」）→ 維持 paused，一樣完全不跑完整 pipeline，只呼叫一次極輕量 resume gate", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 4, outOfDomainCasualMode: "paused" as const };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "那電影呢？" }],
        previousState,
      });
      mockCheckOutOfDomainResumeRelevance.mockResolvedValue(false);

      const result = await runPersistentAiChat({ userId: 42, message: "那電影呢？" });

      expect(mockCheckOutOfDomainResumeRelevance).toHaveBeenCalledTimes(1);
      expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
      expect(mockRunOxmRouting).not.toHaveBeenCalled();
      expect(result.reply).toBe(PAUSED_TEXT);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.outOfDomainCasualMode).toBe("paused");
    });

    it("上一輪 mode=paused，resume gate 判斷『相關』（例如「幫我找台中的金屬加工廠」）→ 恢復完整 pipeline，mode 收斂回 normal", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 4, outOfDomainCasualMode: "paused" as const };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "幫我找台中的金屬加工廠" }],
        previousState,
      });
      mockCheckOutOfDomainResumeRelevance.mockResolvedValue(true);
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "resource_request", casualTurnDomainRelevant: true,
      });
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, finalReply: "了解，我幫你找找台中的金屬加工廠。" });

      const result = await runPersistentAiChat({ userId: 42, message: "幫我找台中的金屬加工廠" });

      expect(mockCheckOutOfDomainResumeRelevance).toHaveBeenCalledWith("幫我找台中的金屬加工廠");
      expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
      expect(mockRunOxmRouting).toHaveBeenCalledTimes(1);
      expect(result.reply).toBe("了解，我幫你找找台中的金屬加工廠。");
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.outOfDomainCasualMode).toBe("normal");
    });

    it("上一輪 mode=warned，resume gate 判斷『相關』→ 直接恢復完整 pipeline（不需要先進 paused 才能恢復）", async () => {
      const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 4, outOfDomainCasualMode: "warned" as const };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "OXM 有哪些服務？" }],
        previousState,
      });
      mockCheckOutOfDomainResumeRelevance.mockResolvedValue(true);
      mockRunEnterpriseDiagnosis.mockResolvedValue({
        ...BASE_DIAGNOSIS, conversationIntent: "informational", casualTurnDomainRelevant: true,
      });
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      const result = await runPersistentAiChat({ userId: 42, message: "OXM 有哪些服務？" });

      expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
      expect(result.reply).toBe(BASE_ROUTING.finalReply);
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.outOfDomainCasualMode).toBe("normal");
    });

    it("上一輪 mode=normal（一般正常對話）→ 完全不呼叫 checkOutOfDomainResumeRelevance", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue(BASE_ROUTING);

      await runPersistentAiChat({ userId: 42, message: "最近訂單變少" });

      expect(mockCheckOutOfDomainResumeRelevance).not.toHaveBeenCalled();
    });
  });

  describe("Phase 6B：AI 找消息 編排（見對話中「找消息」）", () => {
    const FAKE_NEWS_RESULT = {
      candidates: [{
        id: 1, slug: "test-exhibition", title: "金屬加工展覽會", summary: "測試摘要",
        isImportant: false, isCompetition: false, isExhibition: true, isCrossIndustry: false,
        publishedAt: "2026-08-01T00:00:00.000Z", industryNames: ["金屬加工"],
        relevanceTier: "high" as const, url: "/news/test-exhibition",
      }],
      total: 1,
      zeroResult: false,
      appliedFilters: {
        categoryFilters: { isImportant: false, isCompetition: false, isExhibition: true, isCrossIndustry: false },
        industryNames: ["金屬加工"], keywords: [],
      },
      viewAllUrl: "/news?category=industry&industry=金屬加工",
    };

    it("primaryService===\"news\" 時呼叫 runNewsSearchAction，並用 Composer 組出 finalReply（不是 routing.finalReply 本身）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "news" });
      mockRunNewsSearchAction.mockResolvedValue(FAKE_NEWS_RESULT);
      mockComposeFinalResponse.mockResolvedValue("找到金屬加工相關的展覽消息囉！");

      const result = await runPersistentAiChat({ userId: 42, message: "最近有沒有金屬加工相關展覽？" });

      expect(mockRunNewsSearchAction).toHaveBeenCalledTimes(1);
      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled(); // 找消息沒有 Action Planner（見「十三」）
      expect(mockComposeFinalResponse).toHaveBeenCalledTimes(1);
      const composerArgs = mockComposeFinalResponse.mock.calls[0][0];
      expect(composerArgs.newsSearch.isFreshSearch).toBe(true);
      expect(composerArgs.factorySearch).toBeUndefined();
      expect(composerArgs.action).toBeNull();
      expect(result.reply).toBe("找到金屬加工相關的展覽消息囉！");
      expect(result.newsSearchResult).toBe(FAKE_NEWS_RESULT);
      expect(result.handoffOffer).toBeNull(); // 找消息不走 Handoff CTA
    });

    it("這輪寫回的 ConversationState 保留 currentNewsSearchState（見「十：Current News Search State」）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "news" });
      mockRunNewsSearchAction.mockResolvedValue(FAKE_NEWS_RESULT);
      mockComposeFinalResponse.mockResolvedValue("找到相關消息。");

      await runPersistentAiChat({ userId: 42, message: "最近有沒有金屬加工相關展覽？" });

      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.currentNewsSearchState.industryNames).toEqual(["金屬加工"]);
      expect(savedState.currentNewsSearchState.resultCount).toBe(1);
    });

    it("見「九：News attachment provenance」——這輪沒有重新搜尋、也沒有既有 News Search Context 時，newsSearchResult 固定是 null，不會 fallback 舊資料", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, newsSearchContextRelevant: false });

      const result = await runPersistentAiChat({ userId: 42, message: "我想問 ERP" });

      expect(mockRunNewsSearchAction).not.toHaveBeenCalled();
      expect(result.newsSearchResult).toBeNull();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
    });

    it("既有 News Search Context 存在、且 Layer 2 判斷這輪相關但沒有重新搜尋 → 仍呼叫 Composer 用既有 snapshot 回覆，但 newsSearchResult（附件來源）維持 null（這輪沒有新搜尋，不會顯示舊卡片）", async () => {
      const existingNewsState = {
        categoryFilters: { isImportant: false, isCompetition: false, isExhibition: true, isCrossIndustry: false },
        industryNames: ["金屬加工"], keywords: [], resultCount: 1,
        topResults: [{ newsId: 1, title: "金屬加工展覽會", relevanceTier: "high" }],
        searchSummary: "展覽、金屬加工", lastSearchAt: "2026-08-01T00:00:00.000Z",
      };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "這些我都看過了" }],
        previousState: { ...createEmptyConversationState(false), currentNewsSearchState: existingNewsState },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, newsSearchContextRelevant: true });
      mockComposeFinalResponse.mockResolvedValue("目前這批就是找到的消息，還沒有其他更新的。");

      const result = await runPersistentAiChat({ userId: 42, message: "這些我都看過了" });

      expect(mockRunNewsSearchAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).toHaveBeenCalledTimes(1);
      const composerArgs = mockComposeFinalResponse.mock.calls[0][0];
      expect(composerArgs.newsSearch.isFreshSearch).toBe(false);
      // Tool Result／附件只能來自這一輪真正執行的 search_news，這輪沒有重新
      // 搜尋，newsSearchResult 固定是 null，client 端不會顯示卡片附件。
      expect(result.newsSearchResult).toBeNull();
      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.currentNewsSearchState).toEqual(existingNewsState);
    });

    it("0 results → 仍呼叫 Composer（誠實告知，不 fallback），attachment candidates 是空陣列", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: "news" });
      const zeroResult = {
        candidates: [], total: 0, zeroResult: true,
        appliedFilters: { categoryFilters: { isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: true }, industryNames: [], keywords: [] },
        viewAllUrl: "/news?category=cross-industry",
      };
      mockRunNewsSearchAction.mockResolvedValue(zeroResult);
      mockComposeFinalResponse.mockResolvedValue("目前 OXM 的消息資料裡還沒有找到符合這個條件的內容。");

      const result = await runPersistentAiChat({ userId: 42, message: "最近有什麼跨產業資訊？" });

      expect(result.newsSearchResult!.candidates).toEqual([]);
      expect(result.reply).toBe("目前 OXM 的消息資料裡還沒有找到符合這個條件的內容。");
    });
  });

  describe("Phase 6C：AI 讀取政府補助方案 編排（見對話中「政府補助資訊查詢 ≠ Handoff」）", () => {
    const FAKE_SUBSIDY_RESULT = {
      candidates: [{
        slug: "citd", title: "協助傳統產業技術開發", shortTitle: "CITD",
        description: "補助技術升級、製程改善及智慧化轉型所需研發費用。",
        targetAudience: null, highlights: ["傳統產業適用"], maxFundingLabel: "1,000 萬元",
        statusLabel: null, registryProfile: null, url: "/upgrade-center",
      }],
      totalActiveCount: 5,
      matchedProgramSlugs: ["citd"],
      compareMode: false,
      zeroResult: false,
      registryOnlyMatch: null,
      viewAllUrl: "/upgrade-center",
    };

    it("govSubsidyLookupRelevant=true 時呼叫 runSubsidyProgramsAction（即使 primaryService 因為 informational 被清空也一樣，見 routing.ts 的說明），並用 Composer 組出 finalReply", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, govSubsidyLookupRelevant: true });
      mockRunSubsidyProgramsAction.mockResolvedValue(FAKE_SUBSIDY_RESULT);
      mockComposeFinalResponse.mockResolvedValue("CITD 是給傳統製造業做技術升級的補助方案。");

      const result = await runPersistentAiChat({ userId: 42, message: "CITD是什麼？" });

      expect(mockRunSubsidyProgramsAction).toHaveBeenCalledTimes(1);
      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockRunNewsSearchAction).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled(); // 補助查詢沒有 Action Planner
      expect(mockComposeFinalResponse).toHaveBeenCalledTimes(1);
      const composerArgs = mockComposeFinalResponse.mock.calls[0][0];
      expect(composerArgs.subsidySearch).toBe(FAKE_SUBSIDY_RESULT);
      expect(composerArgs.factorySearch).toBeUndefined();
      expect(composerArgs.newsSearch).toBeUndefined();
      expect(composerArgs.action).toBeNull();
      expect(result.reply).toBe("CITD 是給傳統製造業做技術升級的補助方案。");
      expect(result.subsidyProgramsResult).toBe(FAKE_SUBSIDY_RESULT);
      expect(result.handoffOffer).toBeNull(); // 補助查詢不走 Handoff CTA
    });

    it("govSubsidyLookupRelevant=false 且沒有其他 action 時，不呼叫 runSubsidyProgramsAction，subsidyProgramsResult 固定 null", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, govSubsidyLookupRelevant: false });

      const result = await runPersistentAiChat({ userId: 42, message: "我想問 ERP" });

      expect(mockRunSubsidyProgramsAction).not.toHaveBeenCalled();
      expect(result.subsidyProgramsResult).toBeNull();
    });

    it("navigationTarget 有值時，navigationAction 帶正確的 title／route（由 server Registry 決定，不是模型輸出），且不影響 primaryService 為 null 的 informational 回覆", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, navigationTarget: "erp" });

      const result = await runPersistentAiChat({ userId: 42, message: "帶我去看ERP" });

      expect(result.navigationAction).toEqual({ key: "erp", title: "ERP／產線優化專區", route: "/erp-optimization" });
    });

    it("navigationTarget 是 null 時，navigationAction 固定 null", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({ ...BASE_ROUTING, primaryService: null, navigationTarget: null });

      const result = await runPersistentAiChat({ userId: 42, message: "ERP是什麼？" });

      expect(result.navigationAction).toBeNull();
    });
  });

  describe("Phase 6D：Platform Help 編排（見對話中「OXM AI 平台操作 / 使用方式能力」）——chatService.ts 本身不需要任何新程式碼，resourceTarget=\"platform_help\" 走既有的 finalReply passthrough 路徑，這裡是回歸驗證", () => {
    it("resourceTarget=platform_help 時：不觸發 search_factories／search_news／search_subsidy_programs，finalReply 直接使用 routing.finalReply（CASE P1／P3／P5／P7 情境）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "platform_help",
        platformHelpTarget: "factory_search_usage",
        finalReply: "進入找工廠頁面，選產業／地區，輸入關鍵字，點進工廠公開頁查看詳情，有需要可詢價。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "我要怎麼找工廠？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockRunNewsSearchAction).not.toHaveBeenCalled();
      expect(mockRunSubsidyProgramsAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("進入找工廠頁面，選產業／地區，輸入關鍵字，點進工廠公開頁查看詳情，有需要可詢價。");
      expect(result.factorySearchResult).toBeNull();
      expect(result.subsidyProgramsResult).toBeNull();
      expect(result.handoffOffer).toBeNull();
    });

    it("resourceTarget=platform_help 且同時有 navigationTarget 時，navigationAction 正確附上（見「十：Platform Help 可以附 Navigation CTA」）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "platform_help",
        platformHelpTarget: "factory_search_usage", navigationTarget: "factory_search",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "我要怎麼找工廠？" });

      expect(result.navigationAction).toEqual({ key: "factory_search", title: "找工廠", route: "/search" });
    });

    it("CASE P9 端到端：既有 Factory Search Context 存在，但這輪 resourceTarget=platform_help 時，即使 currentFactorySearchState 還在，也不會誤觸發 shouldPlanFactoryAction／Action Planner（依賴 enforceResourceTargetGate 已經把 factorySourcingContextRelevant 強制清空，這裡驗證 chatService 端到端行為）", async () => {
      const existingFactoryState = {
        hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
        coreCapabilities: [], candidateCount: 20, directCapabilityMatchCount: 3,
        missingCoreCapabilities: [], status: "MATCH_FOUND", requestedMatchCount: null, topResults: [],
        searchSummary: "台中市、金屬加工", lastSearchAt: "2026-08-16T00:00:00.000Z",
      };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "那我自己平常要怎麼搜尋？" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: existingFactoryState },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      // enforceResourceTargetGate 已經在 routing.ts 層級把 factorySourcingContextRelevant
      // 強制清空（resourceTarget !== "factory_search"），這裡模擬 routing 已經回傳過
      // gate 之後的正確結果。
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "platform_help",
        platformHelpTarget: "factory_search_usage", factorySourcingContextRelevant: false,
        finalReply: "你也可以自己上找工廠頁面，用產業和地區篩選，再輸入關鍵字搜尋。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "那我自己平常要怎麼搜尋？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("你也可以自己上找工廠頁面，用產業和地區篩選，再輸入關鍵字搜尋。");
    });
  });

  describe("Phase 6E：Service Info 編排（見對話中「OXM 顧問服務知識中心化 + 精準服務查詢」）——chatService.ts 本身不需要任何新程式碼，resourceTarget=\"service_info\" 走既有的 finalReply passthrough 路徑，這裡是回歸驗證", () => {
    it("resourceTarget=service_info 時：不觸發 search_factories／search_news／search_subsidy_programs，finalReply 直接使用 routing.finalReply（CASE E1）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "service_info",
        serviceTargets: ["erp"],
        finalReply: "ERP 協助你盤點並優化生產管理，涵蓋系統導入評估、產線動線優化，或兩者整合改善。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "ERP服務是做什麼？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockRunNewsSearchAction).not.toHaveBeenCalled();
      expect(mockRunSubsidyProgramsAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("ERP 協助你盤點並優化生產管理，涵蓋系統導入評估、產線動線優化，或兩者整合改善。");
      expect(result.factorySearchResult).toBeNull();
      expect(result.subsidyProgramsResult).toBeNull();
      expect(result.handoffOffer).toBeNull();
    });

    it("resourceTarget=service_info 且同時有 navigationTarget 時，navigationAction 正確附上（見「十五：可搭配既有 NavigationAttachment」）", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "service_info",
        serviceTargets: ["erp"], navigationTarget: "erp",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "ERP服務是做什麼？可以帶我去看看嗎？" });

      expect(result.navigationAction).toEqual({ key: "erp", title: "ERP／產線優化專區", route: "/erp-optimization" });
    });

    it("CASE E-cross regression 端到端：既有 Factory Search Context 存在，但這輪 resourceTarget=service_info 時，即使 currentFactorySearchState 還在，也不會誤觸發 shouldPlanFactoryAction／Action Planner", async () => {
      const existingFactoryState = {
        hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
        coreCapabilities: [], candidateCount: 20, directCapabilityMatchCount: 3,
        missingCoreCapabilities: [], status: "MATCH_FOUND", requestedMatchCount: null, topResults: [],
        searchSummary: "台中市、金屬加工", lastSearchAt: "2026-08-16T00:00:00.000Z",
      };
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "ERP跟財務優化差在哪？" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: existingFactoryState },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "service_info",
        serviceTargets: ["erp", "finance"], factorySourcingContextRelevant: false,
        finalReply: "ERP 解決的是庫存、工單、排程沒系統化；財務優化解決的是現金流與融資結構，兩者處理的問題不同。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "ERP跟財務優化差在哪？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("ERP 解決的是庫存、工單、排程沒系統化；財務優化解決的是現金流與融資結構，兩者處理的問題不同。");
    });
  });

  describe("Phase 6F：Factory Result Boundary 編排（見對話中「Factory Search Result Boundary / 工廠搜尋結果分析限制」）", () => {
    const EXISTING_FACTORY_STATE = {
      hardFilters: { mainIndustries: ["金屬加工"], regions: ["彰化縣"] },
      coreCapabilities: [], candidateCount: 5, directCapabilityMatchCount: 3,
      missingCoreCapabilities: [], status: "MATCH_FOUND", requestedMatchCount: null,
      topResults: [
        { factoryId: 1, companyName: "測試工廠A", region: "彰化縣", relevanceTier: "high" },
        { factoryId: 2, companyName: "測試工廠B", region: "彰化縣", relevanceTier: "high" },
      ],
      searchSummary: "彰化縣、金屬加工", lastSearchAt: "2026-08-16T00:00:00.000Z",
    };

    it("CASE B1-B6：factoryResultAnalysisRequest=true 時不呼叫 Action Planner／Composer／search_factories，finalReply 直接用 routing.finalReply（不重新把 topResults 送進任何模型）", async () => {
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "第一家主要做什麼？" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: EXISTING_FACTORY_STATE },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "factory_search",
        factorySourcingContextRelevant: false, factoryResultAnalysisRequest: true,
        finalReply: "我能協助你的是依照需求把可能符合的工廠搜尋出來；後續產品、加工能力與合作條件，建議直接進工廠頁查看並與廠商確認。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "第一家主要做什麼？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockPlanNextOxmAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("我能協助你的是依照需求把可能符合的工廠搜尋出來；後續產品、加工能力與合作條件，建議直接進工廠頁查看並與廠商確認。");
      expect(result.factorySearchResult).toBeNull();
      expect(result.manualSourcing).toBeNull();
    });

    it("boundary 回覆後，既有 Factory Search State 原樣保留（不會因為 boundary 回覆被清空，之後仍然可以正常延續或重新搜尋）", async () => {
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "哪一家比較適合我？" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: EXISTING_FACTORY_STATE },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "factory_search",
        factoryResultAnalysisRequest: true,
      });

      await runPersistentAiChat({ userId: 42, message: "哪一家比較適合我？" });

      const savedState = mockUpdateConversationState.mock.calls[0][1];
      expect(savedState.currentFactorySearchState).toEqual(EXISTING_FACTORY_STATE);
    });

    it("CASE B7：這幾家都不是，再幫我找別的 → 不走 boundary，走既有 search/refine/sourcing（factoryResultAnalysisRequest=false，factorySourcingContextRelevant=true）", async () => {
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "這幾家都不是，再幫我找別的" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: EXISTING_FACTORY_STATE },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "factory_search",
        factorySourcingContextRelevant: true, factoryResultAnalysisRequest: false,
      });
      mockPlanNextOxmAction.mockResolvedValue({
        action: "none", reasonCategory: "other",
        actionPayload: { requestedCount: null },
        reason: "使用者否定既有結果但沒有新條件",
      });
      mockComposeFinalResponse.mockResolvedValue("了解，我幫你重新看看還有哪些選擇。");

      const result = await runPersistentAiChat({ userId: 42, message: "這幾家都不是，再幫我找別的" });

      expect(mockPlanNextOxmAction).toHaveBeenCalledTimes(1);
      expect(result.reply).toBe("了解，我幫你重新看看還有哪些選擇。");
    });

    it("CASE B8/B9：改地區／重新搜尋時 primaryService=factory_search 觸發新搜尋，走既有流程，不是 boundary", async () => {
      const freshResult = {
        candidates: [], total: 3, zeroResult: false,
        appliedFilters: { mainIndustries: ["金屬加工"], regions: ["彰化縣"], rankingSignals: [] },
        hasExplicitCapabilityMatch: true, directCapabilityMatchCount: 1, missingCoreCapabilities: [],
        viewAllUrl: "/search",
      };
      mockRunFactorySearchAction.mockResolvedValue(freshResult);
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "改找彰化的" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: EXISTING_FACTORY_STATE },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: "factory_search", resourceTarget: "factory_search",
        factorySourcingContextRelevant: false, factoryResultAnalysisRequest: false,
      });
      mockPlanNextOxmAction.mockResolvedValue({
        action: "none", reasonCategory: "other",
        actionPayload: { requestedCount: null },
        reason: "剛搜尋完，還不需要協尋",
      });
      mockComposeFinalResponse.mockResolvedValue("已經重新幫你找彰化的工廠了。");

      const result = await runPersistentAiChat({ userId: 42, message: "改找彰化的" });

      expect(mockRunFactorySearchAction).toHaveBeenCalledTimes(1);
      expect(result.factorySearchResult).toBe(freshResult);
      expect(result.reply).toBe("已經重新幫你找彰化的工廠了。");
    });

    it("CASE B10：沒有 currentFactorySearchState 時，即使模型誤判 factoryResultAnalysisRequest=true，也不會走 boundary 短路（因為程式碼要求 currentFactorySearchState 存在），finalReply 落回 routing 自己誠實產生的內容", async () => {
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "factory_search",
        factoryResultAnalysisRequest: true,
        finalReply: "我目前這段對話裡沒有可對應的工廠搜尋結果。如果你告訴我想找什麼類型的工廠，我可以先幫你搜尋。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "第二家適合我嗎？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("我目前這段對話裡沒有可對應的工廠搜尋結果。如果你告訴我想找什麼類型的工廠，我可以先幫你搜尋。");
    });

    it("CASE B11-B14 端到端：既有 Factory Search Context 存在，但這輪 resourceTarget 換成別的 target（例如 service_info）時，不會誤觸發 boundary（factoryResultAnalysisRequest 已經被 enforceResourceTargetGate 清空，這裡驗證 chatService 端到端不受影響）", async () => {
      mockBuildTurnContext.mockResolvedValue({
        history: [{ role: "user", content: "ERP服務是什麼？" }],
        previousState: { ...createEmptyConversationState(false), currentFactorySearchState: EXISTING_FACTORY_STATE },
      });
      mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
      mockRunOxmRouting.mockResolvedValue({
        ...BASE_ROUTING, primaryService: null, resourceTarget: "service_info",
        serviceTargets: ["erp"], factorySourcingContextRelevant: false, factoryResultAnalysisRequest: false,
        finalReply: "ERP 協助你盤點並優化生產管理。",
      });

      const result = await runPersistentAiChat({ userId: 42, message: "ERP服務是什麼？" });

      expect(mockRunFactorySearchAction).not.toHaveBeenCalled();
      expect(mockComposeFinalResponse).not.toHaveBeenCalled();
      expect(result.reply).toBe("ERP 協助你盤點並優化生產管理。");
    });
  });
});
