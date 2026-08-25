/**
 * Chat（/chat/new、/chat/:conversationId）的返回來源驗證——獨立於
 * OrderDetail.tsx 既有的 parseSafeBackTo（該函式驗證 query string 裡的
 * backTo，這裡驗證的是 history.state.from，語意相近但來源與消費端不同，
 * 因此各自獨立、不合併，避免其中一份未來調整時誤動到另一個功能）。
 *
 * 規則：
 * - 必須是字串、必須是站內相對路徑（"/" 開頭）。
 * - 不得是 "//..."（protocol-relative，可能導到站外）或包含 "://"（絕對網址）。
 * - 不得是 /chat、/chat/new、/chat/:id 這類 chat 路由本身——否則會形成
 *   Chat A → Chat B → Chat A 的自我循環，這正是這次要修掉的問題。
 *
 * 只做「值不值得信任」的判斷，不在這裡呼叫 navigate／history.back()——
 * 呼叫端（ChatPage.tsx）決定信任後要怎麼用。
 */
export function isSafeChatReturnSource(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false;
  if (raw.includes("://")) return false;
  if (/^\/chat(\/|$|\?)/.test(raw)) return false;
  return true;
}
