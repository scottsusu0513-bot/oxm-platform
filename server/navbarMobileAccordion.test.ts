import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 同 server/factoryContactLogin.test.ts 的做法：此專案 vitest 僅涵蓋
// server/**/*.test.ts、environment: "node"，沒有 jsdom／React Testing Library，
// 無法對 Navbar 做真正的 DOM render／互動測試。這裡改用原始碼內容斷言，針對
// 「手機版六入口 Accordion 使用單一 state、一次最多展開一個」這個具體回歸情境
// 做最低限度防護，不新增任何測試相關套件或設定。

const NAVBAR_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "Navbar.tsx"
);

describe("Navbar.tsx: 手機版六入口 Accordion 使用單一 state", () => {
  // 正規化成 LF：Windows checkout 下 fs.readFileSync 讀到的是實際 CRLF 內容，
  // 這裡的字串比對（尤其是 .indexOf 搭配內嵌 "\n" 的寫法）需要固定的換行符號，
  // 不正規化的話同一份測試在 LF／CRLF 兩種 checkout 環境會有不同結果。
  const source = fs.readFileSync(NAVBAR_PATH, "utf-8").replace(/\r\n/g, "\n");

  it("mobileOpenHub 是唯一的 Accordion 展開狀態，不存在六個各自的 boolean state", () => {
    expect(source).toMatch(
      /const \[mobileOpenHub, setMobileOpenHub\] = useState<MobileHubKey \| null>\(null\);/
    );
    // 確保沒有殘留舊版或另外新增的逐項 boolean state（例如 mobileResourceOpen、
    // mobileFactoryOpen 等），避免新舊 state 並存造成不一致。
    expect(source).not.toMatch(/mobileResourceOpen/);
    expect(source).not.toMatch(/\[mobile[A-Z]\w*Open,\s*set/);
  });

  it("切換邏輯符合「點擊同一入口收合、點擊其他入口自動互斥」規則", () => {
    expect(source).toMatch(
      /setMobileOpenHub\(current => \(current === hub\.key \? null : hub\.key\)\)/
    );
  });

  it("六個功能入口都定義了穩定 key，且與 MobileHubKey 一致（關於OXM 已移到品牌下拉選單，不再是 HUB_ITEMS 的一員）", () => {
    const keys = ["factory", "resource", "talent", "brand", "news", "discussion"];
    for (const key of keys) {
      expect(source).toMatch(new RegExp(`key: "${key}"`));
    }
    expect(source).not.toMatch(/key: "about"/);
    expect(source).toMatch(
      /type MobileHubKey = "factory" \| "resource" \| "talent" \| "brand" \| "news" \| "discussion";/
    );
  });

  it("主選單關閉、路由變更、導頁子項都會把 mobileOpenHub 重置為 null", () => {
    const occurrences = source.match(/setMobileOpenHub\(null\)/g) ?? [];
    // 三個必要重置點：mobileOpen 關閉 effect、路由變更 effect、Accordion 子項導頁 onClick
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("未開放子項不使用 <Link>，維持不可導頁的語意區塊", () => {
    const disabledBranchMatch = source.match(
      /aria-disabled="true"\s*\n\s*className="flex items-start gap-2 py-2 px-3 rounded-lg opacity-60 cursor-not-allowed select-none"/
    );
    expect(disabledBranchMatch, "找不到未開放子項的 disabled 區塊").not.toBeNull();
  });

  it("桌面版不再對 resource／news／factory 個別特判分支，改由共用邏輯統一渲染", () => {
    // 統一互動邏輯上線後，找工廠／找資源／找消息不應該再各自有專屬 if 分支——
    // 三者都要走同一份 hubHasDropdown + renderDesktopHub 共用路徑。
    expect(source).not.toMatch(/if \(hub\.key === "resource"\)/);
    expect(source).not.toMatch(/if \(hub\.key === "news"\)/);
    expect(source).not.toMatch(/if \(!hub\.soon\) \{\s*\n\s*\/\/ 商機媒合中心/);
    expect(source).toMatch(/function hubHasDropdown\(hub: HubItem\): boolean/);
  });

  it("收合面板加上 inert，避免鍵盤 Tab 聚焦到不可見的子連結", () => {
    // grid-template-rows: 0fr 只是視覺上收合，Link 仍在 DOM 中；沒有額外處理的話
    // 鍵盤使用者仍可能 Tab 進入看不到的 /search、/upgrade-center 連結。
    // React 19 原生支援 inert prop，isOpen=false 時整個面板（含子連結）不可聚焦、不可互動。
    expect(source).toMatch(/inert=\{!isOpen\}/);
  });

  it("mobileOpen 開啟時存在 body scroll lock 邏輯（非只有 overflow:hidden）", () => {
    // production 現況已經加上 mobileMenuLockSuppressed（見 Navbar.tsx 第 227
    // 行附近註解：避免跟 OnboardingTour 自己的全螢幕 scroll lock 衝突），
    // 這裡的 regex 更新成目前真正的條件式與 dependency array，而不是把
    // production 改回舊版單一 mobileOpen 判斷。
    const lockEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*if \(!mobileOpen \|\| mobileMenuLockSuppressed\) return;[\s\S]*?\}, \[mobileOpen, mobileMenuLockSuppressed\]\);/
    );
    expect(lockEffectMatch, "找不到 mobileOpen 的 body scroll lock useEffect").not.toBeNull();
    const lockEffect = lockEffectMatch![0];

    // 不只是 document.body.style.overflow = "hidden"，還要有 position:fixed +
    // 負值 top 的做法，這是 iOS Safari／Android Chrome／Capacitor WebView 都可靠
    // 防止背景捲動與位置跳動的關鍵。
    expect(lockEffect).toMatch(/body\.style\.position = "fixed"/);
    expect(lockEffect).toMatch(/body\.style\.top = `-\$\{scrollY\}px`/);
    expect(lockEffect).toMatch(/body\.style\.overflow = "hidden"/);
  });

  it("scroll lock cleanup 會恢復 body 原本 inline styles 並呼叫 window.scrollTo 還原 scrollY", () => {
    // production 現況已經加上 mobileMenuLockSuppressed（見 Navbar.tsx 第 227
    // 行附近註解：避免跟 OnboardingTour 自己的全螢幕 scroll lock 衝突），
    // 這裡的 regex 更新成目前真正的條件式與 dependency array，而不是把
    // production 改回舊版單一 mobileOpen 判斷。
    const lockEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*if \(!mobileOpen \|\| mobileMenuLockSuppressed\) return;[\s\S]*?\}, \[mobileOpen, mobileMenuLockSuppressed\]\);/
    );
    const lockEffect = lockEffectMatch![0];

    // cleanup 必須把每個曾經覆蓋過的 body style 都還原成呼叫當下記錄的 previous 值，
    // 而不是寫死清空成空字串（避免覆蓋掉 body 原本就存在的 inline style）。
    expect(lockEffect).toMatch(/const previous = \{/);
    expect(lockEffect).toMatch(/body\.style\.position = previous\.position;/);
    expect(lockEffect).toMatch(/body\.style\.top = previous\.top;/);
    expect(lockEffect).toMatch(/body\.style\.overflow = previous\.overflow;/);
    expect(lockEffect).toMatch(/window\.scrollTo\(0, scrollY\);/);
  });

  it("手機選單自身的捲動容器具有 overflow-y-auto 與 overscroll-contain", () => {
    expect(source).toMatch(/overflow-y-auto overscroll-contain touch-pan-y/);
    expect(source).toMatch(/WebkitOverflowScrolling: "touch"/);
  });

  it("手機選單 overlay 透過 createPortal 掛到 document.body，脫離 header 的 stacking context", () => {
    expect(source).toMatch(/import \{ createPortal \} from "react-dom";/);
    expect(source).toMatch(/menuVisible && createPortal\(/);
  });

  it("overlay 外層容器的框從 header 底部才開始，不會用 inset-0 蓋住整個 viewport（避免蓋住 header 自己的按鈕）", () => {
    // 修正前用 `fixed inset-0` + `paddingTop`：框從 y=0 就整個蓋住 viewport，
    // z-[60] 高於 header 的 z-50，即使 padding 區塊沒畫任何東西，還是會把
    // header 自己的 X／通知／信件／品牌選單按鈕的點擊全部攔截掉。
    // 修正後改用 `top: calc(...)`，框本身就從 header 下緣開始，不再蓋住 header。
    const portalMatch = source.match(/\{menuVisible && createPortal\(\s*\n\s*<div\s*\n\s*className="([^"]*)"\s*\n\s*style=\{\{ ([^}]*) \}\}/);
    expect(portalMatch, "找不到手機選單 overlay 外層 div").not.toBeNull();
    const [, className, style] = portalMatch!;
    expect(className).not.toMatch(/\binset-0\b/);
    expect(className).toMatch(/\binset-x-0\b/);
    expect(className).toMatch(/\bbottom-0\b/);
    expect(className).toMatch(/z-\[60\]/);
    expect(style).not.toMatch(/paddingTop/);
    expect(style).toMatch(/top: "calc\(4rem \+ env\(safe-area-inset-top, 0px\)\)"/);
  });

  it("overlay 外層容器與內層可捲動選單內容都沒有 stopPropagation／pointer capture／capture-phase 事件，不會攔截選單內按鈕的 click", () => {
    const start = source.indexOf("{menuVisible && createPortal(");
    const end = source.indexOf("document.body\n      )}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const portalBlock = source.slice(start, end);
    // stopPropagation／pointer capture／capture-phase 事件完全不該出現：這些才是
    // 真正可能讓 click 被攔截掉的手法。
    expect(portalBlock).not.toMatch(/stopPropagation\(\)/);
    expect(portalBlock).not.toMatch(/setPointerCapture|releasePointerCapture|onPointerDownCapture|onTouchStartCapture|onClickCapture/);
    // preventDefault() 本身允許出現，但只能是既有的「註冊／登入」按鈕（單純
    // type="button"，本來就沒有預設行為要擋，無害），不能出現在 overlay 外層
    // 容器或任何 Link／導頁按鈕上（那樣才會真的擋掉導頁）。
    const preventDefaultLines = portalBlock.match(/^.*preventDefault\(\).*$/gm) ?? [];
    for (const line of preventDefaultLines) {
      expect(line).toMatch(/closeMobileMenuForDialog\(\); setLoginDialogOpen\(true\); \}\}>$/);
    }
  });

  it("手機版 header 上的 X／漢堡切換鈕是真的 <Button>，onClick 直接切換 mobileOpen（不依賴父層事件代理）", () => {
    const start = source.indexOf('{/* ── Mobile / Tablet（< lg）: 信件｜鈴鐺｜漢堡 ── */}');
    const end = source.indexOf("</div>\n      </div>", start);
    expect(start).toBeGreaterThan(-1);
    const headerMobileBlock = source.slice(start, end);
    expect(headerMobileBlock).toMatch(/onClick=\{\(\) => setMobileOpen\(!mobileOpen\)\}/);
    expect(headerMobileBlock).toMatch(/\{mobileOpen \? <X className="w-5 h-5" \/> : <Menu className="w-5 h-5" \/>\}/);
    // 這顆按鈕、以及信件／鈴鐺 Link，都是 header 自己的一部分（不在 Portal 裡），
    // 不應該被任何 preventDefault／stopPropagation 包住。
    expect(headerMobileBlock).not.toMatch(/preventDefault\(\)/);
    expect(headerMobileBlock).not.toMatch(/stopPropagation\(\)/);
  });

  it("手機版 header 上的信件／鈴鐺都是真的 <Link>，不是只有 div + CSS active 的假按鈕", () => {
    const start = source.indexOf('{/* ── Mobile / Tablet（< lg）: 信件｜鈴鐺｜漢堡 ── */}');
    const end = source.indexOf("</div>\n      </div>", start);
    const headerMobileBlock = source.slice(start, end);
    expect(headerMobileBlock).toMatch(/<Link href="\/messages">/);
    expect(headerMobileBlock).toMatch(/<Link href="\/notifications">/);
  });

  it("品牌選單「首頁」也是真的 <Link>，且點擊會先關閉品牌選單", () => {
    const brandMatch = source.match(
      /<Link href="\/" state=\{HOME_NAV_INTENT_STATE\} onClick=\{\(\) => setBrandMenuOpen\(false\)\}>/
    );
    expect(brandMatch, "找不到品牌選單「首頁」連結").not.toBeNull();
  });

  it("inert 只出現在手機選單自己內部的收合 accordion 子面板，不存在套用在 document.body 或整個 Portal 容器的 inert", () => {
    // 全檔案只應該有一處 inert，且必須是 `inert={!isOpen}` 綁在
    // `mobile-hub-panel-${hub.key}` 這個手機選單內部子面板上——不能是
    // `document.body.inert = true` 這種全站或整個 Portal 容器等級的用法。
    const inertOccurrences = source.match(/\binert\b/g) ?? [];
    expect(inertOccurrences.length).toBe(1);
    expect(source).toMatch(/id=\{`mobile-hub-panel-\$\{hub\.key\}`\}\s*\n\s*aria-hidden=\{!isOpen\}\s*\n\s*inert=\{!isOpen\}/);
    expect(source).not.toMatch(/document\.body\.inert/);
    expect(source).not.toMatch(/body\.inert\s*=/);
  });

  it("找資源／找人才／找形象／找討論手機版都不再使用低透明度 disabled 視覺（七大主入口全部開放）", () => {
    const resourceItemMatch = source.match(
      /key: "resource",[\s\S]*?dropdownItems: \[[\s\S]*?\],\s*\n\s*\},/
    );
    expect(resourceItemMatch, "找不到找資源的 HUB_ITEMS 定義").not.toBeNull();
    const resourceItem = resourceItemMatch![0];
    expect(resourceItem).not.toMatch(/text-blue-400\/60/);
    expect(resourceItem).not.toMatch(/text-blue-600\/40/);
    expect(resourceItem).toMatch(/mText: "text-blue-700"/);
    expect(resourceItem).toMatch(/iconCls: "text-blue-600"/);

    const talentItemMatch = source.match(/key: "talent",[\s\S]*?dropdownItems: \[[\s\S]*?\],\s*\n\s*\},/);
    expect(talentItemMatch, "找不到找人才的 HUB_ITEMS 定義").not.toBeNull();
    expect(talentItemMatch![0]).not.toMatch(/text-teal-600\/40/);
    expect(talentItemMatch![0]).toMatch(/mText: "text-teal-700"/);

    const brandItemMatch = source.match(/key: "brand",[\s\S]*?dropdownItems: \[[\s\S]*?\],\s*\n\s*\},/);
    expect(brandItemMatch, "找不到找形象的 HUB_ITEMS 定義").not.toBeNull();
    expect(brandItemMatch![0]).not.toMatch(/text-amber-600\/40/);
    expect(brandItemMatch![0]).toMatch(/mText: "text-amber-700"/);

    const discussionItemMatch = source.match(/key: "discussion",[\s\S]*?dropdownItems: \[[\s\S]*?\],\s*\n\s*\},/);
    expect(discussionItemMatch, "找不到找討論的 HUB_ITEMS 定義").not.toBeNull();
    expect(discussionItemMatch![0]).not.toMatch(/text-rose-600\/40/);
    expect(discussionItemMatch![0]).toMatch(/mText: "text-rose-700"/);
  });
});

