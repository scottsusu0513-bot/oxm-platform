import { getAiChatProvider, type AiChatMessage } from "./provider";
import { serializeHistory } from "./serialize";
import { getEnabledOxmActions, type OxmActionKey } from "./actionRegistry";
import type { FactorySearchStateSnapshot } from "./factorySearchState";
import type { AiChatTurn } from "./types";

/**
 * AI Action Planner（見對話中「OXM Action Registry + AI Action Planner」）。
 *
 * 這是取代「if candidateCount===0 / if missingCapability / if requestedCount
 * > directMatchCount / if user complains / if user says more / if user says
 * no」這整棵硬寫 trigger tree 的層——由 AI 語意判斷「現在該不該人工協尋／
 * 該不該取消」，而不是程式碼算出一個布林值。
 *
 * 只有在跟工廠搜尋相關的這一輪才會呼叫（見 chatService.ts 的呼叫條件），
 * 不是每一輪都多一次 LLM call（見「十七」，實際 call count 見完成後回報）。
 *
 * 這一層只做「決定下一個 Action」，不執行任何 side effect、不碰 DB、不知道
 * userId／conversationId／requestId 這些 server-authoritative 欄位（見
 * 「十二、二十一」）——這些全部由 chatService.ts 依 server 自己的狀態注入，
 * 不信任模型輸出的任何 id 或計數欄位裡混入的東西。
 *
 * 【OXM AI 已完成功能整體驗收修正】：這一層過去一度同時負責「決定 action」
 * 與「生成 assistantReply」（見已刪除的 assistantReply 欄位），人工驗收發現
 * 這會讓 decision 與 wording 前後不一致（例如 decision 判斷要重新搜尋，但
 * wording 卻只是承諾「需要的話我可以幫你搜尋」）。現在正式拆開：這一層永遠
 * 只回傳結構化決定，使用者看到的文字一律由 server/ai/responseComposer.ts
 * 的 Final Response Composer 負責生成（它能同時看到這裡的決定、真正的
 * action 執行結果、以及本輪的搜尋結果，wording 才不會偏離事實）。
 */

/**
 * Current Factory Search State（見「九、十」及後續「Current Factory Search
 * State 沒有真正被保存」的架構修正）：server-authoritative、safe-projection
 * 過的精簡狀態，不是完整候選清單、更不是整段逐字稿。核心欄位直接沿用跨對話
 * 持久化的 FactorySearchStateSnapshot（見 server/ai/factorySearchState.ts），
 * 只額外附加 activeFactorySearchRequest（這是「人工協尋承接了什麼」，跟
 * 「剛剛搜尋了什麼」是兩個獨立概念，見那個檔案的說明，不放進 snapshot 本身）。
 */
export type FactorySearchStateForPlanner = FactorySearchStateSnapshot & {
  activeFactorySearchRequest: { status: string; requestSummary: string } | null;
};

export type ActionReasonCategory = "hard_zero" | "capability_gap" | "quantity_gap" | "other";

export interface OxmActionDecision {
  action: OxmActionKey | "none";
  /** 內部判斷理由，不直接顯示給使用者——真正要顯示的文字由 Final Response Composer 負責。 */
  reason: string;
  /** UI／Admin 通知用的粗分類，AI 依自己的語意判斷自行標記——分類本身不是
   * 硬性 trigger 規則，只是把 AI 已經做出的決定貼一個人類看得懂的標籤。 */
  reasonCategory: ActionReasonCategory;
  /**
   * 見對話中「修正 Action Planner 的通用 successful tool result 判斷」：
   * 這一輪重新判斷後，使用者目前真正想要的目標是否已經被現有的自動搜尋結果
   * 合理滿足。這是通用概念，不是任何特定案例（不是「南投」「五軸」）的硬性
   * 規則——true 通常對應 toolResultStatus===MATCH_FOUND 且使用者沒有表達不
   * 滿；但即使是 MATCH_FOUND，只要使用者這一輪明確表示「這些不是我要的」
   * 「還要更多」，resolvedGoal 這一輪就要重新判斷成 false（見「MATCH_FOUND
   * 不是永遠禁止人工協尋」）。
   */
  resolvedGoal: boolean;
  /**
   * resolvedGoal 的反面，但不是簡單的 !resolvedGoal 布林運算——這是你的獨立
   * 語意判斷：這一輪是否存在一個真正需要 OXM 出手處理的未滿足需求。
   * request_factory_sourcing 只在 unresolvedNeed 為 true 時才應該被選中（見
   * 下面程式碼防線：resolvedGoal 為 true 時，即使你選了
   * request_factory_sourcing，也會被強制降級成 none，因為兩者邏輯上不該同時
   * 成立）。
   */
  unresolvedNeed: boolean;
  actionPayload: {
    requestedCapabilities: string[];
    /** 使用者這輪之前累積下來、AI 理解到的期望家數（含「再多找兩家」這種
     * 相對表達，AI 自己用 factorySearchState.directCapabilityMatchCount 換算
     * 成絕對數字），沒有表達過就是 null。 */
    requestedCount: number | null;
  };
}

