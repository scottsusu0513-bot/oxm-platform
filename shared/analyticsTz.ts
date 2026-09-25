/**
 * Analytics 2.0 時區與日期邊界工具（純函式，client／server 共用）。
 *
 * 背景：上一輪 audit 發現直接把 JS `Date` 物件傳給 mysql2 的 SQL 參數綁定
 * 會用「執行程式的機器本地時區」序列化，不是 UTC——如果那台機器剛好在
 * Asia/Taipei（UTC+8），會對一個本身已經是 UTC 的 TIMESTAMP 欄位重複疊加
 * 8 小時偏移，查到完全錯誤的時段。這裡的規則：
 *   1. 所有「跟 DB 比較」的時間一律先在這裡轉成明確的 UTC ISO 字串／
 *      `YYYY-MM-DD HH:MM:SS` 字面值，呼叫端組 SQL 時直接內嵌字串，不要傳
 *      JS `Date` 物件給 drizzle 的 sql`` 參數。
 *   2. 「date」「hour」永遠代表 Asia/Taipei 當地時間，用 epoch ms 位移運算
 *      （不呼叫任何依賴 process TZ 設定的 `Date` 方法），確保不管執行環境
 *      本身在哪個時區，結果都一致。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Analytics 2.0 正式起算日（產品規格，見對話中「新舊資料切割」）。
 *  2026-09-24 以前的舊 pageViews 沒有 pathname／referrer／UA／session／bot
 *  等資料，不能拿來冒充完整 Analytics 2.0——這個常數是唯一 source of truth，
 *  前端 date picker 與後端 API 都必須引用這裡，不要各自硬編一份。 */
export const ANALYTICS_MIN_DATE = "2026-09-25";

/** 給定一個 UTC epoch ms，回傳對應的 Asia/Taipei 日期字串 YYYY-MM-DD。 */
export function taipeiDateStr(epochMs: number): string {
  return new Date(epochMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 給定一個 UTC epoch ms，回傳對應的 Asia/Taipei 小時（0-23）。 */
export function taipeiHour(epochMs: number): number {
  return new Date(epochMs + TAIPEI_OFFSET_MS).getUTCHours();
}

/** 目前這一刻的 Asia/Taipei 日期字串。 */
export function taipeiTodayStr(now: number = Date.now()): string {
  return taipeiDateStr(now);
}

/** date 字串（YYYY-MM-DD，代表 Asia/Taipei 當地日期）加減天數，純字串／
 *  epoch 運算，不依賴 process TZ。 */
export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  // 用中午 12:00 當基準點做加減，避免 DST 或邊界誤差（雖然 Asia/Taipei
  // 沒有 DST，這裡仍採保守寫法）——用該日 Asia/Taipei 00:00 對應的 UTC
  // epoch 往前推。
  const utcMidnight = Date.parse(`${dateStr}T00:00:00.000Z`) - TAIPEI_OFFSET_MS;
  const shifted = utcMidnight + deltaDays * 24 * 60 * 60 * 1000;
  return taipeiDateStr(shifted + TAIPEI_OFFSET_MS);
}

/** 一個 Asia/Taipei 日期字串（YYYY-MM-DD）對應的「當地 00:00:00」UTC
 *  datetime 字面值（`YYYY-MM-DD HH:MM:SS`，MySQL DATETIME/TIMESTAMP 比較
 *  用），可直接內嵌進 SQL。 */
export function taipeiDateStartUtcLiteral(dateStr: string): string {
  const utcMs = Date.parse(`${dateStr}T00:00:00.000Z`) - TAIPEI_OFFSET_MS;
  return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
}

/** 同上，回傳「當地 23:59:59」對應的 UTC datetime 字面值（含端點）。 */
export function taipeiDateEndUtcLiteral(dateStr: string): string {
  const utcMs = Date.parse(`${dateStr}T23:59:59.000Z`) - TAIPEI_OFFSET_MS;
  return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
}

/** 是否為合法、且落在 Analytics 2.0 可查詢範圍內的日期字串
 *  （ANALYTICS_MIN_DATE ≤ date ≤ 今天 Asia/Taipei，含兩端）。 */
export function isAnalyticsDateAllowed(dateStr: string, now: number = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = taipeiTodayStr(now);
  return dateStr >= ANALYTICS_MIN_DATE && dateStr <= today;
}

/** 把一段 [start, end] 日期範圍 clamp 到 Analytics 2.0 合法範圍內
 *  （ANALYTICS_MIN_DATE ~ 今天）。回傳 clamp 後的範圍，以及是否真的被
 *  clamp 過（呼叫端可以用這個旗標在 UI 誠實顯示「實際查詢範圍」，不要
 *  偷偷把不存在的日期當 0——見對話中「不可偷偷把不存在日期當 0」）。 */
export function clampAnalyticsDateRange(
  startDateStr: string,
  endDateStr: string,
  now: number = Date.now(),
): { start: string; end: string; wasClamped: boolean } {
  const today = taipeiTodayStr(now);
  // end 先夾在 [MIN_DATE, today] 之間——即使原本的 end 早於 MIN_DATE（例如
  // 整段請求範圍都落在上線前），end 也不能低於 MIN_DATE，否則下一步用
  // clampedEnd 夾 start 時會把 start 錯誤地拉回不合法的日期（這是本輪
  // 測試抓到的真實 bug：原本寫法讓 [09-18, 09-24] clamp 成 [09-24, 09-24]，
  // 而不是正確的 [MIN_DATE, MIN_DATE]）。
  let clampedEnd = endDateStr > today ? today : endDateStr;
  if (clampedEnd < ANALYTICS_MIN_DATE) clampedEnd = ANALYTICS_MIN_DATE;
  let clampedStart = startDateStr < ANALYTICS_MIN_DATE ? ANALYTICS_MIN_DATE : startDateStr;
  if (clampedStart > clampedEnd) clampedStart = clampedEnd;
  return {
    start: clampedStart,
    end: clampedEnd,
    wasClamped: clampedStart !== startDateStr || clampedEnd !== endDateStr,
  };
}
