/**
 * Community 貼文詳情（CommunityPost.tsx）返回來源驗證——比照
 * client/src/lib/chatReturnSource.ts 的作法，但驗證規則與消費端都是
 * Community 專屬，獨立維護（語意相近但用途不同，不合併，避免其中一份未來
 * 調整時誤動到另一個功能）。
 *
 * 規則：
 * - 必須是字串、必須是站內相對路徑（"/" 開頭）。
 * - 不得是 "//..."（protocol-relative，可能導到站外）或包含 "://"（絕對網址）。
 * - 必須是 Community 討論區／競標區列表路由本身
 *   （/community/:spaceCode/discussions 或 /community/:spaceCode/bids，
 *   可帶 query string）——這裡唯一合法的來源就是「使用者從哪個列表點進這篇
 *   貼文」，不接受任意站內路徑，避免「返回討論區」被誤用成從其他無關頁面
 *   進來也能觸發、造成非預期跳轉（比 isSafeChatReturnSource 更嚴格，因為
 *   這裡的合法來源集合本來就很小、很明確）。
 *
 * 只做「值不值得信任」的判斷，不在這裡呼叫 navigate／history.back()——
 * 呼叫端（CommunityPost.tsx）決定信任後要怎麼用。
 */
export function isSafeCommunityReturnSource(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false;
  if (raw.includes("://")) return false;
  return /^\/community\/[^/]+\/(discussions|bids)(\?.*)?$/.test(raw);
}
