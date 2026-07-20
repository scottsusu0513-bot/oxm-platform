import { NEWS_NEW_WINDOW_MS } from "@shared/const";

// 找消息 NEW 徽章的訪客已讀狀態：登入會員的已讀寫進 newsReads 資料表（見
// server/db.ts markNewsAsRead），訪客沒有 session，只能存在瀏覽器
// localStorage。
//
// 每筆紀錄存的是 expiresAt（= firstPublishedAt + NEWS_NEW_WINDOW_MS），不是
// readAt——NEW 的有效期限從消息「第一次發布」算起，不是從「使用者讀了它」
// 算起；如果改存 readAt 再加 168 小時，會讓已經快過期（甚至已過期）的消息
// 因為被讀過，反而在 localStorage 裡多活 168 小時，變成用已讀狀態延長 NEW
// 視窗，跟後端 getNewCategorySummary／markNewsAsRead 的判斷基準不一致。
const KEY = "oxm_news_read_ids";
const VERSION = 1;

interface ReadEntry {
  newsId: number;
  /** ISO 字串；= firstPublishedAt + NEWS_NEW_WINDOW_MS，不是 readAt + 168 小時。 */
  expiresAt: string;
}

interface ReadStore {
  version: number;
  items: ReadEntry[];
}

const EMPTY_STORE: ReadStore = { version: VERSION, items: [] };

/** 探測 localStorage 是否真的可用——隱私模式、quota 已滿、瀏覽器政策封鎖時，
 * 連 getItem／setItem 都可能拋 SecurityError，不能假設只有 setItem 會失敗。 */
function getStorage(): Storage | null {
  try {
    const probeKey = "__oxm_ls_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 讀取並清除過期紀錄（expiresAt <= now）；JSON 損毀或格式不符（含舊版純陣列
 * 格式）一律安全重設成空清單，不拋錯、不讓頁面白屏。 */
function readStore(): ReadStore {
  const storage = getStorage();
  if (!storage) return EMPTY_STORE;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
      // 不只是這次讀取當作空清單處理，連損毀的原始字串本身也一併覆寫掉，
      // 避免每次讀取都要重新 try/catch 解析同一包壞掉的 JSON。
      writeStore(EMPTY_STORE);
      return EMPTY_STORE;
    }
    const now = Date.now();
    const seen = new Set<number>();
    const fresh: ReadEntry[] = [];
    for (const e of parsed.items as unknown[]) {
      if (
        !e || typeof e !== "object" ||
        typeof (e as ReadEntry).newsId !== "number" ||
        typeof (e as ReadEntry).expiresAt !== "string"
      ) continue;
      const entry = e as ReadEntry;
      const expiresAtMs = new Date(entry.expiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || expiresAtMs <= now) continue; // 過期或格式壞掉：丟棄
      if (seen.has(entry.newsId)) continue; // 同一 newsId 只保留一筆
      seen.add(entry.newsId);
      fresh.push(entry);
    }
    if (fresh.length !== (parsed.items as unknown[]).length) {
      writeStore({ version: VERSION, items: fresh });
    }
    return { version: VERSION, items: fresh };
  } catch {
    // JSON.parse 本身丟出例外（不是合法 JSON）：同樣把壞掉的原始字串覆寫掉，
    // 不留著讓下一次讀取又要重新 try/catch 一次。
    writeStore(EMPTY_STORE);
    return EMPTY_STORE;
  }
}

function writeStore(store: ReadStore): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(store));
  } catch {
    // quota 爆滿／SecurityError：安靜放棄，NEW 徽章頂多多顯示一次，不影響核心功能。
  }
}

/** 目前分類彙總查詢要排除的 newsId 清單（訪客專用，登入會員改由後端查表）。 */
export function getGuestReadIds(): number[] {
  return readStore().items.map(e => e.newsId);
}

export function isGuestNewsRead(newsId: number): boolean {
  return readStore().items.some(e => e.newsId === newsId);
}

/**
 * 標記一篇消息為訪客已讀。firstPublishedAt 由呼叫端傳入（來自 news.getBySlug
 * 回傳的 item.firstPublishedAt），用來算出這篇消息真正的 NEW 到期時間；如果
 * 傳入時已經超過視窗（消息本來就已經滿 168 小時），就不寫入，跟登入會員
 * markNewsAsRead 的資格判斷一致，不留一筆馬上就會被自清掉的紀錄。
 */
export function markGuestNewsRead(newsId: number, firstPublishedAt: string | Date | null): void {
  if (!firstPublishedAt) return;
  const expiresAtMs = new Date(firstPublishedAt).getTime() + NEWS_NEW_WINDOW_MS;
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) return;

  const store = readStore();
  if (store.items.some(e => e.newsId === newsId)) return;
  store.items.push({ newsId, expiresAt: new Date(expiresAtMs).toISOString() });
  writeStore(store);
}
