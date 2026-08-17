import type { EnterpriseDiagnosis, BottleneckStatus } from "./diagnosis";
import type { OxmRouting, ServiceRelationType } from "./routing";
import type { FactorySearchStateSnapshot } from "./factorySearchState";

/**
 * Current Conversation State——只屬於「這一段」對話的短期理解摘要，不是跨
 * 對話的長期 Enterprise Memory（那是之後 Phase 才做的事，見 diagnosis.ts /
 * routing.ts 檔頭與本檔案的說明）。刻意保持短、小、結構化，不存一大段自然
 * 語言：目的只是讓下一輪不用重新讀完整對話歷史就能知道「現在聊到哪」。
 */
export interface ConversationState {
  companyContextKnown: boolean;
  observedProblem: string | null;
  likelyBottleneck: string | null;
  bottleneckStatus: BottleneckStatus;
  primaryBusinessDirection: string | null;
  secondaryConcern: string | null;
  candidateServiceKeys: string[];
  serviceRelationship: ServiceRelationType | null;
  userWantsAction: boolean;
  handoffReady: boolean;
  /**
   * 只保存使用者「明確說過」的事實（例如「我們沒有專利」→ hasPatent:
   * false），絕對不能是從模糊描述推測出來的值（例如「我們公司不大」不可以
   * 變成某個 annualRevenue 級距）——見 diagnosis.ts 對 confirmedFacts 的萃取
   * 規則。這裡只負責「保守合併」：新一輪的 confirmedFacts 疊加在舊的之上，
   * 不會無中生有新增鍵值，也不會自動清空舊的（除非同一個 key 被新資訊更新）。
   */
  confirmedFacts: Record<string, string | number | boolean>;
  unresolvedQuestion: string | null;
  lastUpdatedAt: string;
  /**
   * Phase 6 Action Architecture：這段對話目前的 Factory Search State（見
   * server/ai/factorySearchState.ts 的完整說明）——跟 aiFactorySearchRequests
   * 是兩個獨立概念，這個欄位描述「剛剛搜尋了什麼」，不是「人工協尋承接了
   * 什麼」。同一段對話持續存在，新搜尋覆蓋成最新狀態，沒有新搜尋時原樣保留
   * （不會因為這一輪聊別的就被清空，見 chatService.ts 的更新邏輯）。
   */
  currentFactorySearchState: FactorySearchStateSnapshot | null;
  /**
   * 見對話中「非 OXM 純閒聊收斂機制」：連續幾輪是「conversationIntent=
   * casual_conversation 且跟企業／OXM 完全無關」的閒聊——純屬這一段對話的
   * temporary session state，不寫入 Enterprise Memory（跨對話長期記憶只保存
   * 有意義的企業摘要，這個計數器本身沒有跨對話保存的價值）。任何非
   * out-of-domain-casual 的一輪（informational／business_exploration／
   * resource_request／action_request，或雖然是 casual_conversation 但跟
   * 企業相關）都會把它重置為 0。
   */
  consecutiveOutOfDomainCasualTurns: number;
  /**
   * 見對話中「非 OXM 純閒聊收斂機制」二階段設計（casual pause state
   * machine）：normal（正常回答）／warned（已經用固定文案提醒過一次）／
   * paused（已暫停一般閒聊，只用固定文案回覆，完整 pipeline 不再執行）。
   * 純屬這一段對話的 temporary session state，不寫入 Enterprise Memory（跟
   * consecutiveOutOfDomainCasualTurns 同樣的理由——沒有跨對話保存的價值）。
   * 這個欄位「下一輪要變成什麼」的權威判斷在 chatService.ts 的 post-processing
   * 步驟（跑完 diagnosis/routing 或跑完輕量 resume gate 之後），不是這個檔案
   * 自己判斷；deriveConversationState() 只負責原樣沿用上一輪的值當作安全預設。
   */
  outOfDomainCasualMode: OutOfDomainCasualMode;
}

export type OutOfDomainCasualMode = "normal" | "warned" | "paused";

