import { getAiFactoryContext, resolveApprovedAiFactoryContext, type AiFactoryContext } from "./factoryContext";
import { runEnterpriseDiagnosis } from "./diagnosis";
import { runOxmRouting } from "./routing";
import { buildTurnContext } from "./contextBuilder";
import { deriveConversationState, createEmptyConversationState, resolveConsecutiveOutOfDomainCasualTurns } from "./conversationState";
import {
  getActiveConversationForUser,
  getConversationForUser,
  createConversation,
  appendMessage,
  updateConversationStateAndAppendMessage,
} from "./conversationService";
import { getEnterpriseMemory, endConversationAndSummarize } from "./memory";
import { checkOutOfDomainResumeRelevance } from "./casualPauseGate";
import { isHandoffEligibleServiceKey, getHandoffServiceMapping } from "../../shared/ai/handoffServices";
import { runFactorySearchAction, deriveFactorySearchStatus, type FactorySearchActionResult } from "./factorySearchAction";
import {
  getPendingFactorySearchRequestForConversation,
  cancelFactorySearchRequestForConversation,
  applyFactorySourcingDecision,
  resolvePendingRequestIfSuperseded,
  type ManualSourcingResult,
} from "./factorySearchRequestService";
import { planNextOxmAction, type FactorySearchStateForPlanner } from "./actionPlanner";
import { composeFinalResponse } from "./responseComposer";
import { buildFactorySearchStateSnapshot, type FactorySearchStateSnapshot } from "./factorySearchState";
import { runNewsSearchAction, type NewsSearchActionResult } from "./newsSearchAction";
import { buildNewsSearchStateSnapshot, type NewsSearchStateSnapshot } from "./newsSearchState";
import { runSubsidyProgramsAction, type SubsidyProgramsActionResult } from "./subsidyProgramsAction";
import { buildGovSubsidyRecommendationForUi, type GovSubsidyRecommendationForUi } from "./govSubsidyRecommendationUi";
import { getNavigationEntry } from "../../shared/ai/navigationRegistry";
import { logAiError } from "./aiCallContext";
import type { AiConversation, AiFactorySearchRequest } from "../../drizzle/schema";
import type { AiChatTurn } from "./types";
import type { ConversationState } from "./conversationState";

export type { AiChatTurn } from "./types";

/**
 * 見對話中「非 OXM 純閒聊收斂機制」二階段設計：warned／paused 都用固定文案
 * （不是 LLM 生成），一來這本身就是產品政策文案，二來固定輸出才能真正省
 * token（不用為了措辭又跑一次 Layer 2／Composer）。
 */
const OUT_OF_DOMAIN_CASUAL_WARNED_REPLY =
  "我是 OXM 的企業助手，主要會把對話資源優先用在 OXM 相關服務與企業問題上。一般閒聊我可以陪你聊一下，但如果聊得比較久，我會優先把對話拉回找工廠、企業經營或 OXM 服務相關的內容，還請你體諒。";
const OUT_OF_DOMAIN_CASUAL_PAUSED_REPLY =
  "OXM AI 已暫停一般閒聊。如果你有 OXM、找工廠、企業經營或相關服務需求，我就會繼續協助你。";

/**
 * 見對話中「Current Factory Search State 沒有真正被保存」的架構修正：這是
 * 這一輪「最終、準備寫回 ConversationState」的 Factory Search State 快照，
 * 跟給 Action Planner 看的 FactorySearchStateForPlanner 分開算——後者多包了
 * activeFactorySearchRequest（不持久化進 snapshot 本身，見
 * factorySearchState.ts 的說明），這裡只算真正要存回 aiConversations.
 * currentStateJson 的那份。
 *
 * 決定順序：
 * 1. 這輪有真的重新搜尋（factorySearchResult）→ 用它重建全新快照（見「三」）。
 * 2. 沒有重新搜尋，但這段對話原本就有 snapshot（currentFactorySearchState）
 *    → 原樣沿用（見「十四：沒有新搜尋時原樣保留，不會被清空」）。
 * 3. 兩者都沒有，但有既有 pending request（理論上少見——有 pending 通常代表
 *    之前一定搜尋過、snapshot 應該存在，這裡只是防禦性 fallback）→ 從
 *    pending 的欄位組一份最小快照。
 * 4. 都沒有 → null。
 */
function resolveFactorySearchStateSnapshot(params: {
  factorySearchResult: FactorySearchActionResult | null;
  currentFactorySearchState: FactorySearchStateSnapshot | null;
  pendingFactorySearchRequest: AiFactorySearchRequest | null;
}): FactorySearchStateSnapshot | null {
  const { factorySearchResult, currentFactorySearchState, pendingFactorySearchRequest } = params;
  if (factorySearchResult) {
    const previousRequestedMatchCount =
      currentFactorySearchState?.requestedMatchCount ?? pendingFactorySearchRequest?.requestedMatchCount ?? null;
    return buildFactorySearchStateSnapshot(factorySearchResult, previousRequestedMatchCount);
  }
  if (currentFactorySearchState) return currentFactorySearchState;
  if (pendingFactorySearchRequest) {
    const p = pendingFactorySearchRequest;
    const hardFilters = p.hardFiltersJson as { mainIndustries: string[]; regions: string[] };
    const coreCapabilities = (p.coreCapabilitiesJson as string[] | null) ?? [];
    return {
      hardFilters,
      coreCapabilities,
      candidateCount: p.candidateCount,
      directCapabilityMatchCount: p.directCapabilityMatchCount,
      missingCoreCapabilities: [],
      status: deriveFactorySearchStatus({
        candidateCount: p.candidateCount,
        coreCapabilityCount: coreCapabilities.length,
        hasExplicitCapabilityMatch: p.directCapabilityMatchCount > 0,
      }),
      requestedMatchCount: p.requestedMatchCount,
      topResults: [],
      searchSummary: p.requestSummary,
      lastSearchAt: p.updatedAt.toISOString(),
    };
  }
  return null;
}