describe("Navbar.tsx: 桌面版六大入口共用 hover dropdown 互動邏輯", () => {
  // 正規化成 LF：Windows checkout 下 fs.readFileSync 讀到的是實際 CRLF 內容，
  // 這裡的字串比對（尤其是 .indexOf 搭配內嵌 "\n" 的寫法）需要固定的換行符號，
  // 不正規化的話同一份測試在 LF／CRLF 兩種 checkout 環境會有不同結果。
  const source = fs.readFileSync(NAVBAR_PATH, "utf-8").replace(/\r\n/g, "\n");

  it("找工廠／找資源／找消息共用單一 openHubKey state，沒有各自獨立的 boolean state", () => {
    expect(source).toMatch(
      /const \[openHubKey, setOpenHubKey\] = useState<MobileHubKey \| null>\(null\);/
    );
    expect(source).not.toMatch(/resourceDropOpen|newsDropOpen|searchDropOpen/);
  });

  it("是否具備下拉能力由 dropdownItems 動態推導，不是手動維護的獨立欄位", () => {
    // supportsDropdown 不是 HUB_ITEMS 裡手動設定的欄位，而是 hubHasDropdown() 依
    // !soon && dropdownItems 是否有可導頁子項自動推導，避免未來加子項忘記同步開關。
    expect(source).toMatch(
      /function hubHasDropdown\(hub: HubItem\): boolean \{\s*\n\s*return !hub\.soon && hub\.dropdownItems\.some/
    );
    expect(source).not.toMatch(/supportsDropdown:/);
  });

  it("開放中入口的 hover 開啟／延遲關閉都呼叫共用的 openHub／scheduleCloseHub", () => {
    expect(source).toMatch(/onMouseEnter=\{hasDropdown \? \(\) => openHub\(hub\.key\) : undefined\}/);
    expect(source).toMatch(/onMouseLeave=\{hasDropdown \? scheduleCloseHub : undefined\}/);
    // 子選單自己也要能重新觸發 openHub／scheduleCloseHub，滑鼠從主入口移到子選單
    // 中途經過間隙時，關閉計時器會被子選單的 onMouseEnter 取消，不會中途關閉。
    expect(source).toMatch(/onMouseEnter=\{\(\) => openHub\(hub\.key\)\}/);
  });

  it("關閉緩衝約 180ms，在 100～200ms 規格範圍內", () => {
    expect(source).toMatch(
      /hubCloseTimer\.current = setTimeout\(\(\) => setOpenHubKey\(null\), 180\);/
    );
  });

  it("開啟一個入口時會清掉關閉計時器並收合品牌選單，確保同時間只開一個", () => {
    const openHubMatch = source.match(/const openHub = \(key: MobileHubKey\) => \{[\s\S]*?\n  \};/);
    expect(openHubMatch, "找不到 openHub 定義").not.toBeNull();
    expect(openHubMatch![0]).toMatch(/clearHubCloseTimer\(\);/);
    expect(openHubMatch![0]).toMatch(/setBrandMenuOpen\(false\);/);
    expect(openHubMatch![0]).toMatch(/setOpenHubKey\(key\);/);
  });

  it("外部點擊與 Escape 都會關閉目前展開的入口，Escape 額外把焦點還給觸發鈕", () => {
    const effectMatch = source.match(
      /useEffect\(\(\) => \{\s*\n\s*if \(!openHubKey\) return;[\s\S]*?\}, \[openHubKey\]\);/
    );
    expect(effectMatch, "找不到 openHubKey 的外部點擊／Escape useEffect").not.toBeNull();
    const effect = effectMatch![0];
    expect(effect).toMatch(/handleClickOutside/);
    expect(effect).toMatch(/e\.key === "Escape"/);
    expect(effect).toMatch(/hubTriggerRefs\.current\[key\]\?\.focus\(\);/);
  });

  it("觸發鈕具備 aria-haspopup／aria-expanded／aria-controls，且有 focus-visible ring 樣式", () => {
    expect(source).toMatch(/aria-haspopup=\{hasDropdown \? "menu" : undefined\}/);
    expect(source).toMatch(/aria-expanded=\{hasDropdown \? isOpen : undefined\}/);
    expect(source).toMatch(/aria-controls=\{hasDropdown \? contentId : undefined\}/);
    expect(source).toMatch(/focus-visible:outline-none focus-visible:ring-2/);
  });

  it("有合法預設頁面的入口（找工廠）點擊會正常導頁，沒有的（找資源／找消息）點擊只切換選單", () => {
    expect(source).toMatch(/href: "\/search", soon: false,/); // 找工廠設了 href
    expect(source).toMatch(/const trigger = hub\.href \? \(/);
    expect(source).toMatch(/onClick=\{\(\) => toggleHub\(hub\.key\)\}/);
  });

  it("路由切換會重置 openHubKey（連同品牌選單、手機選單一起關閉）", () => {
    const routeEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*\n\s*setBrandMenuOpen\(false\);\s*\n\s*setOpenHubKey\(null\);[\s\S]*?\}, \[location\]\);/
    );
    expect(routeEffectMatch, "找不到路由切換重置 effect").not.toBeNull();
  });

  it("桌面版下拉觸發鈕與選單容器共用同一份基礎樣式常數，展開速度／圓角／陰影／間距／z-index 一致", () => {
    expect(source).toMatch(/const HUB_TRIGGER_BASE =/);
    expect(source).toMatch(/const HUB_MENU_PANEL =/);
    expect(source).toMatch(/const HUB_MENU_ITEM =/);
    // 品牌顏色（card／cardHover／ring／triggerIconCls）可以各自不同，但容器結構
    // 一定要套用共用常數，不能任何一個入口另外硬編碼一份看起來很像但不同步的樣式。
    expect(source).toMatch(/const triggerClassName = `\$\{HUB_TRIGGER_BASE\} \$\{hub\.ring\} \$\{hub\.card\} \$\{hub\.cardHover\}`;/);
    expect(source).toMatch(/className=\{HUB_MENU_PANEL\}/);
    expect(source).toMatch(/className=\{HUB_MENU_ITEM\}/);
  });

  it("鎖定入口（soon: true）沒有下拉選單分支，不會渲染空白選單", () => {
    const soonBranchMatch = source.match(/if \(hub\.soon\) \{[\s\S]*?\n            \}/);
    expect(soonBranchMatch, "找不到鎖定入口分支").not.toBeNull();
    expect(soonBranchMatch![0]).not.toMatch(/dropdownItems/);
    expect(soonBranchMatch![0]).toMatch(/cursor-not-allowed/);
  });
});

