import { deriveFactorySearchStatus, type FactorySearchActionResult, type FactorySearchStatus } from "./factorySearchAction";

/**
 * Current Factory Search State（見對話中「Current Factory Search State 沒有
 * 真正被保存」的架構修正）：這段對話「剛剛搜尋了什麼、找到什麼」的
 * server-authoritative、safe-projection 精簡快照。
 *
 * 跟 aiFactorySearchRequests 是兩個完全不同的概念（見「六、pending request
 * 不能充當 search state」）：
 * - FactorySearchStateSnapshot：描述「我們剛剛搜尋了什麼／找到什麼」——即使
 *   完全沒有 gap、從來沒有建立過人工協尋 request，這個 state 也應該存在。
 * - aiFactorySearchRequests：描述「OXM 人工協尋已經承接了什麼」——只有真的
 *   判斷需要人工協尋時才存在。
 *
 * 持久化位置：塞進既有 server/ai/conversationState.ts 的 ConversationState
 * （透過 aiConversations.currentStateJson 這個既有 JSON 欄位），不新增
 * migration——這是「同一段對話持續存在的短期結構化理解」，跟 ConversationState
 * 既有其他欄位（observedProblem／bottleneckStatus…）性質完全一樣，本來就該
 * 放在同一個地方（見 conversationState.ts 檔頭：「目的只是讓下一輪不用重新
 * 讀完整對話歷史就能知道現在聊到哪」——這正是這裡要解決的問題）。
 *
 * 只存安全、精簡欄位：不存完整 factory rows、不存 admin/internal 欄位、
 * topResults 只留公開安全的幾個欄位（沿用 factorySafeProjection.ts 已經是
 * 安全投影後的資料）。
 */
export interface FactorySearchStateSnapshot {
  hardFilters: { mainIndustries: string[]; regions: string[] };
  coreCapabilities: string[];
  candidateCount: number;
  directCapabilityMatchCount: number;
  missingCoreCapabilities: string[];
  /** 見 factorySearchAction.ts 的 FactorySearchStatus／deriveFactorySearchStatus——單一權威判斷式算出來，Final Response Composer 的 wording 分流直接依這個欄位，不重新猜。 */
  status: FactorySearchStatus;
  /** 使用者目前已知期望的家數（跨輪保留，直到被新的明確數字覆蓋），null 代表從未提過。 */
  requestedMatchCount: number | null;
  topResults: { factoryId: number; companyName: string; region: string; relevanceTier: string }[];
  /** 人類可讀的一句話摘要，供 Planner／未來除錯快速理解，不是給使用者看的文案。 */
  searchSummary: string;
  lastSearchAt: string;
}

/**
 * search_factories 每次真正執行完成後呼叫（見「三」），用這次
 * server-authoritative 的搜尋結果重建整份 snapshot——requestedMatchCount 刻意
 * 由呼叫端傳入舊值語意保留（不是這次搜尋本身的產出），避免每次重新搜尋就把
 * 使用者之前講過的期望家數洗掉。
 */
export function buildFactorySearchStateSnapshot(
  result: FactorySearchActionResult,
  previousRequestedMatchCount: number | null
): FactorySearchStateSnapshot {
  const scope = [...result.appliedFilters.regions, ...result.appliedFilters.mainIndustries].join("、") || "未指定地區／產業";
  const coreCapabilities = result.appliedFilters.rankingSignals;
  const searchSummary = coreCapabilities.length > 0 ? `${scope}；核心能力：${coreCapabilities.join("、")}` : scope;
  return {
    hardFilters: { mainIndustries: result.appliedFilters.mainIndustries, regions: result.appliedFilters.regions },
    coreCapabilities,
    candidateCount: result.total,
    directCapabilityMatchCount: result.directCapabilityMatchCount,
    missingCoreCapabilities: result.missingCoreCapabilities,
    status: result.status,
    requestedMatchCount: previousRequestedMatchCount,
    topResults: result.candidates.map(c => ({
      factoryId: c.factory.id,
      companyName: c.factory.companyName,
      region: c.factory.region,
      relevanceTier: c.relevanceTier,
    })),
    searchSummary,
    lastSearchAt: new Date().toISOString(),
  };
}