/** Planner 這輪有給明確數字就用它（已經是 AI 換算過的絕對值），沒有就沿用既有快照記錄的值，不會平白把已知的期望家數洗掉。 */
function resolveRequestedMatchCount(plannerValue: number | null, existing: FactorySearchStateSnapshot | null): number | null {
  if (plannerValue != null) return plannerValue;
  return existing?.requestedMatchCount ?? null;
}

/**
 * Phase 6B：同上 resolveFactorySearchStateSnapshot 的邏輯，News Search 版本，
 * 但比工廠搜尋簡單——沒有 pending request 這個概念（見「十三：不要人工協
 * 尋」），只有「這輪重新搜尋」跟「沿用既有快照」兩種情況。
 */
function resolveNewsSearchStateSnapshot(params: {
  newsSearchResult: NewsSearchActionResult | null;
  currentNewsSearchState: NewsSearchStateSnapshot | null;
}): NewsSearchStateSnapshot | null {
  const { newsSearchResult, currentNewsSearchState } = params;
  if (newsSearchResult) return buildNewsSearchStateSnapshot(newsSearchResult);
  return currentNewsSearchState;
}

/**
 * Phase 6C（見「十三：Navigation Registry 必須是 server-authoritative」）：
 * routing.navigationTarget 只會是 Registry 裡的 key 或 null（parseRouting 已經
 * 驗證過），這裡查出真正的 title／route 給 client 顯示按鈕用——模型全程沒有
 * 機會輸出任何 URL 字串。
 */
export interface NavigationAction {
  key: string;
  title: string;
  route: string;
}

function resolveNavigationAction(navigationTarget: string | null): NavigationAction | null {
  if (!navigationTarget) return null;
  const entry = getNavigationEntry(navigationTarget);
  if (!entry) return null;
  return { key: entry.key, title: entry.title, route: entry.route };
}

/**
 * OXM AI 對話核心——兩條路徑：
 *
 * 1. runAiChat()：無狀態單輪，被訪客聊天（沒有 userId）與本地測試腳本
 *    （scripts/ai-test-cases.ts）共用，行為跟 Phase 1.1 完全一樣，不落地
 *    任何 DB。
 * 2. runPersistentAiChat()：Phase 2 新增，登入使用者專用。伺服器端管理
 *    conversation／messages／state，client 只需要傳這一句新訊息，不需要也
 *    不被信任傳完整歷史（見對話中「十五、AI Router 調整」：client 不能偽造
 *    一大段歷史騙 server 當真的）。
 *
 * 兩條路徑共用同一組 Layer 1 / Layer 2（diagnosis.ts / routing.ts），差別只
 * 在「歷史從哪裡來、要不要落地」。
 */
export interface StatelessChatResult {
  reply: string;
  /**
   * Phase 6A：找工廠不是顧問服務，AI 直接操作既有工廠搜尋資源（不建立 AI
   * Handoff Context、不建顧問案件、見對話中「先更正一個產品定位」），訪客
   * （未登入）一樣可以使用——跟 factory.search 本身是 publicProcedure 的既有
   * 權限一致（見「二十三、權限」：找工廠沿用現有 AI login gate，不另外要求
   * 登入）。只有 Layer 2 判斷 primaryService 是 "factory_search" 時才有值。
   */
  factorySearchResult: FactorySearchActionResult | null;
  /** Phase 6B：見 factorySearchResult 的說明，找消息版本。只有 Layer 2 判斷 primaryService 是 "news" 時才有值。 */
  newsSearchResult: NewsSearchActionResult | null;
  /** Phase 6C：見 factorySearchResult 的說明，政府補助方案查詢版本。只有 Layer 2 判斷 govSubsidyLookupRelevant 為真時才有值。 */
  subsidyProgramsResult: SubsidyProgramsActionResult | null;
  /** Phase 6C：站內導覽（見對話中「站內 Navigation Action」），只有 Layer 2 判斷 navigationTarget 有對應到 Registry 裡的 key 時才有值。 */
  navigationAction: NavigationAction | null;
  /** Phase 7.1：見 PersistentChatResult.govSubsidyRecommendation 的說明，訪客版本。 */
  govSubsidyRecommendation: GovSubsidyRecommendationForUi | null;
}

