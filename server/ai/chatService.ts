import { getAiFactoryContext, resolveAiFactory, type AiFactoryContext } from "./factoryContext";
import { runEnterpriseDiagnosis } from "./diagnosis";
import { runOxmRouting } from "./routing";
import { buildTurnContext } from "./contextBuilder";
import { deriveConversationState, createEmptyConversationState, resolveConsecutiveOutOfDomainCasualTurns } from "./conversationState";
import {
  getActiveConversationForUser,
  getConversationForUser,
  createConversation,
  appendMessage,
  updateConversationState,
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
    return { reply: routing.finalReply, factorySearchResult };
  } catch (error) {
    console.error("[chatService] Layer 2 routing failed, falling back to Layer 1 content:", error);
    const reply =
      diagnosis.nextBestQuestion ??
      diagnosis.recommendedBusinessDirection ??
      "能再多說一點你現在遇到的狀況嗎？";
    return { reply, factorySearchResult: null };
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
  /**
   * Phase 6A.1：這一輪是否觸發／更新／維持了一筆人工協尋 request——只有登入
   * 使用者才有（訪客沒有 userId，人工協尋沒有對象可以回覆，見對話中「十八、
   * Request 必須有 Ownership」）。client 用這個欄位決定要不要顯示「已交由
   * OXM 人工協尋」的誠實文案，不自己猜測或詢問使用者要不要協尋。
   */
  manualSourcing: ManualSourcingResult | null;
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
    if (owned && owned.status === "active") return owned;
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
  const factory = await resolveAiFactory(params.userId);
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
      await updateConversationState(conversation.id, pausedState);
      await appendMessage(conversation.id, "assistant", OUT_OF_DOMAIN_CASUAL_PAUSED_REPLY);
      return {
        reply: OUT_OF_DOMAIN_CASUAL_PAUSED_REPLY,
        conversationId: conversation.id,
        handoffOffer: null,
        factorySearchResult: null,
        manualSourcing: null,
      };
    }
    resumedFromPause = true;
  }

  const memoryRow = await getEnterpriseMemory(params.userId);
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
  let manualSourcing: ManualSourcingResult | null = null;
  // 這一輪最終要寫回 ConversationState 的 Factory Search State，預設沿用舊值
  // 不變（見「十四」）；只有真的重新搜尋，或 Planner 這輪換算出新的
  // requestedCount 時才會被更新。
  let resolvedFactorySearchState = currentFactorySearchState;

  try {
    const routing = await runOxmRouting({
      diagnosis,
      history: turnContext.history,
      factoryContext,
      enterpriseMemory,
      currentFactorySearchState,
      consecutiveOutOfDomainCasualTurns,
    });
    finalReply = routing.finalReply;
    // Phase 6A：只在「這一輪」Layer 2 真的判斷出 factory_search 時才觸發，不
    // 沿用舊值。search_factories 這個 Action 的觸發時機沿用既有 Layer 2
    // 判斷，不用 Action Planner 再問一次「要不要搜尋」（見「十六」：
    // factory_search 是 resource direction，search_factories 只是把既有機制
    // 原樣接上；Action Planner 專心負責搜尋結果之後的 business action）。
    if (routing.primaryService === "factory_search") {
      factorySearchResult = await runFactorySearchAction(turnContext.history, conversation.id);
    }

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
    const shouldPlanFactoryAction =
      !!factorySearchResult ||
      (!!currentFactorySearchState && routing.factorySourcingContextRelevant);

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
            console.error(`[chatService] applyFactorySourcingDecision failed for conversation ${conversation.id}:`, sourcingError);
            manualSourcing = { triggered: false, reason: null, requestId: null };
            actionOutcome = "failed";
          }
        } else if (decision.action === "cancel_factory_sourcing" && pendingFactorySearchRequest) {
          try {
            await cancelFactorySearchRequestForConversation({ conversationId: conversation.id, userId: params.userId });
            manualSourcing = { triggered: false, reason: null, requestId: null };
            actionOutcome = "succeeded";
          } catch (cancelError) {
            console.error(`[chatService] cancelFactorySearchRequestForConversation failed for conversation ${conversation.id}:`, cancelError);
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
    }

    nextState = deriveConversationState({
      diagnosis,
      routing,
      previousState: turnContext.previousState,
      companyContextKnown: !!factoryContext,
      factorySearchState: resolvedFactorySearchState,
      consecutiveOutOfDomainCasualTurns,
    });
  } catch (error) {
    console.error(`[chatService] Layer 2 routing failed for conversation ${conversation.id}, falling back to Layer 1 content:`, error);
    finalReply =
      diagnosis.nextBestQuestion ??
      diagnosis.recommendedBusinessDirection ??
      "能再多說一點你現在遇到的狀況嗎？";
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

  await updateConversationState(conversation.id, nextState);
  await appendMessage(conversation.id, "assistant", finalReply);

  return {
    reply: finalReply,
    conversationId: conversation.id,
    handoffOffer: resolveHandoffOffer(nextState),
    factorySearchResult,
    manualSourcing,
  };
}
