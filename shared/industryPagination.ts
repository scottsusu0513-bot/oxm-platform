// /industry/:slug 與 /industry/:slug/:sub 的正式頁碼式 Pagination 純運算邏輯
// （見對話中「Pagination + 產業 slug mapping 稽核」）。刻意抽成跟 React／
// wouter／tRPC 完全無關的 pure function，供 client（IndustryPage.tsx）與
// server（shared/seo/industryPages.ts）共用同一套「合法頁碼」定義，並且可以
// 在不需要 DOM／React render 的情況下直接單元測試。

/**
 * 把 URL 上的 "page" 參數字串正規化成合法頁碼：
 * - 不存在／空字串／非整數字串（例如 "abc"）／小於 1（0、負數）一律視為
 *   第 1 頁，不拋錯、不顯示空白頁。
 * - 只做「語法上」的正規化（是不是一個 >=1 的整數），不知道、也不需要知道
 *   實際 totalPages 是多少——是否超出 totalPages 由 clampPage() 另外處理
 *   （那一步需要先知道 DB 查出來的 total，這個函式純粹解析字串，不依賴任何
 *   非同步資料）。
 */
export function parsePageParam(raw: string | null | undefined): number {
  if (raw == null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return n;
}

/** page 轉回要放進 URL query string 的值：第 1 頁不留 "?page=1"，回傳 null 代表「不需要這個參數」。 */
export function pageToQueryValue(page: number): string | null {
  return page > 1 ? String(page) : null;
}

/** 依 total 筆數與 pageSize 算出總頁數，至少是 1（total 為 0 時仍有「第 1 頁」，顯示空清單，不是 0 頁）。 */
export function computeTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 把任意頁碼夾回 [1, totalPages] 範圍內——用於「網址寫 ?page=20 但只有 5 頁」這種情況 normalize 到最後一頁。 */
export function clampPage(page: number, totalPages: number): number {
  const tp = Math.max(1, totalPages);
  return Math.min(Math.max(page, 1), tp);
}

export type PaginationRangeItem = number | "ellipsis";

/**
 * 算出「精簡頁碼列」：永遠保留第 1、最後 1 頁，目前頁前後各抓 2 頁組成一個
 * 5 頁寬的視窗（視窗被頭尾夾到時往內縮，例如目前頁在最前面時視窗就是
 * 1~5、在最後面時就是 total-4~total），頭尾錨點與視窗之間如果真的有空隙
 * （差距 > 1）才插入 "ellipsis"；如果頁數夠少，頭尾錨點與視窗會自然重疊、
 * 完全不會出現省略號，直接列出全部頁碼（例如 total<=7 時一定是這種情況）。
 *
 * 範例（對應任務規格）：
 *   total=30, current=1  → [1,2,3,4,5,'ellipsis',29,30]
 *   total=30, current=15 → [1,2,'ellipsis',13,14,15,16,17,'ellipsis',29,30]
 *   total=30, current=29 → [1,2,'ellipsis',26,27,28,29,30]
 */
export function getPaginationRange(current: number, totalPages: number): PaginationRangeItem[] {
  const total = Math.max(1, totalPages);
  if (total <= 1) return [1];

  const cur = clampPage(current, total);
  const windowSize = 2; // 目前頁左右各顯示幾頁

  let windowStart = cur - windowSize;
  let windowEnd = cur + windowSize;
  if (windowStart < 1) {
    windowEnd += 1 - windowStart;
    windowStart = 1;
  }
  if (windowEnd > total) {
    windowStart -= windowEnd - total;
    windowEnd = total;
  }
  windowStart = Math.max(windowStart, 1);
  windowEnd = Math.min(windowEnd, total);

  const pages = new Set<number>();
  pages.add(1);
  if (total >= 2) pages.add(2);
  for (let p = windowStart; p <= windowEnd; p++) pages.add(p);
  pages.add(total);
  if (total - 1 >= 1) pages.add(total - 1);

  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);

  const result: PaginationRangeItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("ellipsis");
    result.push(sorted[i]);
  }
  return result;
}
