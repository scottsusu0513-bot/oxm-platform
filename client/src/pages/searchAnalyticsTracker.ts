/**
 * Search.tsx 的「一次真正的搜尋只記一筆 analytics search event」判斷邏輯
 * （見對話「Search Analytics」／「Search Analytics resultCount 方案 A」）。
 * 抽成純函式方便獨立測試，不需要真的掛載整個 Search 頁面元件。
 *
 * 修法沿革：最早用 isLoading 當守門條件，因為
 * trpc.factory.search.useQuery 的 placeholderData:(prev)=>prev 導致切換
 * 搜尋條件時記到「上一筆」查詢的 resultCount；改用 isFetching 當守門條件後
 * 仍在正式站觀察到同樣的錯誤，且在三種本機環境（dev server、dev
 * server+人工延遲、正式 production bundle+人工延遲）都無法重現，代表問題
 * 不是單純「猜對 react-query 時序訊號」能結構性解決的。
 *
 * 最終方案（方案 A）：不再相信任何 react-query 內部時序訊號當「最終」正確性
 * 判斷依據——改成比對 server 回應自帶的 searchFingerprint（見
 * shared/searchFingerprint.ts）跟目前畫面上搜尋條件算出的 fingerprint 是否
 * 完全相等。isFetching／data 仍然保留當作「早退」的輔助 guard（避免在明顯
 * 還沒有資料時做多餘運算），但 fingerprint 相等與否才是「這筆 resultCount
 * 到底能不能用」的最終權威——不管 react-query 內部這一輪 render 的
 * isFetching／isPlaceholderData／dataUpdatedAt 呈現什麼狀態，只要 response
 * 自己宣告的身分跟目前查詢對不上，就一律不記錄。
 */
export interface SearchTrackDecisionInput {
  /** react-query 目前這次 render 的 isFetching——只當輔助早退用，不是最終權威。 */
  isFetching: boolean;
  /** react-query 目前這次 render 的 data（placeholderData 生效時可能是舊資料）。 */
  data: { searchFingerprint?: string; total?: number; items?: unknown[] } | undefined;
  /** 目前畫面上搜尋條件算出的 canonical fingerprint（見 buildSearchFingerprint）。 */
  currentFingerprint: string;
}

export interface SearchTrackDecisionState {
  /** 上一次真正送出 analytics event 時的 fingerprint，null 代表還沒送過。 */
  lastTrackedFingerprint: string | null;
}

export interface SearchTrackDecision {
  shouldRecord: boolean;
  resultCount: number;
  /** 純粹方便測試／debug 觀察是在哪一關被擋下來的，不影響行為。 */
  skipReason?: "fetching-or-no-data" | "fingerprint-mismatch" | "already-tracked";
}

/**
 * 純函式版本的判斷：要不要送這筆 search event、resultCount 該用多少。
 * 不會自己 mutate 任何狀態——呼叫端（Search.tsx 的 useEffect，或測試）自己
 * 決定何時把 `state.lastTrackedFingerprint` 更新成回傳時用的 fingerprint。
 */
export function decideSearchTrack(
  input: SearchTrackDecisionInput,
  state: SearchTrackDecisionState,
): SearchTrackDecision {
  // 輔助早退：react-query 明確表示還在抓、或根本沒有 data，不用往下比對。
  if (input.isFetching || !input.data) {
    return { shouldRecord: false, resultCount: 0, skipReason: "fetching-or-no-data" };
  }
  // 最終權威：response 自己宣告的 fingerprint 必須跟目前畫面上的搜尋條件完全
  // 相等，才能相信 data.total 屬於「目前這次查詢」——不管 isFetching／
  // isPlaceholderData／dataUpdatedAt 在這個 render 呈現什麼狀態。
  if (input.data.searchFingerprint !== input.currentFingerprint) {
    return { shouldRecord: false, resultCount: 0, skipReason: "fingerprint-mismatch" };
  }
  // 去重：同一個 fingerprint（同一次搜尋）不管 rerender 幾次、refetch 幾次，
  // 只記一次。fingerprint 改變（換關鍵字／換篩選條件，甚至「返回」先前搜過
  // 的條件）都會被視為新的一次搜尋——不做全域永久 dedupe，沿用既有「只記住
  // 上一次」的產品定義。
  if (state.lastTrackedFingerprint === input.currentFingerprint) {
    return { shouldRecord: false, resultCount: 0, skipReason: "already-tracked" };
  }
  const resultCount = input.data.total ?? input.data.items?.length ?? 0;
  return { shouldRecord: true, resultCount };
}
