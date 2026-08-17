import * as db from "../db";
import { getSearchIntent, type AISearchIntent } from "../semantic-search";
import { TAIWAN_REGIONS } from "../../shared/constants";
import { toAiFactorySearchResultItem, type AiFactorySearchResultItem } from "./factorySafeProjection";
import type { AiChatTurn } from "./types";

/**
 * Phase 6A：AI 找工廠——「找工廠」與「找消息」不是顧問服務（見對話中「先更正
 * 一個產品定位」），AI 直接操作 OXM 既有工廠搜尋資源，不建立 AI Handoff
 * Context、不建顧問案件、不建 AI Case Assessment、不顯示「幫你送出詢問」。
 *
 * 搜尋邏輯修正（見對話中「Phase 6A 搜尋邏輯修正：Hard Filters + AI Ranking，
 * 不要用 AI 過度篩掉候選」）：Hard Filter 決定候選集合、AI Ranking 決定排序，
 * 兩者責任分離：
 * (1) Hard Filters（SQL WHERE，決定「誰能出現」）：region（deterministic 白
 *     名單比對）、mainIndustry（intent.mainIndustries，使用者明講或語意上
 *     無歧義地隱含，例如「金屬加工廠」）。V1 保守：subIndustry 預設不當
 *     hard filter（沒有跟正式 taxonomy 之間的一對一 canonical mapping 規則），
 *     一律降級為 ranking signal 的一部分。
 * (2) Ranking Signals（只排序，決定「誰排前面」）：intent.productKeywords 這
 *     類能力／技術詞（CNC、五軸加工…），丟給 db.searchFactories 的
 *     rankingSignals，在 hard-filter 候選集合內做 3 層 tier 排序，絕對不會
 *     拿來排除候選（見 server/db.ts computeRankingTier）。
 *
 * 不新增 LLM call：「要不要現在就搜」沿用 Layer 2 既有的 enforceDiagnosisGate
 * （bottleneckStatus===clear || userWantsAction）；「地區」用
 * TAIWAN_REGIONS 白名單 deterministic 抽取；「主產業／能力詞」直接沿用既有
 * server/semantic-search.ts getSearchIntent()（跟直接 /search 頁共用）。
 */

const CANDIDATE_LIMIT = 20;
const DISPLAY_LIMIT = 5;
/** 對話中使用者訊息拼接後餵給 getSearchIntent 的長度上限——getSearchIntent
 * 內部本身也會再截到 80 字當快取 key，這裡先做一個寬鬆上限避免組出超長字串。 */
const KEYWORD_INPUT_MAX_LENGTH = 300;

/** 「高度相關」／「可能相關」／「其他符合條件」——對應 db.ts computeRankingTier
 * 的 2/1/0，只是排序層的誠實標示，不對使用者顯示任何 AI 分數。 */
export type FactoryRelevanceTier = "high" | "medium" | "general";

export interface FactorySearchCandidate {
  factory: AiFactorySearchResultItem;
  relevanceTier: FactoryRelevanceTier;
  matchReason: string;
  /** server 端組出的正式工廠頁網址，模型／client 都不得自己拼網址（見「十二」）。 */
  url: string;
}

/**
 * 見對話中「OXM AI 已完成功能整體驗收修正」五：搜尋結果的三種結構化狀態，
 * 由 server 決定，不是 React 或 AI 自己判斷字面文案：
 * - NO_HARD_CANDIDATE：Hard Filter 候選集合本身 = 0（連地區／主產業都配不到）。
 * - MATCH_FOUND：有候選，且（a）使用者這次根本沒有指定核心能力／技術詞
 *   （rankingSignals 是空的，代表「符合地區＋主產業」本身就是他要的答案，
 *   沒有東西可以「不符合」），或（b）至少一家候選公開資料明確命中核心能力。
 * - SIMILAR_ONLY：有候選、使用者確實指定了核心能力，但沒有任何候選能提供
 *   直接文字證據——這批候選只是「符合地區／產業，但無法確認真正要的能力」
 *   的相似工廠，Assistant 必須先講清楚「真正需求沒有明確找到」再帶出這批。
 */
