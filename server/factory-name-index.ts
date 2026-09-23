/**
 * In-memory Factory Name Index（見對話中「in-memory factory name index」，
 * 取代原本 Query Router 每次 request 都對 Railway DB 打一次
 * findStrongFactoryNameMatch 的設計）。
 *
 * 背景：DB preflight 版本雖然能正確判斷公司名稱，但代價是**所有**非自然語言
 * query（包含油封／CNC／金屬加工這種本來就該走 AI-assisted 的主要需求搜尋）
 * 都固定多付一趟 DB round trip——這個 tradeoff 不被接受。這一版改成：
 *   - server process 記憶體裡維護一份所有 approved 工廠的 id／name 清單
 *   - Query Router 判斷 DIRECT 時只在記憶體裡比對，warm cache 下**零** DB
 *     round trip、零額外延遲
 *   - 索引本身是 performance optimization，不是搜尋正確性依賴：DB 暫時失敗
 *     時有舊 cache 就用舊 cache，完全沒有 cache 就安全回傳「沒有命中」，讓
 *     query 照舊 fallback 到 HYBRID／AI-assisted（見「不可造成搜尋不到」）
 */
import { listApprovedFactoryNamesForIndex } from "./db";

export interface FactoryNameIndexEntry {
  id: number;
  name: string;
  normalizedName: string;
}

export interface StrongNameMatch {
  factoryId: number;
  tier: "exact" | "prefix";
}

const TTL_MS = 5 * 60 * 1000; // 5 分鐘
// DB 失敗後的短暫 backoff，避免 DB 持續中斷時每一個進來的 search request
// 都各自再打一次注定失敗的 DB query（見對話中「DB failure fallback」，這是
// 規格沒有明講、但為了不讓 DB 中斷把每個請求都拖慢而額外加的保守設計）。
const FAILURE_BACKOFF_MS = 30 * 1000;

let cache: FactoryNameIndexEntry[] | null = null;
let cacheLoadedAt = 0;
let refreshPromise: Promise<FactoryNameIndexEntry[]> | null = null;
// 追蹤「從未成功載入過、且最近一次嘗試失敗」的時間點——沒有這個的話，cache
// 永遠是 null 時的 backoff（見下方 refresh() 的 stale-cache 分支）完全不會
// 生效，DB 持續中斷時每個進來的 request 都會各自再觸發一次注定失敗的
// query，等於 retry storm。這個變數只在「從未有過任何 cache」的情境下才有
// 意義；一旦成功載入過一次，後續一律用 cacheLoadedAt 的 backoff 機制。
let lastFailureWithNoCacheAt = 0;

/**
 * 保守 normalization：trim、英文轉小寫、連續空白收斂成一個空格。刻意不做
 * 「移除有限公司／股份有限公司」「fuzzy matching」「拼音／繁簡轉換」——這些
 * 都會讓 strong match 變得不保守、可能誤判（見對話中「本輪 strong match 要
 * 保守」）。
 */
export function normalizeFactoryName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadFromDb(): Promise<FactoryNameIndexEntry[]> {
  const rows = await listApprovedFactoryNamesForIndex();
  return rows.map(r => ({ id: r.id, name: r.name, normalizedName: normalizeFactoryName(r.name) }));
}

/**
 * Single-flight refresh：多個同時進來的 request 在 cache 是空的／過期的狀態
 * 下，只會真的打一次 DB，其餘全部 await 同一個 promise（見對話中「避免
 * thundering herd」）。
 */
