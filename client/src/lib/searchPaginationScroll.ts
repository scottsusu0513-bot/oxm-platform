/**
 * 搜尋結果頁「主動換頁後捲到搜尋結果頂端」的純決策邏輯（見對話「搜尋結果頁
 * 分頁捲動 UX」）。
 *
 * 只有使用者主動點桌機分頁按鈕（上一頁／下一頁）時，Search.tsx 才會記下一筆
 * PendingPageScroll；瀏覽器返回／前進、filter／keyword／sortBy 變更都不會
 * 產生 pending，所以永遠不會觸發這個捲動（page 本身也不在 URL 裡）。
 *
 * 「新頁資料已成為畫面要呈現的結果」判斷：
 *   - page 仍是點擊時要去的那一頁（快速連點時只認最後一次點擊）；
 *   - response 的 searchFingerprint 仍等於點擊當下的搜尋條件 fingerprint，
 *     且等於目前畫面條件（中途改了 filter 就放棄，不會捲到錯的搜尋）；
 *   - react-query 的 isPlaceholderData 為 false——fingerprint 刻意不涵蓋
 *     page（見 shared/searchFingerprint.ts），所以「是不是這一頁」由
 *     placeholderData 是否已被該 page key 的真實資料取代來判斷；快取命中時
 *     會直接是 false，一樣會正確捲動。
 */
export interface PendingPageScroll {
  page: number;
  fingerprint: string;
}

export function shouldScrollToResultsTop(args: {
  pending: PendingPageScroll | null;
  page: number;
  currentFingerprint: string;
  dataFingerprint: string | undefined;
  isPlaceholderData: boolean;
}): boolean {
  const { pending, page, currentFingerprint, dataFingerprint, isPlaceholderData } = args;
  if (!pending) return false;
  if (pending.page !== page) return false;
  if (pending.fingerprint !== currentFingerprint) return false;
  if (dataFingerprint !== currentFingerprint) return false;
  return !isPlaceholderData;
}

/**
 * 目標捲動位置：讓結果區塊頂端剛好貼在 sticky header 下緣（header 高度由呼叫端
 * 實際量測 DOM 取得，含 safe-area inset，不寫死數字），再留 gap 的呼吸空間。
 */
export function computeResultsScrollTop(args: {
  elementTop: number;
  scrollY: number;
  headerBottom: number;
  gap: number;
}): number {
  return Math.max(0, Math.round(args.elementTop + args.scrollY - args.headerBottom - args.gap));
}
