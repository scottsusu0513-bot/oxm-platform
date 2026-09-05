/**
 * 首頁「平台公告」點擊定位回歸測試，以及「主動回首頁必須置頂」回歸測試。
 *
 * 背景：首頁公告卡片的 onClick 原本一律 navigate("/announcements")，完全
 * 沒有帶使用者點的是哪一則，導致無論點哪則公告都進到同一個列表頁、且畫面
 * 停在使用者上次離開列表頁的位置，不是使用者剛剛點的那一則。/announcements
 * 本身其實已經有「用 ?highlight=<id> 定位到指定公告」的能力（見
 * client/src/components/LoginPopupModal.tsx 既有的同一種用法），問題只出在
 * 首頁沒有使用它——因此這裡不新建第二套 announcements routing model，只把
 * 首頁卡片改成沿用既有的 `?highlight=<id>` 慣例。
 *
 * 「主動回首頁」的部分：使用者點 App 內建的首頁入口（手機 APP 底部導覽、
 * Navbar 品牌下拉選單）有時會落在首頁上次離開的捲動位置，根因是
 * Navbar.tsx 手機主選單背景 scroll lock 的 cleanup 在選單開著時被拿去導頁
 * 時，會在導頁完成後才觸發、無條件把 scrollY 還原成「選單開啟當下」在舊
 * 頁面的位置，蓋掉 ScrollRestorationManager 已經做對的捲頂。修法是讓那個
 * cleanup 只在「關閉當下 pathname 跟開啟當下相同」時才還原 scrollY；另外
 * 在 ScrollRestorationManager 加上一個獨立的 home-navigation intent 判斷
 * 作為第二層保障，兩個首頁入口都要在 navigate/Link 帶上共用的
 * HOME_NAV_INTENT_STATE（見 client/src/lib/scrollRestoration.ts），不是
 * 各自散落 window.scrollTo(0, 0)。
 *
 * 本檔案沿用專案既有慣例（見 server/factoryDetailScrollReset.test.ts、
 * server/erpOptimizationNoPublicEntry.test.ts）：純原始碼內容斷言，不需要
 * jsdom／React Testing Library。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("Home.tsx: 每則平台公告卡片都帶正確的唯一識別導向 /announcements", () => {
  const source = readSource("client", "src", "pages", "Home.tsx");

  it("公告卡片本身的 onClick 用 ?highlight=${item.id} 導向，不是不帶識別的裸網址", () => {
    expect(source).toMatch(/onClick=\{\(\) => navigate\(`\/announcements\?highlight=\$\{item\.id\}`\)\}/);
  });

  it("「查看全部」入口仍然導向不帶 highlight 的 /announcements（列表本身，不是特定一則）", () => {
    const sectionMatch = source.match(/function AnnouncementsSection[\s\S]*?\n\}/);
    expect(sectionMatch, "找不到 AnnouncementsSection 元件").not.toBeNull();
    expect(sectionMatch![0]).toMatch(/查看全部[\s\S]*?<\/button>/);
    const viewAllMatch = sectionMatch![0].match(/onClick=\{\(\) => navigate\("\/announcements"\)\}[\s\S]*?查看全部/);
    expect(viewAllMatch, "找不到「查看全部」按鈕導向裸 /announcements 的 onClick").not.toBeNull();
  });
});

describe("Announcements.tsx: 既有的 ?highlight=<id> 定位能力（首頁沿用，不新建第二套架構）", () => {
  const source = readSource("client", "src", "pages", "Announcements.tsx");

  it("從 URL query string 讀取 highlight 這個唯一識別", () => {
    expect(source).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("highlight"\)/);
  });

  it("每張公告卡片都有以 item.id 為準的 DOM anchor id，供 scrollIntoView 定位", () => {
    expect(source).toMatch(/id=\{`announcement-\$\{item\.id\}`\}/);
    expect(source).toMatch(/document\.getElementById\(`announcement-\$\{highlightId\}`\)/);
  });

  it("定位動作等到公告資料載入完成（items.length > 0）才執行，不會在資料到位前就對著空列表撲空", () => {
    const effectMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[highlightId, items\.length\]\);/);
    expect(effectMatch, "找不到以 [highlightId, items.length] 為依賴的定位 useEffect").not.toBeNull();
    expect(effectMatch![0]).toMatch(/if \(!highlightId \|\| items\.length === 0\) return;/);
  });

  it("scrollIntoView 不使用 behavior: \"smooth\"——實測發現帶動畫的 smooth 捲動在部分瀏覽器情境下會整個不執行，導致完全沒有捲到目標公告；直接跳過去才能保證每次都精準落在正確位置", () => {
    const effectMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[highlightId, items\.length\]\);/);
    expect(effectMatch).not.toBeNull();
    // 只鎖定實際的呼叫那一行本身（不是整個 effect，包含說明用的註解在內，
    // 註解裡本來就會提到 "smooth" 這個字面詞來解釋為什麼不用它）。
    const callLineMatch = effectMatch![0].match(/el\?\.scrollIntoView\([^)]*\);/);
    expect(callLineMatch, "找不到 scrollIntoView 呼叫本身").not.toBeNull();
    expect(callLineMatch![0]).toBe('el?.scrollIntoView({ block: "center" });');
  });
});

describe("首頁入口強制捲頂：AppBottomNav／Navbar 都帶 HOME_NAV_INTENT_STATE，不各自散落 window.scrollTo", () => {
  it("AppBottomNav.tsx 的「首頁」tab 用 navigate(\"/\", { state: HOME_NAV_INTENT_STATE }) 導航", () => {
    const source = readSource("client", "src", "components", "AppBottomNav.tsx");
    expect(source).toMatch(/import \{ HOME_NAV_INTENT_STATE \} from "@\/lib\/scrollRestoration"/);
    expect(source).toMatch(/onClick: \(\) => navigate\("\/", \{ state: HOME_NAV_INTENT_STATE \}\)/);
    // 不應該散落一個獨立的 window.scrollTo 來土法煉鋼做同一件事。
    expect(source).not.toMatch(/window\.scrollTo/);
  });

  it("Navbar.tsx 品牌下拉選單的「首頁」連結帶 state={HOME_NAV_INTENT_STATE}", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).toMatch(/import \{ HOME_NAV_INTENT_STATE \} from "@\/lib\/scrollRestoration"/);
    expect(source).toMatch(/<Link href="\/" state=\{HOME_NAV_INTENT_STATE\} onClick=\{\(\) => setBrandMenuOpen\(false\)\}>/);
  });

  it("Navbar.tsx 手機選單背景 scroll lock 的 cleanup 只在關閉當下 pathname 跟開啟當下相同時才還原 scrollY（不會在選單開著時被拿去導頁後，還把新頁面蓋回舊 scrollY）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).toMatch(/const openedAtPathname = window\.location\.pathname;/);
    const cleanupMatch = source.match(/return \(\) => \{\s*\n\s*body\.style\.position[\s\S]*?\n\s*\};\s*\n\s*\}, \[mobileOpen, mobileMenuLockSuppressed\]\);/);
    expect(cleanupMatch, "找不到手機選單 scroll lock 的 cleanup 區塊").not.toBeNull();
    expect(cleanupMatch![0]).toMatch(/if \(window\.location\.pathname === openedAtPathname\) \{\s*\n\s*window\.scrollTo\(0, scrollY\);\s*\n\s*\}/);
  });
});

describe("App.tsx: ScrollRestorationManager 已接上 explicit-target 與 home-navigation intent 判斷", () => {
  const source = readSource("client", "src", "App.tsx");

  it("import 了 hasExplicitScrollTarget 與 isHomeNavigationIntentState", () => {
    expect(source).toMatch(/import \{ decideScrollNavigationAction, hasExplicitScrollTarget, isHomeNavigationIntentState \} from "@\/lib\/scrollRestoration";/);
  });

  it("decideScrollNavigationAction 呼叫時有傳入 hasExplicitTarget 與 isHomeNavigationIntent", () => {
    const managerMatch = source.match(/function ScrollRestorationManager\(\)[\s\S]*?\n\}/);
    expect(managerMatch, "找不到 ScrollRestorationManager 元件").not.toBeNull();
    expect(managerMatch![0]).toMatch(/hasExplicitTarget: hasExplicitScrollTarget\(window\.location\.search, window\.location\.hash\),/);
    expect(managerMatch![0]).toMatch(/isHomeNavigationIntent: isHomeNavigationIntentState\(window\.history\.state\),/);
  });
});
