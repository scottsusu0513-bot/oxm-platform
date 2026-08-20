/**
 * Phase 8.1：AI 每日額度以 Asia/Taipei 午夜重置（見對話中「二」），刻意不用
 * server 所在時區或 UTC 日期，避免額度重置時間跟台灣使用者的直覺對不上。
 * 用 Intl.DateTimeFormat 讀 IANA 時區，不手動加減時數（DST 等邊界案例不用
 * 自己處理，且 Node 內建 ICU 一定支援 Asia/Taipei 這種常見時區）。
 */
const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 回傳指定時刻（預設現在）在 Asia/Taipei 時區的 YYYY-MM-DD。 */
export function getTaipeiQuotaDate(at: Date = new Date()): string {
  // en-CA locale 的 formatToParts 保證是 YYYY-MM-DD 順序，不依賴字串重組。
  return TAIPEI_DATE_FORMATTER.format(at);
}
