import * as db from "../db";
import { INDUSTRY_OPTIONS } from "../../shared/constants";
import type { AiChatTurn } from "./types";

/**
 * Phase 6B：AI 找消息——跟找工廠（factorySearchAction.ts）同一個產品定位（見
 * 對話中「找消息不是 Consultant Handoff，屬於 OXM AI 直接操作平台現有資源」）：
 * AI 直接查詢 OXM 既有 /news 資料並在聊天裡回答，不建立 AI Handoff Context、
 * 不建顧問案件、不顯示【幫你送出詢問】。
 *
 * 不新增 LLM call（見「十五」）：消息類型（展覽／競賽／重要／跨產業）與產業
 * 名稱都用 deterministic 白名單比對抽取，完全比照 factorySearchAction.ts 的
 * extractRegionsFromText 手法；不呼叫 server/semantic-search.ts（那是
 * Factory-specific 的語意抽取管線，見「十六：不要直接耦合 Factory-specific
 * logic」）。
 *
 * 目前沒有人工找消息 Action（見「十三」）：0 results 就誠實告知，不通知
 * admin、不建 sourcing request、不建 case。
 */

const DISPLAY_LIMIT = 3;
const KEYWORD_INPUT_MAX_LENGTH = 300;

export type NewsRelevanceTier = "high" | "medium" | "general";

export interface NewsSearchCandidate {
  id: number;
  slug: string;
  title: string;
  summary: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
  publishedAt: string | null;
  industryNames: string[];
  relevanceTier: NewsRelevanceTier;
  /** server 端組出的正式消息詳情網址，模型／client 都不得自己拼網址。 */
  url: string;
}

export interface NewsSearchActionResult {
  candidates: NewsSearchCandidate[];
  /** hard-filter 候選集合總數（未截斷到 DISPLAY_LIMIT）。 */
  total: number;
  zeroResult: boolean;
  appliedFilters: {
    categoryFilters: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean };
    industryNames: string[];
    keywords: string[];
  };
  /** server 端組出的「查看全部消息」網址，白名單對應 News.tsx 真實使用的 query param 名稱。 */
  viewAllUrl: string;
}

function buildNewsUrl(slug: string): string {
  return `/news/${slug}`;
}

/**
 * 白名單 query param 對應 client/src/pages/News.tsx 的 parseCategoryFromSearch()：
 * category(important/competition/exhibition/cross-industry/industry) +
 * industry（category===industry 時才帶）。多個類型／多個產業時，只取第一個
 * 當作 /news 頁單一分類（/news 本身的 category 是單選，不是給 AI 用的多選
 * 候選查詢），這是「查看全部」導頁時的合理簡化，不影響 AI 聊天內回答本身
 * 使用的多選 hard filter。
 */
function buildNewsViewAllUrl(filters: {
  categoryFilters: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean };
  industryNames: string[];
}): string {
  const p = new URLSearchParams();
  const { categoryFilters, industryNames } = filters;
  if (industryNames.length > 0) {
    p.set("category", "industry");
    p.set("industry", industryNames[0]);
  } else if (categoryFilters.isExhibition) {
    p.set("category", "exhibition");
  } else if (categoryFilters.isCompetition) {
    p.set("category", "competition");
  } else if (categoryFilters.isImportant) {
    p.set("category", "important");
  } else if (categoryFilters.isCrossIndustry) {
    p.set("category", "cross-industry");
  }
  const qs = p.toString();
  return qs ? `/news?${qs}` : "/news";
}

/** Deterministic：消息類型的封閉關鍵字集合，語意上直接對應 news 表既有的四個布林欄位，不是開放式業務分類。 */
export function extractNewsCategoriesFromText(text: string): {
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
} {
  return {
    isImportant: /重要/.test(text),
    isCompetition: /競賽|比賽/.test(text),
    isExhibition: /展覽|展會|展/.test(text),
    isCrossIndustry: /跨產業/.test(text),
  };
}

/** Deterministic：白名單子字串比對，沿用 factorySearchAction.ts extractRegionsFromText 同樣的手法，對照 shared/constants.ts 既有 INDUSTRY_OPTIONS，不新增第二份分類清單。 */
export function extractIndustriesFromText(text: string): string[] {
  const found: string[] = [];
  for (const industry of INDUSTRY_OPTIONS) {
    if (text.includes(industry) && !found.includes(industry)) found.push(industry);
  }
  return found;
}

/** 拼接對話中所有使用者訊息，最忠實保留使用者原始說法。 */
export function buildNewsQueryInputFromHistory(history: AiChatTurn[]): string {
  const text = history
    .filter(t => t.role === "user")
    .map(t => t.content.trim())
    .filter(Boolean)
    .join(" ");
  return text.slice(0, KEYWORD_INPUT_MAX_LENGTH);
}