export type FactorySearchStatus = "MATCH_FOUND" | "SIMILAR_ONLY" | "NO_HARD_CANDIDATE";

/**
 * 單一權威判斷式，factorySearchAction.ts 本身與 factorySearchState.ts 的
 * fallback 快照建構都呼叫這個函式，避免兩處各自維護一份、慢慢漂移出不一致
 * 的結果。見上方 FactorySearchStatus 的三種狀態說明。
 */
export function deriveFactorySearchStatus(params: {
  candidateCount: number;
  coreCapabilityCount: number;
  hasExplicitCapabilityMatch: boolean;
}): FactorySearchStatus {
  if (params.candidateCount === 0) return "NO_HARD_CANDIDATE";
  if (params.coreCapabilityCount === 0 || params.hasExplicitCapabilityMatch) return "MATCH_FOUND";
  return "SIMILAR_ONLY";
}

export interface FactorySearchActionResult {
  candidates: FactorySearchCandidate[];
  /** hard-filter 候選集合總數（未截斷到 DISPLAY_LIMIT），不是「AI 覺得相關」的數量。 */
  total: number;
  /** 只有 hard-filter 候選集合本身 = 0 才是 true（見「十五、重新定義 Zero Result」），不是「AI 排不出高相關」。 */
  zeroResult: boolean;
  /** 見上方 FactorySearchStatus 說明；Final Response Composer 的 wording 規則直接依這個欄位分流，不是自己重新判斷。 */
  status: FactorySearchStatus;
  appliedFilters: {
    mainIndustries: string[];
    regions: string[];
    /** 只做排序用的能力／技術詞，不是篩選條件。 */
    rankingSignals: string[];
  };
  /** 候選集合裡是否至少有一家公開資料明確命中 rankingSignals；全部都是
   * general 時，UI 應該誠實說「目前公開資料未明確標示」而不是「不適合」。 */
  hasExplicitCapabilityMatch: boolean;
  /** server 端組出的「查看全部搜尋結果」網址，白名單對應 Search.tsx 真實使用的 query param 名稱（見「十四、十五」）。 */
  viewAllUrl: string;
  /**
   * Phase 6A.1：候選集合（hard filter 全量，非 DISPLAY_LIMIT 截斷後）中，
   * 公開資料明確符合「全部」rankingSignals（= Core Capabilities）的工廠數。
   * 供 server/ai/factorySearchRequestService.ts 判斷是否需要人工協尋，
   * 不是給使用者看的分數。
   */
  directCapabilityMatchCount: number;
  /** rankingSignals 裡完全沒有任何候選能提供直接文字證據的能力詞。 */
  missingCoreCapabilities: string[];
}

function buildFactoryUrl(factoryId: number): string {
  return `/factory/${factoryId}`;
}

/**
 * 白名單 query param 對應 client/src/pages/Search.tsx 的 buildParams()：
 * industry(repeated) / region(repeated) / q。只帶 hard filters（industry/
 * region）+ 排序用的 q，不帶 subIndustry／keyword——避免 /search 頁把能力詞
 * 當成硬性篩選、把「台中其他金屬加工廠」都排除掉（見「十、/search 頁要保留
 * 最大的 Hard Filter 結果集合」）。
 */
/**
 * Phase 6 UI Foundation（見對話中「AI Search Context 設計」）：登入使用者且
 * 這次搜尋屬於某個 conversation 時，額外帶 aiSearch=<conversationId>——這是
 * server-authoritative 的擁有權驗證入口（見 routers.ts factory.search 對
 * aiSearchConversationId 的處理，不信任這個 id 以外的任何 client 輸入），
 * /search 頁進入 AI Ranking Mode（含 AI-only 的橘框標示）只能透過這個欄位
 * 觸發，不能透過既有的 q（q 對訪客／手動搜尋維持原本「純排序提示、無標示」
 * 的角色，見「AI-only 橘框」規則）。conversationId 是 null（訪客、或這次
 * 搜尋不屬於任何登入對話）時，只帶 q，行為與 Phase 6A 完全相同。
 */
