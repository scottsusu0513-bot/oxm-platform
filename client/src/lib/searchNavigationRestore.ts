/**
 * 搜尋結果頁「從工廠頁返回時恢復頁數／已載入結果／閱讀位置」的純邏輯（見對話
 * 「搜尋結果返回恢復」）。
 *
 * 篩選條件、keyword、sortBy 早就存在 URL（Search.tsx 從 URL 初始化），不另做
 * 一套 persistence；這裡只補上 URL 沒有的兩個暫時性 UI 狀態：page（桌機是目前
 * 頁數、手機是「載入更多」已載入到第幾批）與 scrollY。
 *
 * 存放位置是「/search 這筆 history entry 自己的 history.state」，不是 URL、也
 * 不是 sessionStorage：
 *   - 每筆 history entry 各自一份，返回／前進只會拿到那筆 entry 當時的狀態；
 *   - 不改 URL，分享連結、canonical、SEO、searchFingerprint 都不受影響；
 *   - 只做合併寫入，保留 App.tsx ScrollRestorationManager 的 visited 標記。
 * snapshot 記下寫入當下的 location.search 與是否為手機版面，讀取時兩者不符
 * （條件已變、或在桌機／手機版面之間切換，pageSize 不同）一律視為無效。
 */
export const SEARCH_RESTORE_STATE_KEY = "__oxmSearchRestore";

export interface SearchRestoreSnapshot {
  v: 1;
  search: string;
  mobile: boolean;
  page: number;
  scrollY: number;
}

// 手機「載入更多」恢復時需要把第 1..page-1 批都補回來（優先命中 React Query
// 快取），限制上限避免異常值造成大量請求。
export const MAX_RESTORE_PAGE = 50;

function asRecord(state: unknown): Record<string, unknown> | null {
  return state && typeof state === "object" && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : null;
}

export function readSearchRestoreSnapshot(
  historyState: unknown,
  currentSearch: string,
  isMobile: boolean,
): SearchRestoreSnapshot | null {
  const raw = asRecord(asRecord(historyState)?.[SEARCH_RESTORE_STATE_KEY]);
  if (!raw || raw.v !== 1) return null;
  const { search, mobile, page, scrollY } = raw;
  if (search !== currentSearch || mobile !== isMobile) return null;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > MAX_RESTORE_PAGE) return null;
  if (typeof scrollY !== "number" || !Number.isFinite(scrollY) || scrollY < 0) return null;
  return { v: 1, search, mobile, page, scrollY };
}

export function withSearchRestoreSnapshot(
  historyState: unknown,
  snapshot: Omit<SearchRestoreSnapshot, "v">,
): Record<string, unknown> {
  return { ...(asRecord(historyState) ?? {}), [SEARCH_RESTORE_STATE_KEY]: { v: 1, ...snapshot } };
}

// 搜尋條件改變時 Search.tsx 會 replace URL：保留其他 key（例如 App.tsx 的
// visited 標記——wouter navigate() 預設 state=null 會把它整個清掉，導致之後
// 從工廠頁返回被誤判成新導航而強制捲頂），只移除已失效的搜尋 snapshot。
export function withoutSearchRestoreSnapshot(historyState: unknown): Record<string, unknown> | null {
  const rec = asRecord(historyState);
  if (!rec) return null;
  const { [SEARCH_RESTORE_STATE_KEY]: _dropped, ...rest } = rec;
  return rest;
}

/**
 * 捲動位置恢復時機：跟分頁捲動同一套「資料已是畫面要呈現的結果」判斷——
 * page 相符、response fingerprint 等於目前條件、不是 placeholder，且手機
 * 已載入資料已補齊。
 */
export function shouldRestoreScroll(args: {
  pending: { page: number } | null;
  page: number;
  currentFingerprint: string;
  dataFingerprint: string | undefined;
  isPlaceholderData: boolean;
  mobileSeedPending: boolean;
}): boolean {
  const { pending, page, currentFingerprint, dataFingerprint, isPlaceholderData, mobileSeedPending } = args;
  if (!pending || pending.page !== page) return false;
  if (dataFingerprint !== currentFingerprint) return false;
  if (isPlaceholderData || mobileSeedPending) return false;
  return true;
}
