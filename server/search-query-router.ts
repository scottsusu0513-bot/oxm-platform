/**
 * Deterministic Search Query Router（Phase 3 — 見對話中「in-memory factory
 * name index」重新設計）。
 *
 * 目的：判斷一個使用者輸入的搜尋關鍵字該不該進 AI 語意分析
 * （server/semantic-search.ts getSearchIntent，實際會打 OpenAI），還是可以
 * 完全略過，直接走既有的一般關鍵字搜尋（LIKE / JSON_SEARCH）。
 *
 * ## 為什麼不是 Phase 1／Phase 2 的設計
 *
 * Phase 1：讓「油封」「CNC」「金屬加工」等產品／製程／taxonomy 詞直接
 * DIRECT，用正式站真實資料 regression test 後發現太激進（召回率下降、排序
 * 改變、sub-industry 詞甚至掉到 0 筆）。
 *
 * Phase 2：改成對 `factories.name` 做一次 read-only DB 查詢
 * （`findStrongFactoryNameMatch`）判斷公司名稱命中。正確性沒問題，但代價是
 * **所有**非自然語言 query（包含油封／CNC／金屬加工這種本來就該走
 * AI-assisted 的主要需求搜尋）都固定多付一趟 DB round trip——這個 tradeoff
 * 不被接受。
 *
 * ## Phase 3：in-memory factory name index
 *
 * 改成 server process 記憶體裡維護一份所有 `status='approved'` 工廠的
 * id／name 清單（見 server/factory-name-index.ts），Query Router 判斷
 * DIRECT 時只在記憶體裡比對：
 *   - warm cache 下**零** DB round trip、零額外延遲——油封／CNC／金屬加工這類
 *     本來就該進 HYBRID 的搜尋，完全不受影響。
 *   - 索引本身是 performance optimization，不是搜尋正確性依賴：DB 暫時失敗
 *     時有舊 cache 就用舊 cache，完全沒有 cache 就安全回傳「沒有命中」，讓
 *     query 照舊 fallback 到 HYBRID／AI-assisted（見
 *     server/factory-name-index.ts 的 stale-fallback 說明）。
 *
 * 判定規則（見 factory-name-index.ts matchAgainstIndex）：
 *   - exact match（完全等於某間工廠名稱）→ 強命中。
 *   - prefix match 且「恰好只有一筆」→ 強命中（例如「創普」唯一 prefix 命中
 *     「創普科技股份有限公司」）。
 *   - prefix match 有多筆（例如「大成」同時 prefix 命中「大成工業」「大成
 *     精密」）→ ambiguous，不猜是哪一間，維持 HYBRID。
 *   - 完全沒有任何工廠名稱命中（包含看起來像完整公司全名、但 DB 裡根本沒有
 *     這間工廠）→ 一律 fallback 到 HYBRID（AI-assisted），**絕對不會**因為
 *     「看起來像公司名」就直接 DIRECT 回 0 筆結果。
 *   - 只用 prefix（startsWith），不用 %contains%——「科技」不會因為中間包含
 *     在很多公司名稱裡就被當成強命中。
 *
 * ## 三種分類
 *   DIRECT   — 通過 in-memory strong factory name match（見上）。
 *   SEMANTIC — 明確自然語言需求句（「我要找…」「有沒有…可以做…」），需要
 *              AI 理解使用者的「需求」而不是單純比對文字。純文字規則，不需要
 *              DB／記憶體索引，執行時間接近 0ms，且 precedence 高於 DIRECT
 *              判斷（見對話中「明顯自然語言需求優先 SEMANTIC」：「我要找創普
 *              能不能做這個產品」即使包含「創普」仍然是 SEMANTIC，因為使用者
 *              在問需求，不是單純導航到公司頁）。
 *   HYBRID   — 除了以上兩種以外的所有情況，包含所有產品／製程／taxonomy／
 *              複合條件詞、ambiguous／找不到的工廠名稱、以及任何無法高信心
 *              判斷的情況——安全原則是「不確定就維持 AI-assisted」。
 *
 * DIRECT 只會完全略過 getSearchIntent；HYBRID／SEMANTIC 都維持原本既有的
 * AI-assisted 流程，行為完全不變（見 server/routers.ts factory.search）。
 */
import { memoryFactoryNameMatch } from "./factory-name-index";

export type SearchRoute = "DIRECT" | "HYBRID" | "SEMANTIC";

export interface SearchRouteResult {
  route: SearchRoute;
  reason: string;
}

// 刻意用完整的動詞／疑問片語（例如「可以做」「需要」），不用單一個字
// （例如裸的「可以」）——避免公司名稱裡剛好包含這些常見中文字就被誤判
// （見對話中「公司全名不要因為包含『可以』之類公司名稱中文字而錯判」）。
const SEMANTIC_MARKERS = [
  "我要找", "我想找", "幫我找", "有沒有", "哪些工廠", "哪間工廠",
  "可以做", "能不能做", "能做", "需要", "希望找", "請問哪裡", "適合做", "有辦法做",
] as const;

/**
 * 純函式、同步、不呼叫 DB／記憶體索引——只偵測是不是明顯自然語言需求句。
 * 回傳命中的 marker 字串，沒命中回傳 null。
 */
export function detectNaturalLanguageMarker(rawKeyword: string): string | null {
  const keyword = rawKeyword.trim();
  if (!keyword) return null;
  return SEMANTIC_MARKERS.find(m => keyword.includes(m)) ?? null;
}

/**
 * 分類一個搜尋關鍵字。這個 function 本身：
 *   - 不呼叫 OpenAI / 任何外部服務
 *   - 不呼叫 DB（除非 in-memory index 還沒載入過或已過期，見
 *     server/factory-name-index.ts；warm cache 下完全是記憶體操作）
 *   - 沒有其他 side effect
 *
 * Precedence：自然語言判斷永遠先於工廠名稱比對——即使 keyword 裡包含一個
 * 明確的工廠名稱，只要整句話是自然語言需求句，就維持 SEMANTIC。
 */
export async function classifySearchQuery(rawKeyword: string): Promise<SearchRouteResult> {
  const keyword = rawKeyword.trim();
  if (!keyword) return { route: "HYBRID", reason: "empty_keyword" };

  const semanticHit = detectNaturalLanguageMarker(keyword);
  if (semanticHit) {
    return { route: "SEMANTIC", reason: `natural_language_marker:${semanticHit}` };
  }

  const nameMatch = await memoryFactoryNameMatch(keyword);
  if (nameMatch) {
    return { route: "DIRECT", reason: `strong_factory_name_match:${nameMatch.tier}` };
  }

  return { route: "HYBRID", reason: "no_strong_name_match" };
}