function buildSearchViewAllUrl(filters: {
  mainIndustries: string[];
  regions: string[];
  rankingSignals: string[];
  conversationId: number | null;
}): string {
  const p = new URLSearchParams();
  filters.mainIndustries.forEach(i => p.append("industry", i));
  filters.regions.forEach(r => p.append("region", r));
  const q = filters.rankingSignals.join(" ").trim();
  if (q) p.set("q", q.slice(0, 100));
  if (filters.conversationId != null) p.set("aiSearch", String(filters.conversationId));
  const qs = p.toString();
  return qs ? `/search?${qs}` : "/search";
}

/**
 * Deterministic：對使用者訊息文字做 TAIWAN_REGIONS 白名單子字串比對，不讓
 * 模型自己輸出地區字串（見「十五」）。日常口語很少有人講「台中市」，通常
 * 只講「台中」——這裡用「去掉結尾市／縣」的字串去比對，同時保留完整、帶
 * 「市／縣」的正式值當回傳結果，白名單本身沒有變，只是比對時更寬容。
 */
export function extractRegionsFromText(text: string): string[] {
  const found: string[] = [];
  for (const region of TAIWAN_REGIONS) {
    const shortForm = region.replace(/[市縣]$/, "");
    if ((text.includes(region) || (shortForm && text.includes(shortForm))) && !found.includes(region)) {
      found.push(region);
    }
  }
  return found;
}

/** 拼接對話中所有使用者訊息（不是 Layer 1 改寫過的摘要），最忠實保留使用者原始說法，餵給既有語意搜尋服務。 */
export function buildKeywordInputFromHistory(history: AiChatTurn[]): string {
  const text = history
    .filter(t => t.role === "user")
    .map(t => t.content.trim())
    .filter(Boolean)
    .join(" ");
  return text.slice(0, KEYWORD_INPUT_MAX_LENGTH);
}

/**
 * 泛用填充詞：本身沒有額外排序價值（等於在講「這是一間工廠」，平台本來就只
 * 收工廠），不當作 ranking signal。
 */
const GENERIC_FILLER_TERMS = new Set([
  "加工廠", "工廠", "廠商", "公司", "企業", "製造商", "供應商", "代工", "代工廠", "製造", "廠",
]);

/**
 * 組出 ranking signals（能力／技術詞，例如 CNC、五軸加工），只用來排序，不是
 * hard filter（見「四、能力／技術詞預設是 Ranking Signal」）：
 *
 * - 來源是 intent.productKeywords（模型判斷的具體產品／能力詞，可能含近義
 *   詞，見 semantic-search.ts buildIntentPrompt），V1 全部保留、不再挑單一
 *   候選——因為現在是排序訊號而非互斥的篩選字串，可以同時吃多個訊號。
 * - 跟 mainIndustries 完全相同的詞會被拿掉（例如 productKeywords 出現
 *   「金屬加工」本身，跟 hard filter 重複、沒有額外排序區分力）。
 * - 泛用填充詞（加工廠/工廠…）拿掉。
 */
