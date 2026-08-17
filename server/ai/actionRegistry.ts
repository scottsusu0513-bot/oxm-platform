/**
 * OXM Action Registry（見對話中「OXM Action Registry + AI Action Planner」）。
 *
 * 這是「業務 Action」的 metadata 層，不是底層函式的直接暴露——每個 Action
 * 只登記給 AI Action Planner 看的語意描述（description/whenUseful/
 * whenNotUseful），真正的執行邏輯仍然是 server 端獨立、authoritative 的
 * function（server/ai/factorySearchAction.ts／factorySearchRequestService.ts），
 * AI 永遠不會拿到、也不能直接呼叫這些底層函式或 DB。
 *
 * V1 範圍（見「三、先建立 OXM Action Registry」）：只登記 3 個真正接上執行
 * 邏輯的 Action。未來要擴充（search_news／offer_erp_handoff／
 * navigate_to_factory 等）時，只需要照同樣的 OxmActionDefinition 形狀新增
 * 一筆，不需要改 Action Planner 的 prompt 組裝邏輯或 schema——這裡刻意不先
 * 塞入 enabled:false 的未來 stub 項目，避免存在完全沒有測試覆蓋、沒有執行路
 * 徑的死程式碼；架構本身已經支援擴充。
 */

export type OxmActionKey = "search_factories" | "request_factory_sourcing" | "cancel_factory_sourcing";

export type OxmActionSideEffectLevel = "none" | "read" | "write";

export interface OxmActionDefinition {
  key: OxmActionKey;
  description: string;
  whenUseful: string;
  whenNotUseful: string;
  requiredContext: string[];
  optionalContext: string[];
  sideEffectLevel: OxmActionSideEffectLevel;
  enabled: boolean;
}

export const OXM_ACTION_REGISTRY: OxmActionDefinition[] = [
  {
    key: "search_factories",
    description: "使用 OXM 既有工廠搜尋系統搜尋公開已核准的工廠——Hard Filters（地區／主產業）決定候選集合，Ranking Signals（能力／技術詞）只影響排序，不會拿來排除候選。",
    whenUseful: "使用者想找工廠、供應商、製造合作對象，且這一輪的訊息足以組出至少一個 Hard Filter（地區或主產業）。",
    whenNotUseful: "使用者的需求還太模糊、完全沒有指定任何產品／能力／產業／地區——這種情況會留在企業診斷層繼續追問一個釐清問題，不會走到這裡。",
    requiredContext: ["使用者這輪或先前訊息中的搜尋條件"],
    optionalContext: [],
    sideEffectLevel: "read",
    enabled: true,
  },
  {
    key: "request_factory_sourcing",
    description: "當 OXM 現有自動搜尋結果不足以真正滿足使用者的工廠媒合需求時，將這個需求交由 OXM 人員人工協尋（不是顧問服務，不建立 handoff、不進顧問中心）。",
    // 見對話中「A/B CASE 6」發現：三個模型都出現過「本輪 Tool Result 已經是
    // MATCH_FOUND（自動搜尋已經合理滿足需求）、使用者也沒有表示不滿，卻仍然
    // 觸發協尋」的誤判，這不是單一模型的能力問題，是判斷原則本身需要更明確
    // 拆成兩件事：這裡刻意用 resolvedGoal／unresolvedNeed 這組通用概念描述，
    // 不是針對「南投」「五軸」這類具體案例寫死關鍵字規則。
    whenUseful:
      "本輪的 unresolvedNeed 為 true——也就是「使用者目前真正想要的目標，還沒有被現有自動搜尋結果合理滿足」，可能來自兩種情況：(1) toolResultStatus 客觀上就不是完整滿足（SIMILAR_ONLY／NO_HARD_CANDIDATE），或 (2) 即使 toolResultStatus 是 MATCH_FOUND，使用者最新這一輪明確表達了「這些不是我要的」「還要更多」「數量不夠」這類針對目前結果本身的不滿意，代表這一輪重新判斷後 resolvedGoal 其實是 false。",
    whenNotUseful:
      "本輪的 resolvedGoal 為 true 且 unresolvedNeed 為 false——也就是 toolResultStatus 是 MATCH_FOUND，且使用者最新訊息沒有對這個結果表達任何不滿意或還要更多的意思；或使用者只是在問一般產業知識、沒有實際找廠意圖；或使用者已經明確表示不需要協尋；或這一輪根本沒有工廠尋源相關的意圖。核心原則：MATCH_FOUND 不代表永遠不能協尋（見上面 whenUseful 的第二種情況），但也不能只因為「曾經協尋過」或「候選數不多」就不看這一輪使用者實際有沒有表達不滿，主動觸發。",
    requiredContext: ["目前 Factory Search State（Hard Filters／Core Capabilities／候選數／明確符合數／toolResultStatus）", "使用者最新訊息"],
    optionalContext: ["使用者曾經表達過的期望家數"],
    sideEffectLevel: "write",
    enabled: true,
  },
  {
    key: "cancel_factory_sourcing",
    description: "取消目前尚未結案（pending）的人工協尋需求。",
    whenUseful: "使用者明確表達不再需要先前已經在進行中的人工協尋，例如：不用了、只是問問、我自己找到了、先不用、不需要再找。",
    whenNotUseful: "使用者沒有表達放棄或取消的意圖；或目前這段對話沒有任何進行中的人工協尋可以取消。",
    requiredContext: ["是否有進行中的人工協尋"],
    optionalContext: [],
    sideEffectLevel: "write",
    enabled: true,
  },
];

export function getEnabledOxmActions(): OxmActionDefinition[] {
  return OXM_ACTION_REGISTRY.filter(a => a.enabled);
}
