/**
 * Search.tsx 的「一次真正的搜尋只記一筆 analytics search event」判斷邏輯
 * （見對話「Search Analytics」／正式站 smoke test 發現的 resultCount bug）。
 * 抽成純函式方便獨立測試，不需要真的掛載整個 Search 頁面元件。
 *
 * 根因：trpc.factory.search.useQuery 設了 placeholderData:(prev)=>prev，
 * 切換搜尋條件（searchKey 改變）的當下，react-query 的 isLoading 仍是
 * false、data 也會先暫時沿用「上一次」查詢的結果物件（含上一次的
 * resultCount），只有 isFetching 能正確反映「目前這個 searchKey 對應的
 * 結果是否真的回來了」——所以這裡一律用 isFetching 當守門條件，不能用
 * isLoading。
 */
export interface SearchTrackDecisionInput {
  /** react-query 目前這次 render 的 isFetching（不是 isLoading）。 */
  isFetching: boolean;
  /** react-query 目前這次 render 的 data（placeholderData 生效時可能是舊資料）。 */
  data: { total?: number; items?: unknown[] } | undefined;
  /** 不含 page 的搜尋條件組合鍵（同一組條件只能記一次事件）。 */
  searchKey: string;
}

export interface SearchTrackDecisionState {
  /** 上一次真正送出 analytics event 時的 searchKey，null 代表還沒送過。 */
  lastTrackedSearchKey: string | null;
}

export interface SearchTrackDecision {
  shouldRecord: boolean;
  resultCount: number;
}

/**
 * 純函式版本的判斷：要不要送這筆 search event、resultCount 該用多少。
 * 不會自己 mutate 任何狀態——呼叫端（Search.tsx 的 useEffect，或測試）自己
 * 決定何時把 `state.lastTrackedSearchKey` 更新成回傳的 searchKey。
 */
export function decideSearchTrack(
  input: SearchTrackDecisionInput,
  state: SearchTrackDecisionState,
): SearchTrackDecision {
  if (input.isFetching || !input.data) {
    return { shouldRecord: false, resultCount: 0 };
  }
  if (state.lastTrackedSearchKey === input.searchKey) {
    return { shouldRecord: false, resultCount: 0 };
  }
  const resultCount = input.data.total ?? input.data.items?.length ?? 0;
  return { shouldRecord: true, resultCount };
}