function refresh(): Promise<FactoryNameIndexEntry[]> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = loadFromDb()
    .then(entries => {
      cache = entries;
      cacheLoadedAt = Date.now();
      return entries;
    })
    .catch(err => {
      console.error("[FactoryNameIndex] refresh failed:", (err as Error).message);
      if (cache) {
        // DB 暫時失敗、但有舊 cache 可用：沿用 stale cache，並把
        // cacheLoadedAt 往前推一個較短的 backoff（不是完整 TTL），避免 DB
        // 持續中斷時每個 request 都各自再打一次必定失敗的 query，同時又不會
        // 讓 stale cache 被當成「跟 TTL 一樣新鮮」太久。
        cacheLoadedAt = Date.now() - TTL_MS + FAILURE_BACKOFF_MS;
        return cache;
      }
      // 完全沒有任何 cache（例如 process 剛啟動、第一次 load 就失敗）：安全
      // 回傳空陣列，讓 query 一律「沒有命中」→ router fallback HYBRID，不
      // throw、不讓搜尋 API 整體失敗（見對話中「不是搜尋 correctness
      // dependency」）。同時記錄失敗時間，讓 getFactoryNameIndex() 在
      // FAILURE_BACKOFF_MS 內不要再觸發下一次注定失敗的 refresh（見上方
      // lastFailureWithNoCacheAt 說明，避免 retry storm）。
      lastFailureWithNoCacheAt = Date.now();
      return [];
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/**
 * 取得目前的 factory name index。warm 且未過期 → 直接回傳記憶體內容，零
 * I/O、零 DB round trip。過期或還沒載入過 → 觸發（或加入既有的）refresh。
 */
export async function getFactoryNameIndex(): Promise<FactoryNameIndexEntry[]> {
  const isFresh = cache !== null && (Date.now() - cacheLoadedAt) < TTL_MS;
  if (isFresh) return cache!;

  // 從未成功載入過、且距離上次失敗還在 backoff 窗口內：不要再觸發一次注定
  // 失敗的 DB query，直接回傳空陣列（等同「沒有命中」，router 照舊 fallback
  // HYBRID）。這跟 refresh() 內 stale-cache 分支的 backoff 是同一個機制在
  // 「從未有過任何 cache」這個情境下的對應版本。
  if (cache === null && refreshPromise === null && (Date.now() - lastFailureWithNoCacheAt) < FAILURE_BACKOFF_MS) {
    return [];
  }

  return refresh();
}

/**
 * 純函式：在一份 index（記憶體陣列）裡做 strong name match，不做任何 I/O，
 * 獨立於 cache 生命週期之外，方便直接餵合成資料做 unit test／benchmark（見
 * 對話中「Matching tests」「Performance」）。
 *
 *   Exact ： normalizedName === normalizedKeyword → 無條件視為 strong match
 *            （不檢查是否有其他 prefix 命中）。
 *   Prefix： 沒有 exact match 時，normalizedName.startsWith(normalizedKeyword)
 *            恰好只有一筆 → strong match；0 筆或多筆（ambiguous）→ null。
 *   只用 startsWith，不用 %contains%（見對話中「科技」不能因為中間包含就
 *   DIRECT 的例子）。
 *
 * 目前是 O(n) linear scan：實測 50 筆 ≈0.75µs、5,000 筆 ≈39µs、50,000 筆
 * ≈428µs（單次呼叫），隨筆數線性變慢，但即使 50,000 筆也還是遠比一次 DB
 * round trip（正式站觀察量級幾十~幾百 ms）快上百倍以上，對目前正式站規模
 * （約 50 間）與可預見的成長完全足夠。如果日後工廠數成長到數萬筆等級、且
 * 這個量級開始有感，可以把 cache 改成依 normalizedName 排序、用 binary
 * search 找 prefix 的上下界（O(log n)），這裡先不做這個升級，避免過度工程。
 */
export function matchAgainstIndex(
  normalizedKeyword: string,
  entries: readonly FactoryNameIndexEntry[],
): StrongNameMatch | null {
  if (!normalizedKeyword) return null;

  let prefixMatch: FactoryNameIndexEntry | null = null;
  let prefixCount = 0;

  for (const entry of entries) {
    if (entry.normalizedName === normalizedKeyword) {
      return { factoryId: entry.id, tier: "exact" };
    }
    if (entry.normalizedName.startsWith(normalizedKeyword)) {
      prefixCount++;
      if (prefixCount === 1) prefixMatch = entry;
    }
  }

  if (prefixCount === 1) return { factoryId: prefixMatch!.id, tier: "prefix" };
  return null; // 0 筆或多筆（ambiguous）
}

/**
 * Query Router 實際呼叫的入口：取得（warm 時是同步等級的）index，再做
 * in-memory 比對。warm cache 下完全沒有 DB round trip。
 */
export async function memoryFactoryNameMatch(rawKeyword: string): Promise<StrongNameMatch | null> {
  const normalizedKeyword = normalizeFactoryName(rawKeyword);
  if (!normalizedKeyword) return null;
  const entries = await getFactoryNameIndex();
  return matchAgainstIndex(normalizedKeyword, entries);
}

// ── 測試用 helper（僅供 *.test.ts 使用，重置 module-level cache 狀態）──────
export function __resetFactoryNameIndexForTests(): void {
  cache = null;
  cacheLoadedAt = 0;
  refreshPromise = null;
  lastFailureWithNoCacheAt = 0;
}

export function __getFactoryNameIndexStateForTests(): { hasCache: boolean; cacheLoadedAt: number; entryCount: number } {
  return { hasCache: cache !== null, cacheLoadedAt, entryCount: cache?.length ?? 0 };
}