const TOOL_RESULT_STATUS_EXPLANATION: Record<string, string> = {
  NO_HARD_CANDIDATE: "平台上目前真的沒有任何一家工廠符合 Hard Filters（不是查詢條件有問題，是平台資料庫裡剛好沒有符合的工廠）——這種情況下 unresolvedNeed 幾乎必然是 true，除非使用者這一輪明確表示不需要協尋。",
  SIMILAR_ONLY: "有候選符合 Hard Filters，但沒有任何一家能提供直接文字證據支持使用者要的 Core Capabilities——候選集合本身不算完全滿足需求，unresolvedNeed 通常是 true，除非使用者這一輪明確表示不需要協尋。",
  MATCH_FOUND: "有候選符合 Hard Filters，且（使用者沒有指定特定能力，或）至少一家候選能提供直接文字證據支持 Core Capabilities——這代表這一輪的自動搜尋結果客觀上已經合理滿足需求，resolvedGoal 預設是 true、unresolvedNeed 預設是 false，除非使用者這一輪對這個結果本身明確表達了不滿意（例如「這些不是我要的」「還要更多」「數量不夠」），這種情況下才要重新判斷成 unresolvedNeed=true（見「MATCH_FOUND 不是永遠禁止人工協尋」）。",
};

function serializeFactorySearchState(state: FactorySearchStateForPlanner): string {
  const lines = [
    `以下是這段對話目前真實、已經執行完成的搜尋結果（可能是這一輪剛搜的，也可能是稍早某一輪搜的、這一輪沒有重新搜尋——不論哪一種，這些都是已經真的拿去查詢過平台資料庫、不是「使用者需求還不夠具體所以還沒搜尋」；最後一次搜尋時間：${state.lastSearchAt}）：`,
    `toolResultStatus（server-authoritative，唯一權威判斷式算出來，不是你自己猜的）：${state.status}——${TOOL_RESULT_STATUS_EXPLANATION[state.status] ?? ""}`,
    `Hard Filters（決定候選集合，不是排序）：地區＝${state.hardFilters.regions.join("、") || "（無）"}；主產業＝${state.hardFilters.mainIndustries.join("、") || "（無）"}`,
    `Core Capabilities（使用者這次真正要找的關鍵能力，只影響排序，不影響候選集合）：${state.coreCapabilities.join("、") || "（無）"}`,
    `Hard Filter 候選集合總數：${state.candidateCount} 家`,
    `公開資料明確符合「全部」Core Capabilities 的候選數：${state.directCapabilityMatchCount} 家`,
    state.missingCoreCapabilities.length > 0
      ? `完全沒有任何候選能提供直接文字證據的能力：${state.missingCoreCapabilities.join("、")}`
      : "所有 Core Capabilities 都至少有一家候選提供直接文字證據",
    state.requestedMatchCount != null
      ? `目前已知使用者期望的家數：${state.requestedMatchCount} 家（純資訊，不是硬性比較規則，實際夠不夠由你判斷）`
      : "使用者目前沒有明確表達過期望的家數",
    state.topResults.length > 0
      ? "目前候選前幾名（安全摘要，不是完整清單）：\n" +
        state.topResults.map(c => `- ${c.companyName}（${c.region}，相關度：${c.relevanceTier}）`).join("\n")
      : "目前沒有任何候選",
    state.activeFactorySearchRequest
      ? `目前這段對話已經有一筆進行中的人工協尋（狀態：${state.activeFactorySearchRequest.status}，摘要：「${state.activeFactorySearchRequest.requestSummary}」）——如果使用者這一輪是在放棄／取消，應該考慮 cancel_factory_sourcing；如果使用者這一輪在補充新的搜尋條件或表達不滿意，考慮更新／重新 request_factory_sourcing（用同一個 action，server 會自動判斷是否為同一筆需求的延續，不用你操心）。`
      : "目前這段對話沒有進行中的人工協尋。",
  ];
  return lines.join("\n");
}