export async function runAiChat(params: {
  history: AiChatTurn[];
  userId: number | null;
}): Promise<StatelessChatResult> {
  const factoryContext: AiFactoryContext | null = params.userId
    ? await getAiFactoryContext(params.userId)
    : null;

  const diagnosis = await runEnterpriseDiagnosis({
    history: params.history,
    factoryContext,
  });

  try {
    const routing = await runOxmRouting({
      diagnosis,
      history: params.history,
      factoryContext,
    });
    const factorySearchResult =
      routing.primaryService === "factory_search" ? await runFactorySearchAction(params.history) : null;
    const newsSearchResult =
      routing.primaryService === "news" ? await runNewsSearchAction(params.history) : null;
    const subsidyProgramsResult =
      routing.govSubsidyLookupRelevant ? await runSubsidyProgramsAction(params.history) : null;
    const navigationAction = resolveNavigationAction(routing.navigationTarget);
    const govSubsidyRecommendation = buildGovSubsidyRecommendationForUi(routing.govSubsidyRecommendation);
    return {
      reply: routing.finalReply,
      factorySearchResult,
      newsSearchResult,
      subsidyProgramsResult,
      navigationAction,
      govSubsidyRecommendation,
    };
  } catch (error) {
    logAiError("layer2Pipeline", "Layer 2 pipeline failed, falling back to Layer 1 content", error);
    const reply =
      diagnosis.nextBestQuestion ??
      diagnosis.recommendedBusinessDirection ??
      "能再多說一點你現在遇到的狀況嗎？";
    return {
      reply,
      factorySearchResult: null,
      newsSearchResult: null,
      subsidyProgramsResult: null,
      navigationAction: null,
      govSubsidyRecommendation: null,
    };
  }
}

export interface HandoffOffer {
  serviceKey: string;
  displayName: string;
}

export interface PersistentChatResult {
  reply: string;
  conversationId: number;
  /**
   * 只有 Layer 2 判斷 shouldOfferHandoff 為真、且主推薦服務屬於本輪已經串接
   * 既有表單的 5 個服務時才會有值（見 shared/ai/handoffServices.ts）——找工廠
   * ／找消息本輪不走這套 CTA，即使 primaryService 剛好是它們也不會出現在
   * 這裡（見對話中「二十三、只有可真人承接服務才顯示 CTA」）。client 只根據
   * 這個欄位決定要不要顯示【幫你送出詢問】按鈕，實際建立 handoff context
   * 時 server 會重新驗證一次，不會只信任這裡回傳過的值。
   */
  handoffOffer: HandoffOffer | null;
  /** Phase 6A：見 StatelessChatResult.factorySearchResult 的說明，登入使用者版本。 */
  factorySearchResult: FactorySearchActionResult | null;
  /** Phase 6B：見 StatelessChatResult.newsSearchResult 的說明，登入使用者版本。 */
  newsSearchResult: NewsSearchActionResult | null;
  /** Phase 6C：見 StatelessChatResult.subsidyProgramsResult 的說明，登入使用者版本。 */
  subsidyProgramsResult: SubsidyProgramsActionResult | null;
  /** Phase 6C：見 StatelessChatResult.navigationAction 的說明，登入使用者版本。 */
  navigationAction: NavigationAction | null;
  /**
   * Phase 6A.1：這一輪是否觸發／更新／維持了一筆人工協尋 request——只有登入
   * 使用者才有（訪客沒有 userId，人工協尋沒有對象可以回覆，見對話中「十八、
   * Request 必須有 Ownership」）。client 用這個欄位決定要不要顯示「已交由
   * OXM 人工協尋」的誠實文案，不自己猜測或詢問使用者要不要協尋。
   */
  manualSourcing: ManualSourcingResult | null;
  /**
   * Phase 7.1（見對話中「P0-2：Government Subsidy Recommendation 專屬 UI」）：
   * routing.govSubsidyRecommendation 的 UI-ready 版本（見
   * govSubsidyRecommendationUi.ts），只在有明確 primaryProgramKey 時才非
   * null。純 transport／type mapping，不改變 routing.ts 原本的判斷邏輯。
   */
  govSubsidyRecommendation: GovSubsidyRecommendationForUi | null;
  /**
   * Phase 7.1（見對話中「P1-6：Factory Boundary 下一步 UX」）：這一輪是否觸發
   * 了 Factory Result Boundary（見下方 isFactoryResultBoundary 的既有判斷，
   * 這裡只是把已經算出來的值回傳給 client，不是新的判斷）。client 只在這個
   * 欄位為 true、且對話中確實存在較早的 factory_search_results attachment
   * 時，才顯示「查看剛剛的工廠」CTA——不靠 finalReply 文字判斷。
   */
  factoryResultBoundary: boolean;
}

function resolveHandoffOffer(state: ConversationState): HandoffOffer | null {
  if (!state.handoffReady) return null;
  const primaryServiceKey = state.candidateServiceKeys[0];
  if (!isHandoffEligibleServiceKey(primaryServiceKey)) return null;
  const mapping = getHandoffServiceMapping(primaryServiceKey);
  if (!mapping) return null;
  return { serviceKey: mapping.serviceKey, displayName: mapping.displayName };
}

