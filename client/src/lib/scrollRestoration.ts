/**
 * 「新頁面偶發先看到 Footer、最後卡在頁尾」bug 的核心決策邏輯。
 *
 * Root cause（見對話「BUG 2」Audit）：App.tsx 從來沒有任何全域的
 * pathname-change scroll 管理——SPA 用 history.pushState 導航不像整頁重新
 * 載入會自動把 scrollY 歸零，使用者從某頁滑到很下面再點連結進新頁時，會
 * 直接沿用舊的 scrollY。新頁在 Suspense resolve／自己的資料還沒載入完成前
 * 高度通常還很矮，這個沿用下來的 scrollY 常常已經超過新頁當下的可捲動範圍，
 * 瀏覽器會把它 clamp 到目前文件底部——也就是直接看到 Footer；資料載入完成、
 * 頁面變高之後，scrollY 本身仍然沒有被重置，使用者因此停在頁面中後段甚至
 * Footer 附近，不是從新頁最上方開始看。
 *
 * 這不是「補一層 window.scrollTo(0,0) 掛在每次 pathname 變化上」就能安全解決
 * 的問題：本站已經有明確依賴瀏覽器原生 popstate scroll restoration 的既有
 * UX（搜尋結果→工廠頁→瀏覽器返回鍵回搜尋結果、Chat／詳細頁返回等），這些
 * 全部是純瀏覽器原生行為（見 FactoryDetail.tsx 已經手動處理過同一個症狀但
 * 只鎖定它自己這個頁面的 factoryId 變化，不是全站規則），如果無條件把每次
 * pathname 變化都導向捲頂，會直接蓋掉瀏覽器對 popstate（返回／前進）導航
 * 已經在做的 scroll restoration。
 *
 * 這裡把「新頁面 vs 返回／前進頁面」這個判斷抽成純函式：
 * - isPopStateNavigation：這次 pathname 變化是不是由瀏覽器原生
 *   popstate 事件（使用者按上一頁／下一頁，或程式呼叫
 *   history.back()/forward()）觸發——這是唯一可靠分辨「新導航」與
 *   「返回／前進導航」的 source of truth，不是猜測或用 sessionStorage
 *   記錄的路徑順序（那個順序判斷不出「原地重新整理」與「真的按了上一頁」
 *   的差異，也容易被平行的多分頁操作弄亂）。
 * - previousPathname / nextPathname 相同：pathname 沒有真的改變（例如同頁
 *   內只是 query string／hash 或其他不影響「有沒有換頁」的變化），不需要
 *   捲頂，避免打斷使用者在同一頁面裡的操作。
 *
 * 呼叫端（見 App.tsx 的 ScrollRestorationManager）只需要：popstate 事件本身
 * 觸發時記一個 ref flag，pathname 變化的 effect 裡讀這個 flag 呼叫這支函式
 * 決定要不要 window.scrollTo(0, 0)，決定完之後把 flag 重置——這支函式本身
 * 不碰任何 DOM／window，可以直接用一般的 deterministic 單元測試涵蓋，不需要
 * jsdom。
 *
 * ── 後續兩個延伸（見對話「首頁公告定位」與「主動回首頁必須置頂」）──
 *
 * 1. explicit-target navigation：某些導航本身帶著「使用者明確要看的目標」
 *    （例如首頁公告卡片帶 ?highlight=<id> 導到 /announcements，由該頁自己的
 *    scrollIntoView 定位到指定公告）。這種情況下 ScrollRestorationManager
 *    不能搶先把畫面捲頂——不是因為要保留舊頁面的位置，而是這次導航的「正確
 *    最終位置」根本不是頁首，交給目標頁自己的定位邏輯決定，這裡只需要
 *    「不要插手」。判斷方式沿用這個專案已經在用的實際慣例（不是另外發明一套
 *    規則）：URL 帶 hash，或 query string 帶 `highlight` 參數（見
 *    Announcements.tsx／LoginPopupModal.tsx 既有的 `?highlight=<id>` 用法）。
 *
 * 2. home-navigation intent：使用者「主動點擊」App 內建的首頁入口（手機
 *    APP 底部導覽首頁、Navbar 品牌下拉選單的首頁項目）時，不論目前處於什麼
 *    pathname／捲動狀態，都必須強制捲頂——即使一般規則已經會在「換頁」時
 *    捲頂，這裡仍額外標記一個明確意圖，做為對抗「其他無關程式碼意外把
 *    scrollY 蓋回舊值」的第二層保障（實際案例：Navbar.tsx 手機選單背景
 *    scroll lock 在選單開著時被拿來導頁，會在導頁完成後才 restore 舊
 *    scrollY，蓋掉這裡原本已經做對的捲頂——那個 race 已經在 Navbar.tsx
 *    自己修掉，這裡的 home-intent 是額外一層、不依賴其他檔案有沒有修對）。
 *    這個意圖必須只由「使用者主動點擊首頁入口」的呼叫端設置（透過 wouter
 *    navigate/Link 的 `state` 帶 HOME_NAV_INTENT_STATE），絕對不能跟瀏覽器
 *    popstate 混淆：popstate 還原到首頁這筆 history entry 時，
 *    `history.state` 很可能剛好也是同一個物件（因為就是當初 push 進去的
 *    state），所以判斷順序上 isPopStateNavigation 必須永遠比
 *    isHomeNavigationIntent 優先檢查。
 */
