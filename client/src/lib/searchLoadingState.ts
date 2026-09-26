/**
 * 搜尋結果頁 Loading UX 的純邏輯（見對話「AI 搜尋 Loading UX 優化」）。
 *
 * factory.search 是單一 tRPC HTTP request，前端在 response 回來以前無從得知
 * server 是否正在呼叫 AI 語意分析。文案只依等待時間切換：超過
 * SEARCH_LOADING_LONG_MS 一律顯示「AI 搜尋」文案——這是產品 UX 規則（見對話
 * 「>4 秒 Loading 文案」），不是 server 中間狀態回報。
 *
 * pending 由呼叫端依「目前 active 搜尋條件的 fingerprint 還沒有對應 response」
 * 判斷，文案永遠用目前 active 的 keyword，不會跟舊 request 綁在一起。
 */

// 快速搜尋（多數本機／快取命中 < 250ms）不閃 Loading UI；結果一回來就立即
// render，這個 delay 只延後「顯示 Loading」，不延後結果。
export const SEARCH_LOADING_SHOW_DELAY_MS = 250;
// 超過 4s 切換成「AI 搜尋」文案。
export const SEARCH_LOADING_LONG_MS = 4000;

export type SearchLoadingPhase = "hidden" | "searching" | "long";

export function getSearchLoadingPhase(pending: boolean, elapsedMs: number): SearchLoadingPhase {
  if (!pending || elapsedMs < SEARCH_LOADING_SHOW_DELAY_MS) return "hidden";
  return elapsedMs >= SEARCH_LOADING_LONG_MS ? "long" : "searching";
}

export function getSearchLoadingMessage(keyword: string, phase: Exclude<SearchLoadingPhase, "hidden">): string {
  const kw = keyword.trim();
  if (phase === "long") {
    return kw ? `正在使用 AI 搜尋，為您擴大比對「${kw}」相關產品與廠商` : "正在使用 AI 搜尋，為您擴大比對相關廠商";
  }
  return kw ? `正在搜尋「${kw}」相關廠商` : "正在搜尋符合條件的廠商";
}

// 手機窄螢幕上，>4s 文案帶較長 keyword 時改用不含 keyword 的精簡版。
export const MOBILE_LONG_MESSAGE_KEYWORD_MAX_CHARS = 6;

/** 手機版需要改用的精簡文案；不需要時回傳 null（手機與桌機顯示同一句）。 */
export function getSearchLoadingCompactMessage(keyword: string, phase: Exclude<SearchLoadingPhase, "hidden">): string | null {
  const kw = keyword.trim();
  if (phase !== "long" || kw.length <= MOBILE_LONG_MESSAGE_KEYWORD_MAX_CHARS) return null;
  return "正在使用 AI 搜尋，為您擴大比對相關產品與廠商";
}

/**
 * 結果區中央 Loading 卡片的分行文案：title 為主句；>4s 才有 detail 第二行，
 * compactDetail 是手機窄螢幕在 keyword 過長時改用的第二行（不需要時為 null）。
 * 合起來與 getSearchLoadingMessage／getSearchLoadingCompactMessage 同義。
 */
export function getSearchLoadingLines(keyword: string, phase: Exclude<SearchLoadingPhase, "hidden">): {
  title: string;
  detail: string | null;
  compactDetail: string | null;
} {
  const kw = keyword.trim();
  if (phase === "searching") {
    return { title: getSearchLoadingMessage(kw, phase), detail: null, compactDetail: null };
  }
  return {
    title: "正在使用 AI 搜尋",
    detail: kw ? `為您擴大比對「${kw}」相關產品與廠商` : "為您擴大比對相關廠商",
    compactDetail: getSearchLoadingCompactMessage(kw, phase) ? "為您擴大比對相關產品與廠商" : null,
  };
}

/**
 * pending = 目前畫面上的搜尋條件還沒拿到屬於自己的 response：
 * - 第一次載入（isLoading）；或
 * - 正在 fetch，且目前顯示的 data（placeholderData 沿用的上一筆）的
 *   searchFingerprint 不等於目前條件。
 * searchFingerprint 不涵蓋 page，所以單純換頁不算新的搜尋，不觸發這個
 * Loading（分頁 UX 維持原樣）。
 */
export function isActiveSearchPending(args: {
  isLoading: boolean;
  isFetching: boolean;
  dataFingerprint: string | undefined;
  currentFingerprint: string;
}): boolean {
  if (args.isLoading) return true;
  return args.isFetching && args.dataFingerprint !== args.currentFingerprint;
}