/** 只取最後一則使用者訊息，用來判斷「這一輪有沒有明確講新條件」。 */
function buildLatestUserTurnText(history: AiChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.role === "user" && turn.content.trim()) return turn.content.trim().slice(0, KEYWORD_INPUT_MAX_LENGTH);
  }
  return "";
}

/**
 * 泛用填充詞／結構性語助詞：本身沒有排序或篩選價值，只是「找消息」這種
 * 查詢意圖本身的語法框架（不是業務分類，見對話中「不要另外在 AI prompt
 * 維護一份容易漂移的固定分類清單」——這裡只是拿掉語助詞，不是分類）。
 */
const NEWS_QUERY_FILLER_TERMS = [
  "最近", "有沒有", "有什麼", "什麼", "相關", "的呢", "的話", "呢", "嗎", "活動",
  "消息", "資訊", "新聞", "可以參加", "可以", "參加", "幫我找", "幫我", "找",
];

/**
 * 組出 keyword（排序／在完全沒有類型與產業時當 hard filter 用）：把已經被
 * 結構化抽取出來的類型關鍵字、產業名稱、以及語助詞都從原文拿掉，剩下的
 * 才是真正的自由關鍵字（例如展覽會名稱、特定主題），deterministic 字串處理
 * 全程不呼叫任何模型。
 */
export function extractNewsKeywords(params: { text: string; matchedIndustries: string[] }): string[] {
  let remaining = params.text;
  for (const industry of params.matchedIndustries) remaining = remaining.split(industry).join(" ");
  for (const term of ["重要", "競賽", "比賽", "展覽", "展會", "展", "跨產業", ...NEWS_QUERY_FILLER_TERMS]) {
    remaining = remaining.split(term).join(" ");
  }
  const cleaned = remaining.replace(/[，,。.？?！!、\s]+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter(t => t.length >= 2).slice(0, 3);
}

/**
 * 換條件要真的重新搜尋（見對話中「十一」）：類型／產業各自獨立判斷——這一輪
 * 使用者訊息本身有講到的類型／產業就直接取代（不跟前面回合union），完全沒
 * 講到才 fallback 沿用整段歷史（服務「還有其他的嗎」這種延續性追問）。
 *
 * 例如 Turn1「金屬加工有什麼展覽？」→ Turn2「食品的呢？」：Turn2 沒提到任何
 * 類型關鍵字 → 類型沿用歷史（展覽）；但有提到「食品」→ 產業直接取代成
 * ["食品"]，不會跟 Turn1 的「金屬加工」union 在一起。
 */
function resolveNewsQueryFilters(history: AiChatTurn[]): {
  categoryFilters: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean };
  industryNames: string[];
  keywords: string[];
} {
  const fullText = buildNewsQueryInputFromHistory(history);
  const latestText = buildLatestUserTurnText(history);

  const latestCategories = extractNewsCategoriesFromText(latestText);
  const hasLatestCategory = Object.values(latestCategories).some(Boolean);
  const categoryFilters = hasLatestCategory ? latestCategories : extractNewsCategoriesFromText(fullText);

  const latestIndustries = extractIndustriesFromText(latestText);
  const industryNames = latestIndustries.length > 0 ? latestIndustries : extractIndustriesFromText(fullText);

  const keywordSourceText = hasLatestCategory || latestIndustries.length > 0 ? latestText : fullText;
  const keywords = extractNewsKeywords({ text: keywordSourceText, matchedIndustries: industryNames });

  return { categoryFilters, industryNames, keywords };
}

function tierNumberToLabel(tier: 0 | 1 | 2): NewsRelevanceTier {
  if (tier === 2) return "high";
  if (tier === 1) return "medium";
  return "general";
}

/**
 * 唯一對外入口，供 chatService.ts 在 Layer 2 判斷 primaryService === "news"
 * 之後呼叫。server-authoritative：不信任任何 client 輸入，一律重新用對話
 * 內容自己判斷、自己查詢。
 */
export async function runNewsSearchAction(history: AiChatTurn[]): Promise<NewsSearchActionResult> {
  const { categoryFilters, industryNames, keywords } = resolveNewsQueryFilters(history);

  const appliedFilters = { categoryFilters, industryNames, keywords };
  const viewAllUrl = buildNewsViewAllUrl({ categoryFilters, industryNames });

  const result = await db.searchNewsForAi({
    categoryFilters,
    industryNames,
    keywords,
    limit: DISPLAY_LIMIT,
  });

  const candidates: NewsSearchCandidate[] = result.items.map(item => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    isImportant: item.isImportant,
    isCompetition: item.isCompetition,
    isExhibition: item.isExhibition,
    isCrossIndustry: item.isCrossIndustry,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    industryNames: item.industryNames,
    relevanceTier: tierNumberToLabel(item.tier),
    url: buildNewsUrl(item.slug),
  }));

  return {
    candidates,
    total: result.total,
    zeroResult: result.total === 0,
    appliedFilters,
    viewAllUrl,
  };
}
