import type { NewsSearchActionResult } from "./newsSearchAction";

/**
 * Current News Search State（見對話中「Current News Search State」，比照
 * server/ai/factorySearchState.ts 的設計）：這段對話「剛剛搜尋了什麼消息」的
 * server-authoritative、安全精簡快照。
 *
 * 持久化位置：塞進既有 ConversationState（aiConversations.currentStateJson），
 * 不新增 migration。只是這一段對話的 session state，不寫入 Enterprise
 * Memory（見「十」：除非最後 summary 真有長期價值，這裡目前沒有）。
 */
export interface NewsSearchStateSnapshot {
  categoryFilters: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean };
  industryNames: string[];
  keywords: string[];
  resultCount: number;
  topResults: { newsId: number; title: string; relevanceTier: string }[];
  searchSummary: string;
  lastSearchAt: string;
}

const CATEGORY_LABELS: { key: keyof NewsSearchStateSnapshot["categoryFilters"]; label: string }[] = [
  { key: "isExhibition", label: "展覽" },
  { key: "isCompetition", label: "競賽" },
  { key: "isImportant", label: "重要消息" },
  { key: "isCrossIndustry", label: "跨產業資訊" },
];

/**
 * search_news 每次真正執行完成後呼叫，用這次 server-authoritative 的搜尋結果
 * 重建整份 snapshot。
 */
export function buildNewsSearchStateSnapshot(result: NewsSearchActionResult): NewsSearchStateSnapshot {
  const categoryLabels = CATEGORY_LABELS.filter(c => result.appliedFilters.categoryFilters[c.key]).map(c => c.label);
  const scope = [...categoryLabels, ...result.appliedFilters.industryNames].join("、") || "不限類型／產業";
  const keywords = result.appliedFilters.keywords;
  const searchSummary = keywords.length > 0 ? `${scope}；關鍵字：${keywords.join("、")}` : scope;
  return {
    categoryFilters: result.appliedFilters.categoryFilters,
    industryNames: result.appliedFilters.industryNames,
    keywords,
    resultCount: result.total,
    topResults: result.candidates.map(c => ({ newsId: c.id, title: c.title, relevanceTier: c.relevanceTier })),
    searchSummary,
    lastSearchAt: new Date().toISOString(),
  };
}