export function buildRankingSignals(params: {
  intent: AISearchIntent | null;
  mainIndustries: string[];
}): string[] {
  const { intent, mainIndustries } = params;
  if (!intent) return [];
  const structured = new Set(mainIndustries);
  const seen = new Set<string>();
  const signals: string[] = [];
  for (const raw of intent.productKeywords) {
    const term = raw.trim();
    if (!term) continue;
    if (structured.has(term)) continue;
    if (GENERIC_FILLER_TERMS.has(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(term);
  }
  return signals.slice(0, 5);
}

/**
 * matchReason 的措辭必須誠實、不得假裝「不適合」（見「十四」）：general tier
 * 只代表「目前公開資料未明確提到」，這家工廠仍然完整符合 hard filters，可能
 * 只是資料還沒補齊。
 */
function buildMatchReason(params: {
  factory: AiFactorySearchResultItem;
  mainIndustries: string[];
  regions: string[];
  tier: FactoryRelevanceTier;
}): string {
  const { factory, mainIndustries, regions, tier } = params;
  const matchedIndustry = mainIndustries.find(i => factory.industry.includes(i));
  const matchedRegion = regions.length > 0 && regions.includes(factory.region) ? factory.region : null;

  const parts: string[] = [];
  if (matchedIndustry) parts.push(`主要產業符合「${matchedIndustry}」`);
  if (matchedRegion) parts.push(`位於${matchedRegion}`);
  if (parts.length === 0) parts.push("符合你指定的搜尋條件");

  if (tier === "high") parts.push("公開資料明確提到你說的能力關鍵字");
  else if (tier === "general") parts.push("目前公開資料未明確提到相關能力");

  return parts.join("，");
}

function tierNumberToLabel(tier: 0 | 1 | 2): FactoryRelevanceTier {
  if (tier === 2) return "high";
  if (tier === 1) return "medium";
  return "general";
}

/**
 * 唯一對外入口，供 chatService.ts 在 Layer 2 判斷 primaryService ===
 * "factory_search"（且已經通過 enforceDiagnosisGate）之後呼叫。server-
 * authoritative：不信任任何 client 傳入的 industry/region/factoryIds，一律
 * 重新用對話內容自己判斷、自己查詢（見「二十二」）。
 *
 * 「不要自行跨 Hard Filter」（見「九」）：hard-filter 候選集合 0 筆時，不會
 * 自動放寬地區／產業重新查一次，只誠實回報 zeroResult=true，交給 UI／回覆
 * 文字去問使用者要不要放寬。
 */
export async function runFactorySearchAction(
  history: AiChatTurn[],
  conversationId: number | null = null
): Promise<FactorySearchActionResult> {
  const keywordInput = buildKeywordInputFromHistory(history);
  const regions = extractRegionsFromText(keywordInput);

  const intent = keywordInput ? await getSearchIntent(keywordInput) : null;
  const mainIndustries = intent?.mainIndustries ?? [];
  const rankingSignals = buildRankingSignals({ intent, mainIndustries });

  const appliedFilters = { mainIndustries, regions, rankingSignals };
  const viewAllUrl = buildSearchViewAllUrl({ ...appliedFilters, conversationId });

  // Hard filter 本身完全空（沒有地區也沒有主產業）時，不執行「顯示所有已上架
  // 工廠」這種沒有邊界的搜尋——這種情況本來就應該被 Layer 1 的 calibration
  // 留在 unclear、不會走到這裡（見 CASE 4），這裡只是防禦性 fallback。
  const hasHardFilter = mainIndustries.length > 0 || regions.length > 0;
  if (!hasHardFilter) {
    return {
      candidates: [], total: 0, zeroResult: true, status: "NO_HARD_CANDIDATE", appliedFilters, hasExplicitCapabilityMatch: false, viewAllUrl,
      directCapabilityMatchCount: 0, missingCoreCapabilities: rankingSignals,
    };
  }

  const result = await db.searchFactories({
    industry: mainIndustries.length > 0 ? mainIndustries : undefined,
    region: regions.length > 0 ? regions : undefined,
    rankingSignals: rankingSignals.length > 0 ? rankingSignals : undefined,
    intent,
    userHasSelectedIndustry: mainIndustries.length > 0,
    page: 1,
    pageSize: CANDIDATE_LIMIT,
  });

  const tiers = result.tiers ?? result.items.map(() => 1 as const);
  const candidates: FactorySearchCandidate[] = result.items.slice(0, DISPLAY_LIMIT).map((row, i) => {
    const factory = toAiFactorySearchResultItem(row);
    const tier = tierNumberToLabel(tiers[i] ?? 1);
    return {
      factory,
      relevanceTier: tier,
      matchReason: buildMatchReason({ factory, mainIndustries, regions, tier }),
      url: buildFactoryUrl(factory.id),
    };
  });

  const zeroResult = result.total === 0;
  const hasExplicitCapabilityMatch = tiers.some(t => t === 2);
  const status = deriveFactorySearchStatus({
    candidateCount: result.total,
    coreCapabilityCount: rankingSignals.length,
    hasExplicitCapabilityMatch,
  });

  return {
    candidates,
    total: result.total,
    zeroResult,
    status,
    appliedFilters,
    hasExplicitCapabilityMatch,
    viewAllUrl,
    directCapabilityMatchCount: result.directCapabilityMatchCount ?? 0,
    missingCoreCapabilities: result.missingCapabilities ?? [],
  };
}