export type ScrollNavigationAction = "reset-to-top" | "preserve";

export interface ScrollNavigationDecisionInput {
  /** 上一次記錄到的 pathname；第一次掛載時傳 null。 */
  previousPathname: string | null;
  /** 這次要導航到的 pathname。 */
  nextPathname: string;
  /** 這次 pathname 變化是否由瀏覽器原生 popstate（上一頁／下一頁）觸發。 */
  isPopStateNavigation: boolean;
  /**
   * 是否為這個 scroll 管理機制掛載後的第一次判斷（App 剛啟動／使用者重新
   * 整理頁面）。這個時間點必須維持瀏覽器原生的 reload scroll restoration
   * 行為（reload 時使用者停在原本捲動位置也是合理、既有的瀏覽器行為，不是
   * 這次要修的 bug），不能被這裡強制捲頂。
   */
  isInitialMount: boolean;
  /**
   * 這次導航是否帶著明確的目標定位（hash／`?highlight=<id>` 等），最終捲動
   * 位置交給目標頁自己的邏輯決定，manager 本身不強制捲頂也不做其他事。
   * 選填，預設 false（維持既有呼叫端不受影響）。
   */
  hasExplicitTarget?: boolean;
  /**
   * 這次導航是否為使用者主動點擊 App 內建首頁入口所觸發（見上方說明）。
   * 優先權低於 isPopStateNavigation、高於其餘規則（包含 hasExplicitTarget
   * 與 same-pathname）。選填，預設 false。
   */
  isHomeNavigationIntent?: boolean;
}

export function decideScrollNavigationAction(
  input: ScrollNavigationDecisionInput,
): ScrollNavigationAction {
  const {
    previousPathname,
    nextPathname,
    isPopStateNavigation,
    isInitialMount,
    hasExplicitTarget = false,
    isHomeNavigationIntent = false,
  } = input;
  if (isInitialMount) return "preserve";
  if (isPopStateNavigation) return "preserve";
  if (isHomeNavigationIntent) return "reset-to-top";
  if (hasExplicitTarget) return "preserve";
  if (previousPathname === nextPathname) return "preserve";
  return "reset-to-top";
}

/** 導到首頁的 wouter navigate/Link `state`：標記「這是使用者主動點的首頁入口」。 */
export const HOME_NAV_INTENT_STATE = { navIntent: "home" } as const;

/** 純函式：`history.state` 是否帶有上面這個「主動回首頁」標記。 */
export function isHomeNavigationIntentState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { navIntent?: unknown }).navIntent === "home"
  );
}

/**
 * 純函式：這次導航的 URL 是否帶有明確的定位目標（hash 錨點，或本站慣例的
 * `?highlight=<id>` query 參數——見 Announcements.tsx／LoginPopupModal.tsx）。
 * 只依賴傳入的字串，不直接讀 window，方便測試。
 */
export function hasExplicitScrollTarget(search: string, hash: string): boolean {
  if (hash !== "") return true;
  return new URLSearchParams(search).has("highlight");
}