/**
 * 解析這一輪要用哪個 conversation（見「七、Conversation Boundary」）：
 * - client 帶了 conversationId、而且真的是這個 user 名下還 active 的那筆
 *   → 延續同一頁面內的同一段對話（收合再打開也是這個狀況）。
 * - 否則視為「新的使用階段」開始（refresh／重新進頁／離開後再訪）：先把
 *   這個 user 名下任何殘留的 active 對話收尾（產生摘要寫入 Enterprise
 *   Memory，成功才刪除原文；失敗就標記 failed 待重試，不擋住這次新對話），
 *   再建立一筆全新的 conversation。
 *
 * 這裡刻意不相信 client 傳來的 conversationId 本身（先用
 * getConversationForUser 驗證擁有權與 active 狀態），避免被拿別人的
 * conversationId 或已經收尾的舊 id 誤導。
 */
async function resolveConversationForTurn(
  userId: number,
  factoryId: number | null,
  clientConversationId: number | null | undefined
): Promise<AiConversation> {
  if (clientConversationId) {
    const owned = await getConversationForUser(clientConversationId, userId);
    if (owned && owned.status === "active") {
      // Phase 11.2（見「九、Conversation Reuse」）：conversation.factoryId 現在
      // 是 enterprise context boundary，不只是資訊性 snapshot——一旦這個 user
      // 目前解析出來的 approved factoryId（可能因為換工廠、工廠審核狀態變化
      // 而跟建立當下不同）跟這筆 conversation 的 factoryId 不一致，絕對不能
      // 沿用，否則就是把 A 工廠的對話接到 B 工廠 context 下（Phase 11.1
      // Audit 認定的 P0 cross-factory leakage 的另一種觸發方式）。安全策略是
      // 照常收尾這筆舊 conversation（跟下面「殘留 orphaned 對話」走同一套安全
      // 收尾邏輯），再建立一筆全新、factoryId 正確的 conversation。Admin
      // 無工廠情境下兩邊都是 null，視為相符，正常沿用。
      if (owned.factoryId === factoryId) {
        return owned;
      }
      await endConversationAndSummarize(owned);
    }
  }

  const orphaned = await getActiveConversationForUser(userId);
  if (orphaned) {
    await endConversationAndSummarize(orphaned);
  }

  return createConversation(userId, factoryId);
}

/**
 * Server-authoritative 流程：
 * 解析/收尾 conversation → 寫入 user message → 載入 currentState + 最近必要
 * messages（Context Builder）+ 跨對話 Enterprise Memory → Layer 1 → Layer 2
 * → 更新 currentState → 寫入 assistant message → 回傳 reply + conversationId。
 */