const ACTION_PLANNER_SYSTEM_PROMPT_HEADER = `
你是 OXM AI 對話裡的「下一步行動判斷」步驟，專門負責工廠搜尋／人工協尋相關的決定。OXM 是台灣的 B2B 製造業媒合平台。

你的任務：根據使用者最新的意圖、目前真實的搜尋結果狀態，判斷現在應該執行下面哪一個 OXM Action（或都不需要）。你只做這一件事——不需要、也不會被拿去生成任何要顯示給使用者的文字，那是另一個步驟（Final Response Composer）的責任，你不用考慮語氣或字數。

【核心原則——非常重要】
1. 你的判斷分兩步，缺一不可：第一步先誠實回答 resolvedGoal（使用者目前真正想要的目標，這一輪重新判斷後是否已經被現有的自動搜尋結果合理滿足）與 unresolvedNeed（是否存在一個真正需要 OXM 出手處理的未滿足需求），第二步才根據這兩個判斷選 action。這是通用概念，不是針對「候選數等於0」「南投」「五軸」這類特定案例寫死的規則——同一組概念要能套用在任何地區／產業／能力組合上。不要用任何固定的數字門檻當作唯一判斷依據（例如「候選數等於0」「符合數小於使用者要求數」），這些數字只是幫助你判斷 resolvedGoal／unresolvedNeed 的參考資訊，真正的判斷是「以使用者目前真正想要的結果來看，現有結果是否已經合理滿足他」。
2. resolvedGoal 與 unresolvedNeed 不是簡單的互斥布林（不是 unresolvedNeed = !resolvedGoal 這種機械換算），是兩個各自獨立的語意判斷，但兩者同時成立（resolvedGoal=true 且 unresolvedNeed=true）在邏輯上不合理，程式碼會在偵測到這種矛盾時把 action 強制降級為 none。
3. 如果使用者上一輪已經看過搜尋結果，這一輪的訊息是在否定或不滿意那個結果（例如「這些都沒有五軸」「這不是我要的」「還不夠」），你必須理解這是在評論剛剛的搜尋結果，不是一個全新、沒有上下文的句子——即使 toolResultStatus 是 MATCH_FOUND，這種情況下 resolvedGoal 這一輪也要重新判斷成 false。
3b.【容易搞混、務必校準】「使用者改變搜尋條件本身」跟「使用者對搜尋結果表達不滿」是兩件完全不同的事，不要把前者誤判成後者：如果使用者這一輪只是換了新的地區／產業／能力條件（例如「改南投」「那台南呢」），下面的 Factory Search State 一定已經是「用這個新條件」重新查詢過的真實結果（見「search_factories 這個 Action…在你被呼叫之前就已經自動執行完成」）——這一輪的 resolvedGoal／unresolvedNeed 只能根據「這個新條件的查詢結果本身好不好」來判斷，不能因為使用者「換了條件」這件事本身，就自動推論成「上一個條件的結果讓他不滿意，所以這個新結果也有 unresolvedNeed」。單純換條件、且新條件的 toolResultStatus 是 MATCH_FOUND、使用者沒有對這個新結果本身表達任何不滿時，resolvedGoal 就是 true、unresolvedNeed 就是 false，維持 none——只有使用者在看到新結果「之後」才表達不滿（例如再下一輪說「這些都不是我要的」），才會是 unresolvedNeed=true 的情況。
4. 只有使用者這一輪明確表達放棄／不需要了，才能選 cancel_factory_sourcing；不要自己猜測使用者可能不想要了。
5. 不要主動幫使用者決定「你應該要幾家」——期望家數只在使用者自己講出來時才記錄進 actionPayload.requestedCount，沒講過就是 null。
6. 如果目前沒有任何工廠尋源相關的意圖（例如使用者只是問「五軸加工是什麼」這種一般知識問題），選 none，即使訊息裡出現了「五軸」這個詞。

你不能執行任何動作、不能直接操作資料庫，你只是做判斷；真正的執行由 server 端根據你的判斷去做，且 server 會用自己的資料驗證、不會盲目相信你輸出的任何數字或 ID。

【重要】search_factories 這個 Action（用既有系統搜尋工廠）在你被呼叫「之前」就已經根據使用者這一輪的訊息自動執行完成了——下面的 Factory Search State 就是那次搜尋的真實結果。你的工作不是「決定要不要搜尋」（那件事已經做完了），而是「根據這個已經搜尋完成的結果，判斷結果夠不夠好」。所以你永遠不需要、也不應該選 search_factories 當作你的決定；你只需要在 request_factory_sourcing／cancel_factory_sourcing／none 三者之間選一個。

`.trim();