export function createEmptyConversationState(companyContextKnown: boolean): ConversationState {
  return {
    companyContextKnown,
    observedProblem: null,
    likelyBottleneck: null,
    bottleneckStatus: "unclear",
    primaryBusinessDirection: null,
    secondaryConcern: null,
    candidateServiceKeys: [],
    serviceRelationship: null,
    userWantsAction: false,
    handoffReady: false,
    confirmedFacts: {},
    unresolvedQuestion: null,
    lastUpdatedAt: new Date().toISOString(),
    currentFactorySearchState: null,
    consecutiveOutOfDomainCasualTurns: 0,
    outOfDomainCasualMode: "normal",
  };
}

/**
 * 見對話中「非 OXM 純閒聊收斂機制」：唯一權威判斷式，chatService.ts 在呼叫
 * Layer 2 之前先用這個算出這一輪「解析後」的連續 out-of-domain 閒聊輪數
 * （因為 Layer 2 的 finalReply 也需要知道這個數字才能自然帶出 scope
 * reminder），再把同一個算好的數字傳給下面的 deriveConversationState，避免
 * 兩處各自重算、慢慢漂移出不一致。
 *
 * 只有這一輪 conversationIntent 是 casual_conversation 且
 * casualTurnDomainRelevant 是 false（見 diagnosis.ts 的判斷規則）才會累加；
 * 任何其他情況（包含跟企業相關的 casual_conversation）都重置為 0。
 */
export function resolveConsecutiveOutOfDomainCasualTurns(
  diagnosis: EnterpriseDiagnosis,
  previousState: ConversationState | null
): number {
  const isOutOfDomainCasual =
    diagnosis.conversationIntent === "casual_conversation" && !diagnosis.casualTurnDomainRelevant;
  if (!isOutOfDomainCasual) return 0;
  return (previousState?.consecutiveOutOfDomainCasualTurns ?? 0) + 1;
}

/**
 * 每輪 Layer 1 + Layer 2 跑完後，用這輪的結果更新 state。confirmedFacts 是
 * 唯一「累加」的欄位（保留之前確認過的事實，新的事實疊加上去，同一個 key
 * 出現新值才覆蓋）；其餘欄位都是「這一輪的最新判斷取代舊的」，因為
 * bottleneck／方向本來就應該隨新資訊更新，不需要疊加歷史版本。
 */
export function deriveConversationState(params: {
  diagnosis: EnterpriseDiagnosis;
  routing: OxmRouting;
  previousState: ConversationState | null;
  companyContextKnown: boolean;
  /**
   * chatService.ts 這一輪已經算好的最終 Factory Search State——可能是這輪
   * 剛搜尋出來的新快照、沿用上一輪不變的舊快照、或者這輪剛把 requestedCount
   * 更新過的舊快照，一律由呼叫端解析好、原樣寫入，這裡不做任何判斷。
   */
  factorySearchState: FactorySearchStateSnapshot | null;
  /** chatService.ts 已經用 resolveConsecutiveOutOfDomainCasualTurns() 算好的這一輪數值，原樣寫入。 */
  consecutiveOutOfDomainCasualTurns: number;
}): ConversationState {
  const { diagnosis, routing, previousState, companyContextKnown, factorySearchState, consecutiveOutOfDomainCasualTurns } = params;

  return {
    companyContextKnown,
    observedProblem: diagnosis.observedProblem || previousState?.observedProblem || null,
    likelyBottleneck: diagnosis.likelyBottleneck,
    bottleneckStatus: diagnosis.bottleneckStatus,
    primaryBusinessDirection: diagnosis.recommendedBusinessDirection,
    secondaryConcern: diagnosis.secondaryConcern,
    candidateServiceKeys: [routing.primaryService, routing.secondaryService].filter(
      (key): key is string => !!key
    ),
    serviceRelationship: routing.relationship,
    userWantsAction: diagnosis.userWantsAction,
    handoffReady: routing.shouldOfferHandoff,
    confirmedFacts: {
      ...(previousState?.confirmedFacts ?? {}),
      ...diagnosis.confirmedFacts,
    },
    unresolvedQuestion: diagnosis.nextBestQuestion,
    lastUpdatedAt: new Date().toISOString(),
    currentFactorySearchState: factorySearchState,
    consecutiveOutOfDomainCasualTurns,
    outOfDomainCasualMode: previousState?.outOfDomainCasualMode ?? "normal",
  };
}