export async function runPersistentAiChat(params: {
  userId: number;
  message: string;
  /** client 端記憶體內保存的 conversationId（同頁面內續聊用），refresh 後前端會是 undefined。 */
  conversationId?: number | null;
}): Promise<PersistentChatResult> {
  const factory = await resolveApprovedAiFactoryContext(params.userId);
  const factoryContext = factory?.context ?? null;

  const conversation = await resolveConversationForTurn(params.userId, factory?.id ?? null, params.conversationId);

  await appendMessage(conversation.id, "user", params.message);

  const turnContext = await buildTurnContext(conversation);
  // buildTurnContext 是在寫入這則使用者訊息「之後」才讀的，所以這裡的
  // history 已經包含剛剛寫入的這句，不需要再手動 append 一次。

  // 見對話中「非 OXM 純閒聊收斂機制」二階段設計：一旦上一輪已經進入
  // warned／paused，這一輪「要不要恢復」只用極輕量的 casualPauseGate 判斷
  // （見 casualPauseGate.ts 檔頭說明），完全不跑完整 Terra Diagnosis →
  // Routing → Planner → Composer——這才是真正的 token 節省，不是只換掉回覆
  // 文字。判斷「不相關」就直接用固定文案回覆並提前 return，判斷「相關」則
  // 標記 resumedFromPause，繼續往下走完整 pipeline（跟一般正常輪次完全一
  // 樣），事後統一把 mode 收斂回 normal（見下方 try/catch 之後的收斂邏輯）。
  const previousOutOfDomainCasualMode = turnContext.previousState?.outOfDomainCasualMode ?? "normal";
  let resumedFromPause = false;

  if (previousOutOfDomainCasualMode !== "normal") {
    const stillRelevant = await checkOutOfDomainResumeRelevance(params.message);
    if (!stillRelevant) {
      const pausedState: ConversationState = {
        ...(turnContext.previousState ?? createEmptyConversationState(!!factoryContext)),
        lastUpdatedAt: new Date().toISOString(),
        outOfDomainCasualMode: "paused",
      };
      await updateConversationStateAndAppendMessage(conversation.id, pausedState, "assistant", OUT_OF_DOMAIN_CASUAL_PAUSED_REPLY);
      return {
        reply: OUT_OF_DOMAIN_CASUAL_PAUSED_REPLY,
        conversationId: conversation.id,
        handoffOffer: null,
        factorySearchResult: null,
        newsSearchResult: null,
        subsidyProgramsResult: null,
        navigationAction: null,
        manualSourcing: null,
        govSubsidyRecommendation: null,
        factoryResultBoundary: false,
      };
    }
    resumedFromPause = true;
  }

  // Phase 11.2（見「三十七、No Memory Without Factory」）：沒有 approved
  // 工廠 context 就完全不讀 Enterprise Memory——不呼叫 getEnterpriseMemory，
  // 不 fallback 成 userId、不 fallback 成任何其他工廠。這是唯一允許的讀取
  // 條件，Admin 沒有 approved 工廠時 factory 必為 null，這裡自動落在這個
  // 分支，不需要另外判斷 entitlement.kind。
  const memoryRow = factory ? await getEnterpriseMemory(factory.id) : null;
  const enterpriseMemory = memoryRow
    ? {
        summaryText: memoryRow.summaryText,
        hasMeaningfulBusinessInfo: memoryRow.hasMeaningfulBusinessInfo,
        lastInteractionHadMeaningfulInfo: memoryRow.lastInteractionHadMeaningfulInfo,
      }
    : null;

  // OXM Action Registry + AI Action Planner：先查這個 conversation 目前有沒有
  // pending 人工協尋，以及這段對話目前的 Factory Search State（見對話中
  // 「Current Factory Search State 沒有真正被保存」的架構修正）——兩者都不
  // 餵給 Layer 1（見「十六」：Layer 1 只管企業問題診斷，不管 OXM Action），
  // currentFactorySearchState 會餵給 Layer 2（判斷 factorySourcingContextRelevant
  // 用），兩者都會餵給下面的 Action Planner。
  const pendingFactorySearchRequest = await getPendingFactorySearchRequestForConversation(conversation.id);
  const currentFactorySearchState = turnContext.previousState?.currentFactorySearchState ?? null;
  // Phase 6B：找消息沒有 pending request 這個概念（見「十三」），只需要既有
  // News Search State 本身，一樣不餵給 Layer 1，會餵給 Layer 2（判斷
  // newsSearchContextRelevant 用）。
  const currentNewsSearchState = turnContext.previousState?.currentNewsSearchState ?? null;

  const diagnosis = await runEnterpriseDiagnosis({
    history: turnContext.history,
    factoryContext,
    previousState: turnContext.previousState,
    enterpriseMemory,
  });

  // 見「非 OXM 純閒聊收斂機制」：唯一權威計算式，Layer 2 的 finalReply 措辭
  // 跟這一輪最終要寫回 state 的值都用同一個結果，不會兩處各自重算漂移。
  const consecutiveOutOfDomainCasualTurns = resolveConsecutiveOutOfDomainCasualTurns(diagnosis, turnContext.previousState);

  let finalReply: string;
  let nextState = turnContext.previousState ?? createEmptyConversationState(!!factoryContext);
  let factorySearchResult: FactorySearchActionResult | null = null;
  let newsSearchResult: NewsSearchActionResult | null = null;
  let subsidyProgramsResult: SubsidyProgramsActionResult | null = null;
  let navigationAction: NavigationAction | null = null;
  let manualSourcing: ManualSourcingResult | null = null;
  // Phase 10.2 P1（見「十八、十九」）：cancel_factory_sourcing 成功時
  // manualSourcing 會被設回跟「這輪本來就沒有任何 sourcing」一樣的預設形狀
  // （{triggered:false,...}），所以不能只靠 manualSourcing.triggered 判斷
  // 「這輪是不是真的成功執行過一個有副作用的 action」——額外用這個旗標記錄
  // 「這輪真的成功執行了取消」，供下面 catch 區塊組出誠實訊息時使用。
  let sourcingCancelledThisTurn = false;
  // Phase 7.1：Layer 2 呼叫失敗（下面 catch 分支）時維持預設值，跟其他 Action
  // 結果欄位的既有慣例一致。
  let govSubsidyRecommendation: GovSubsidyRecommendationForUi | null = null;
  let factoryResultBoundary = false;
  // 這一輪最終要寫回 ConversationState 的 Factory Search State，預設沿用舊值
  // 不變（見「十四」）；只有真的重新搜尋，或 Planner 這輪換算出新的
  // requestedCount 時才會被更新。
  let resolvedFactorySearchState = currentFactorySearchState;
  // Phase 6B：同上，News Search State 版本。
  let resolvedNewsSearchState = currentNewsSearchState;

  try {
    const routing = await runOxmRouting({
      diagnosis,
      history: turnContext.history,
      factoryContext,
      enterpriseMemory,
      currentFactorySearchState,
      currentNewsSearchState,
      consecutiveOutOfDomainCasualTurns,
    });
    finalReply = routing.finalReply;
    // Phase 7.1：純 transport，把這次 Layer 2 呼叫本來就有的
    // routing.govSubsidyRecommendation 轉成 UI-ready 形狀，不改變判斷邏輯。
    govSubsidyRecommendation = buildGovSubsidyRecommendationForUi(routing.govSubsidyRecommendation);
    // Phase 6A：只在「這一輪」Layer 2 真的判斷出 factory_search 時才觸發，不
    // 沿用舊值。search_factories 這個 Action 的觸發時機沿用既有 Layer 2
    // 判斷，不用 Action Planner 再問一次「要不要搜尋」（見「十六」：
    // factory_search 是 resource direction，search_factories 只是把既有機制
    // 原樣接上；Action Planner 專心負責搜尋結果之後的 business action）。
    if (routing.primaryService === "factory_search") {
      factorySearchResult = await runFactorySearchAction(turnContext.history, conversation.id);
    }
    // Phase 6B：同上，找消息版本——一樣直接沿用 Layer 2 的 primaryService
    // 判斷，不用額外的 LLM 呼叫再問一次「要不要搜尋」。
    if (routing.primaryService === "news") {
      newsSearchResult = await runNewsSearchAction(turnContext.history);
    }
    // Phase 6C：政府補助方案查詢——獨立於 primaryService（見 routing.ts
    // govSubsidyLookupRelevant 的說明：informational 詢問特定方案本身時，
    // primaryService 會被 enforceDiagnosisGate 清空，但這個欄位不受影響，
    // 才能讓「CITD是什麼？」這種問法也走真實 DB 查詢，不是走原本 Layer 2
    // 自己背知識回答）。沒有持久化的 currentSubsidyQueryState（見「十九」），
    // 每次觸發都是這一輪即時查詢。
    if (routing.govSubsidyLookupRelevant) {
      subsidyProgramsResult = await runSubsidyProgramsAction(turnContext.history);
    }
    // Phase 6C：站內導覽——同樣獨立於 primaryService／conversationIntent，
    // 純粹讀 Registry，不影響 Handoff 或其他 Action 分支（見「十五：Navigation
    // 不等於 Handoff」）。
    navigationAction = resolveNavigationAction(routing.navigationTarget);

    // Action Planner／Final Response Composer 呼叫條件（見「四、Planner
    // invocation 條件必須修正」，及「OXM AI 已完成功能整體驗收修正」三十：
    // 不要讓 Factory Search State 污染一般企業診斷）：這輪真的重新搜尋過，
    // 或者這段對話有既有 Factory Search Context 且 Layer 2 語意判斷這一輪
    // 確實在延續或評論它（factorySourcingContextRelevant，見
    // routing.ts——這是既有 Layer 2 呼叫多輸出的一個欄位，不是新的 LLM
    // call，見「十七」）。
    //
    // 刻意移除「只要有 pendingFactorySearchRequest 就無條件觸發」這個舊分支
    // ——那會讓使用者聊完全不相關的新問題（例如「我現在工廠訂單很少」）時，
    // 仍然因為背景還有一筆 pending 協尋，就被強迫掛上工廠搜尋的 wording／
    // relevance gate 才是唯一該判斷「這輪跟工廠搜尋有沒有關係」的地方；一筆
    // pending request 一定伴隨著 currentFactorySearchState 一起建立（見
    // applyFactorySourcingDecision／buildFactorySearchStateSnapshot），所以
    // 這裡拿掉獨立分支不會漏掉「使用者對既有 pending 表達取消」的情況——那種
    // 情況 factorySourcingContextRelevant 一樣會判斷為 true。
    // Phase 6F（見對話中「Factory Search Result Boundary」）：這一輪如果沒有
    // 真的重新搜尋、且 Layer 2 判斷使用者是在要求對既有搜尋結果做逐家解釋／
    // 比較／排名／推薦，一律不進 Action Planner——不呼叫任何額外模型、不把
    // topResults 重新送進任何 prompt，finalReply 直接沿用上面這次 Layer 2
    // 呼叫本身產生的邊界回覆（見 routing.ts 的 FACTORY_RESULT_BOUNDARY_REPLY_RULE），
    // 維持 shouldPlanFactoryAction 為 false 即可，不需要額外程式碼組回覆。
    const isFactoryResultBoundary =
      !factorySearchResult && !!currentFactorySearchState && routing.factoryResultAnalysisRequest;
    // Phase 7.1：把這個既有判斷回傳給 client（見 P1-6），純轉發，不是新判斷。
    factoryResultBoundary = isFactoryResultBoundary;

    const shouldPlanFactoryAction =
      !isFactoryResultBoundary &&
      (!!factorySearchResult ||
        (!!currentFactorySearchState && routing.factorySourcingContextRelevant));

    if (shouldPlanFactoryAction) {
      // 見「五、不要靠 raw transcript 當 authoritative search state」：
      // hardFilters／candidateCount／directMatchCount 等一律來自這個
      // server-authoritative snapshot（這輪剛搜的，或沿用之前搜過的），不是
      // 讓模型自己從逐字稿重新猜上一輪搜了什麼；raw transcript（下面傳給
      // planNextOxmAction 的 history）只用來理解「這一輪在講什麼、指涉的是
      // 什麼」，不是搜尋狀態的資料來源。
      const workingSnapshot = resolveFactorySearchStateSnapshot({
        factorySearchResult,
        currentFactorySearchState,
        pendingFactorySearchRequest,
      });

      if (workingSnapshot) {
        const factorySearchState: FactorySearchStateForPlanner = {
          ...workingSnapshot,
          activeFactorySearchRequest: pendingFactorySearchRequest
            ? { status: pendingFactorySearchRequest.status, requestSummary: pendingFactorySearchRequest.requestSummary }
            : null,
        };
        // 見「十」：Action Planner 現在只回傳結構化決定，不生成任何文字。
        const decision = await planNextOxmAction({ history: turnContext.history, factorySearchState });
        const requestedMatchCount = resolveRequestedMatchCount(decision.actionPayload.requestedCount, workingSnapshot);
        // Planner 換算出的 requestedCount（如果有）併回 snapshot，讓下一輪
        // 即使沒有重新搜尋，也還記得使用者最新表達過的期望家數。
        resolvedFactorySearchState = { ...workingSnapshot, requestedMatchCount };

        // 見「九」：只有 action 真的執行成功，才能讓 Composer 說「已經交給
        // OXM」；outcome 一律由 server 自己實際執行的結果決定，不信任 AI。
        let actionOutcome: "succeeded" | "failed" | "not_applicable" = "not_applicable";

        if (decision.action === "request_factory_sourcing") {
          // 見「二十一」：AI 決定要不要 request_factory_sourcing，但
          // hardFilters／candidateCount／directCapabilityMatchCount／userId／
          // conversationId／factoryId 一律用 server-authoritative 的
          // workingSnapshot／這次真實算出來的資料，不信任模型輸出的任何數字
          // 或 id；requestedCount 是唯一允許沿用 AI 判斷的欄位，且只是
          // informational。
          try {
            const { requestId } = await applyFactorySourcingDecision({
              userId: params.userId,
              conversationId: conversation.id,
              factoryId: factory?.id ?? null,
              mainIndustries: workingSnapshot.hardFilters.mainIndustries,
              regions: workingSnapshot.hardFilters.regions,
              coreCapabilities: workingSnapshot.coreCapabilities,
              candidateCount: workingSnapshot.candidateCount,
              directCapabilityMatchCount: workingSnapshot.directCapabilityMatchCount,
              missingCapabilities: workingSnapshot.missingCoreCapabilities,
              requestedMatchCount,
              plannerReason: decision.reason,
            });
            manualSourcing = { triggered: true, reason: decision.reasonCategory, requestId };
            actionOutcome = "succeeded";
          } catch (sourcingError) {
            logAiError("actionPlanner", `applyFactorySourcingDecision failed for conversation ${conversation.id}`, sourcingError);
            manualSourcing = { triggered: false, reason: null, requestId: null };
            actionOutcome = "failed";
          }
        } else if (decision.action === "cancel_factory_sourcing" && pendingFactorySearchRequest) {
          try {
            await cancelFactorySearchRequestForConversation({ conversationId: conversation.id, userId: params.userId });
            manualSourcing = { triggered: false, reason: null, requestId: null };
            sourcingCancelledThisTurn = true;
            actionOutcome = "succeeded";
          } catch (cancelError) {
            logAiError("actionPlanner", `cancelFactorySearchRequestForConversation failed for conversation ${conversation.id}`, cancelError);
            actionOutcome = "failed";
          }
        } else if (pendingFactorySearchRequest) {
          // action 是 none，但這段對話還留著一筆更早的 pending——代表這次
          // 新搜尋客觀上已經超越／取代了那個需求（見
          // factorySearchRequestService.ts resolvePendingRequestIfSuperseded
          // 的說明），只在「這輪真的有跑過新搜尋」時才這樣自動收尾，避免在
          // 單純延續舊搜尋狀態（沒有重新搜尋）時誤清掉一筆使用者其實還在
          // 等待的 pending。
          if (factorySearchResult) {
            await resolvePendingRequestIfSuperseded(conversation.id);
          }
          manualSourcing = { triggered: false, reason: null, requestId: null };
        }

        // 見「十一」：Final Response Composer 是本輪唯一允許新增的一次
        // LLM call（跟 Action Planner 共用同一個 shouldPlanFactoryAction
        // gate，不是每輪都多打），它同時看得到搜尋狀態與 action 的真實執行
        // 結果，wording 才不會偏離事實。composer 本身失敗會被外層 catch
        // 攔截，走既有 Layer-2-failure fallback（見下方 catch 區塊）。
        finalReply = await composeFinalResponse({
          history: turnContext.history,
          factorySearch: { ...workingSnapshot, isFreshSearch: !!factorySearchResult },
          action: decision.action === "none" ? null : { action: decision.action, reasonCategory: decision.reasonCategory, outcome: actionOutcome },
        });
      }
    } else {
      // Phase 6B：找消息版本——同樣的邏輯，但沒有 Action Planner（見「十三：
      // 不要人工協尋」），這輪真的重新搜尋過、或既有 News Search Context 且
      // Layer 2 判斷這一輪確實在延續或評論它，就呼叫 Composer 針對消息搜尋
      // 狀態組出誠實的回覆。跟工廠搜尋分支互斥（else），同一輪只會有其中一種
      // Tool Result，不會同時發生。
      const shouldComposeNewsReply =
        !!newsSearchResult ||
        (!!currentNewsSearchState && routing.newsSearchContextRelevant);

      if (shouldComposeNewsReply) {
        const workingNewsSnapshot = resolveNewsSearchStateSnapshot({ newsSearchResult, currentNewsSearchState });
        if (workingNewsSnapshot) {
          resolvedNewsSearchState = workingNewsSnapshot;
          // 見「十一」的同一種設計：Composer 是本輪唯一允許新增的一次 LLM
          // call，跟 shouldComposeNewsReply 共用同一個 gate，不是每輪都多打。
          finalReply = await composeFinalResponse({
            history: turnContext.history,
            newsSearch: { ...workingNewsSnapshot, isFreshSearch: !!newsSearchResult },
            action: null,
          });
        }
      } else if (subsidyProgramsResult) {
        // Phase 6C：政府補助方案查詢版本——沒有跨輪持久狀態（見「十九：不要
        // 為了形式硬加」），只要這一輪真的觸發過查詢就一定呼叫 Composer 針對
        // 真實 DB 結果組出誠實回覆；跟工廠搜尋／找消息分支互斥。
        finalReply = await composeFinalResponse({
          history: turnContext.history,
          subsidySearch: subsidyProgramsResult,
          action: null,
        });
      }
    }

    nextState = deriveConversationState({
      diagnosis,
      routing,
      previousState: turnContext.previousState,
      companyContextKnown: !!factoryContext,
      factorySearchState: resolvedFactorySearchState,
      newsSearchState: resolvedNewsSearchState,
      consecutiveOutOfDomainCasualTurns,
    });
  } catch (error) {
    logAiError("layer2Pipeline", `Layer 2 pipeline failed for conversation ${conversation.id}, falling back to Layer 1 content`, error);
    // 見「十八、十九」：manualSourcing／sourcingCancelledThisTurn 是宣告在
    // try 區塊外面的變數，這裡讀到的是「拋錯之前，action 真正執行到的最新
    // 結果」——如果 applyFactorySourcingDecision／
    // cancelFactorySearchRequestForConversation 已經成功、只是後面的
    // composeFinalResponse（或同一個 try 區塊內更後面的其他步驟）才失敗，
    // 不能用下面這句通用的 Layer 1 備援文案掩蓋掉「這個有副作用的 action
    // 其實已經成功」的事實——那會讓使用者誤以為剛剛的操作沒生效，見「十九」
    // 明確要求「不能暗示 action 失敗、不能觸發可能導致重複送出的 Retry」。
    // 沒有真的執行過任何有副作用 action 時（多數情況），仍然走原本的通用
    // 備援文案，不改變既有行為。
    if (manualSourcing?.triggered) {
      finalReply = "已經幫你送出人工找廠需求，OXM 會接續協助處理。這次回覆整理暫時發生問題，但不影響剛剛已送出的需求。";
    } else if (sourcingCancelledThisTurn) {
      finalReply = "已經幫你取消這筆人工找廠需求。這次回覆整理暫時發生問題，但不影響剛剛的取消結果。";
    } else {
      finalReply =
        diagnosis.nextBestQuestion ??
        diagnosis.recommendedBusinessDirection ??
        "能再多說一點你現在遇到的狀況嗎？";
    }
    // Layer 2 失敗時仍然用 Layer 1 的內容更新 state 裡跟診斷有關的欄位，只是
    // 服務分流相關欄位（candidateServiceKeys/handoffReady/serviceRelationship）
    // 維持前一輪的值，不能沒有 Layer 2 結果就亂猜。
    nextState = {
      ...nextState,
      companyContextKnown: !!factoryContext,
      observedProblem: diagnosis.observedProblem || nextState.observedProblem,
      likelyBottleneck: diagnosis.likelyBottleneck,
      bottleneckStatus: diagnosis.bottleneckStatus,
      primaryBusinessDirection: diagnosis.recommendedBusinessDirection,
      secondaryConcern: diagnosis.secondaryConcern,
      userWantsAction: diagnosis.userWantsAction,
      confirmedFacts: { ...nextState.confirmedFacts, ...diagnosis.confirmedFacts },
      unresolvedQuestion: diagnosis.nextBestQuestion,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  // 見對話中「非 OXM 純閒聊收斂機制」二階段設計：這一輪如果是從
  // warned／paused 恢復（casualPauseGate 判斷相關才會走到這裡），無論
  // diagnosis 這輪重新算出的 consecutiveOutOfDomainCasualTurns 是多少，都直接
  // 收斂回 normal——使用者已經主動把話題拉回來，不該還卡在 warned／paused。
  // 否則才判斷「這一輪是不是第一次跨過門檻」：只有上一輪還是 normal、這一輪
  // 累計達到 4 才轉成 warned，並且用固定文案覆蓋掉 Layer 2／Composer 這輪
  // 產生的措辭（見「warned」欄位說明：固定輸出才能真正省 token，不用為了
  // 這句提醒又跑一次生成）。
  if (resumedFromPause) {
    nextState = { ...nextState, outOfDomainCasualMode: "normal" };
  } else if (previousOutOfDomainCasualMode === "normal" && nextState.consecutiveOutOfDomainCasualTurns >= 4) {
    nextState = { ...nextState, outOfDomainCasualMode: "warned" };
    finalReply = OUT_OF_DOMAIN_CASUAL_WARNED_REPLY;
  } else {
    nextState = { ...nextState, outOfDomainCasualMode: "normal" };
  }

  await updateConversationStateAndAppendMessage(conversation.id, nextState, "assistant", finalReply);

  return {
    reply: finalReply,
    conversationId: conversation.id,
    handoffOffer: resolveHandoffOffer(nextState),
    factorySearchResult,
    newsSearchResult,
    subsidyProgramsResult,
    navigationAction,
    manualSourcing,
    govSubsidyRecommendation,
    factoryResultBoundary,
  };
}