describe("Navbar.tsx: 品牌「首頁 OXM」下拉選單 portal 到 document.body，逃離 header 的 stacking context", () => {
  // 正規化成 LF：Windows checkout 下 fs.readFileSync 讀到的是實際 CRLF 內容，
  // 這裡的字串比對（尤其是 .indexOf 搭配內嵌 "\n" 的寫法）需要固定的換行符號，
  // 不正規化的話同一份測試在 LF／CRLF 兩種 checkout 環境會有不同結果。
  const source = fs.readFileSync(NAVBAR_PATH, "utf-8").replace(/\r\n/g, "\n");

  it("手機 overlay 的實際範圍仍從 header 下方開始，維持上一輪的幾何範圍修正（不是 fixed inset-0）", () => {
    expect(source).toMatch(/className="lg:hidden fixed inset-x-0 bottom-0 z-\[60\]"/);
    expect(source).not.toMatch(/fixed inset-0 z-\[60\]/);
    expect(source).toMatch(/top: "calc\(4rem \+ env\(safe-area-inset-top, 0px\)\)"/);
  });

  it("品牌下拉選單 content 透過 createPortal 掛到 document.body，不再是 header 內部 absolute 定位的子元素", () => {
    const portalMatch = source.match(
      /\{brandMenuOpen && brandMenuPos && createPortal\(\s*\n\s*<div\s*\n\s*ref=\{brandMenuContentRef\}\s*\n\s*className="([^"]*)"/
    );
    expect(portalMatch, "找不到品牌下拉選單的 createPortal 區塊").not.toBeNull();
    const [, className] = portalMatch!;
    // 不再是 absolute 相對父層定位，而是 fixed + 手動算好的座標
    expect(className).not.toMatch(/\babsolute\b/);
    expect(className).toMatch(/\bfixed\b/);
    const portalEnd = source.indexOf("document.body", source.indexOf("brandMenuOpen && brandMenuPos && createPortal("));
    expect(portalEnd).toBeGreaterThan(-1);
  });

  it("品牌下拉選單 content 的 z-index（z-[70]）高於手機選單 overlay（z-[60]），這樣手機選單開啟時仍能蓋在它上面", () => {
    const portalMatch = source.match(
      /\{brandMenuOpen && brandMenuPos && createPortal\(\s*\n\s*<div\s*\n\s*ref=\{brandMenuContentRef\}\s*\n\s*className="([^"]*)"/
    );
    expect(portalMatch).not.toBeNull();
    const [, className] = portalMatch!;
    expect(className).toMatch(/z-\[70\]/);
    // 70 > 60：手機選單 overlay 用的是 z-[60]
    const overlayZ = 60;
    const brandZ = 70;
    expect(brandZ).toBeGreaterThan(overlayZ);
  });

  it("<header> 本身沒有被提高到不合理的層級——維持 z-50，沒有為了顯示下拉選單而整個 header 蓋過其他 modal/dialog", () => {
    expect(source).toMatch(/<header className="sticky top-0 z-50 /);
  });

  it("開啟時用 getBoundingClientRect 量測觸發鈕位置換算 fixed 座標，而不是繼續用 absolute + top-full 相對父層定位", () => {
    expect(source).toMatch(/const rect = brandMenuRef\.current\.getBoundingClientRect\(\);/);
    expect(source).toMatch(/setBrandMenuPos\(\{ top: rect\.bottom \+ 6, left: rect\.left \}\);/);
  });

  it("外部點擊判斷同時檢查觸發鈕與 portal 後的 content 兩個 ref，點選單內項目不會被誤判成點外部而立刻關閉", () => {
    const effectMatch = source.match(
      /useEffect\(\(\) => \{\s*\n\s*if \(!brandMenuOpen\) return;[\s\S]*?\}, \[brandMenuOpen\]\);/
    );
    expect(effectMatch, "找不到 brandMenuOpen 的外部點擊 useEffect").not.toBeNull();
    const effect = effectMatch![0];
    expect(effect).toMatch(/brandMenuRef\.current\?\.contains\(target\)/);
    expect(effect).toMatch(/brandMenuContentRef\.current\?\.contains\(target\)/);
  });

  it("手機版 header 上的 X／通知／信件仍是可互動元素，沒有被本次品牌下拉修正誤動到", () => {
    expect(source).toMatch(/onClick=\{\(\) => setMobileOpen\(!mobileOpen\)\}/);
    expect(source).toMatch(/<Link href="\/messages">/);
    expect(source).toMatch(/<Link href="\/notifications">/);
  });
});