function buildActionPlannerPrompt(factorySearchState: FactorySearchStateForPlanner): string {
  // search_factories 不列進這裡的選項清單：它在這個呼叫之前就已經自動執行
  // 完成（見上面 prompt 的說明），列出來只會誘使模型誤選它當作「決定要不要
  // 搜尋」的答案（真實 API 測試時觀察到過一次這種誤判），這一步唯一該做的
  // 決定只在 request_factory_sourcing／cancel_factory_sourcing／none 之間。
  const actions = getEnabledOxmActions().filter(a => a.key !== "search_factories");
  const actionsBlock = actions.map(a => [
    `- ${a.key}：${a.description}`,
    `  適用時機：${a.whenUseful}`,
    `  不適用時機：${a.whenNotUseful}`,
  ].join("\n")).join("\n\n");

  return [
    ACTION_PLANNER_SYSTEM_PROMPT_HEADER,
    "\n===== 目前可用的 OXM Actions =====\n" + actionsBlock,
    "\n===== 目前 Factory Search State（server-authoritative，只有這些數字是真的）=====\n" + serializeFactorySearchState(factorySearchState),
    `
只回傳一個 JSON object，不要有任何其他文字：
{
  "resolvedGoal": true/false,
  "unresolvedNeed": true/false,
  "action": "request_factory_sourcing 或 cancel_factory_sourcing 或 none",
  "reason": "string，內部判斷理由，不會直接顯示給使用者",
  "reasonCategory": "hard_zero 或 capability_gap 或 quantity_gap 或 other",
  "actionPayload": {
    "requestedCapabilities": ["string", ...],
    "requestedCount": 數字或 null
  }
}
`.trim(),
  ].join("\n");
}

// search_factories 刻意不在這裡列為合法輸出（見 buildActionPlannerPrompt 的
// 說明）——如果模型仍然輸出它（不應該發生，但防禦性處理），視同沒有做出
// 任何決定，安全降級為 none，不會被拿去執行任何 side effect。
const VALID_ACTIONS = new Set<string>(["request_factory_sourcing", "cancel_factory_sourcing", "none"]);
const VALID_REASON_CATEGORIES = new Set<string>(["hard_zero", "capability_gap", "quantity_gap", "other"]);

function parseDecision(raw: string): OxmActionDecision {
  const parsed = JSON.parse(raw);
  const action = typeof parsed.action === "string" && VALID_ACTIONS.has(parsed.action)
    ? (parsed.action as OxmActionKey | "none")
    : "none";
  const reasonCategory = typeof parsed.reasonCategory === "string" && VALID_REASON_CATEGORIES.has(parsed.reasonCategory)
    ? (parsed.reasonCategory as ActionReasonCategory)
    : "other";
  const payload = parsed.actionPayload && typeof parsed.actionPayload === "object" ? parsed.actionPayload : {};
  const requestedCapabilities = Array.isArray(payload.requestedCapabilities)
    ? payload.requestedCapabilities.filter((c: unknown): c is string => typeof c === "string").slice(0, 10)
    : [];
  const requestedCount = typeof payload.requestedCount === "number" && Number.isFinite(payload.requestedCount) && payload.requestedCount > 0
    ? Math.floor(payload.requestedCount)
    : null;
  const resolvedGoal = Boolean(parsed.resolvedGoal);
  const unresolvedNeed = Boolean(parsed.unresolvedNeed);
  return {
    action: enforceResolvedGoalGate(action, resolvedGoal, unresolvedNeed),
    reason: String(parsed.reason ?? ""),
    reasonCategory,
    resolvedGoal,
    unresolvedNeed,
    actionPayload: { requestedCapabilities, requestedCount },
  };
}

/**
 * 程式碼層級的硬性防線（跟 routing.ts 的 enforceDiagnosisGate 同一種設計
 * 哲學）：不完全依賴模型自己遵守 prompt 指示。見對話中「A/B CASE 6」——三個
 * 模型都出現過「本輪 toolResultStatus 已經是 MATCH_FOUND、使用者也沒有表達
 * 不滿，卻仍然選了 request_factory_sourcing」的邏輯矛盾（模型自己都判斷
 * resolvedGoal=true，決定卻還是要協尋）。這裡只做「內部一致性」檢查，不覆蓋
 * 模型自己對 resolvedGoal／unresolvedNeed 的語意判斷本身——如果模型誠實判斷
 * unresolvedNeed=true（不論 toolResultStatus 是不是 MATCH_FOUND，見「二、
 * MATCH_FOUND 不是永遠禁止人工協尋」），action 依然會照常執行。
 */
function enforceResolvedGoalGate(
  action: OxmActionKey | "none",
  resolvedGoal: boolean,
  unresolvedNeed: boolean
): OxmActionKey | "none" {
  if (action === "request_factory_sourcing" && resolvedGoal && !unresolvedNeed) {
    return "none";
  }
  return action;
}

export async function planNextOxmAction(params: {
  history: AiChatTurn[];
  factorySearchState: FactorySearchStateForPlanner;
}): Promise<OxmActionDecision> {
  const systemPrompt = buildActionPlannerPrompt(params.factorySearchState);
  const messages: AiChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "以下是目前這段對話最近的逐字稿：\n\n" + serializeHistory(params.history) },
  ];
  const provider = getAiChatProvider("actionPlanner");
  const raw = await provider.completeJson(messages, 300);
  return parseDecision(raw);
}
