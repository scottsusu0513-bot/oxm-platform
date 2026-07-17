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
  const source = fs.readFileSync(NAVBAR_PATH, "utf-8");

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

  it("六個入口都定義了穩定 key，且與 MobileHubKey 一致", () => {
    const keys = ["factory", "resource", "talent", "brand", "news", "discussion"];
    for (const key of keys) {
      expect(source).toMatch(new RegExp(`key: "${key}"`));
    }
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

  it("桌面版找工廠仍是 hover 展開、找資源仍是點擊 dropdown（分支未被誤合併）", () => {
    expect(source).toMatch(/if \(hub\.key === "resource"\)/);
    expect(source).toMatch(/if \(!hub\.soon\)/);
    expect(source).toMatch(/商機媒合中心 — click 導向媒合首頁，hover 顯示下拉/);
  });

  it("收合面板加上 inert，避免鍵盤 Tab 聚焦到不可見的子連結", () => {
    // grid-template-rows: 0fr 只是視覺上收合，Link 仍在 DOM 中；沒有額外處理的話
    // 鍵盤使用者仍可能 Tab 進入看不到的 /search、/upgrade-center 連結。
    // React 19 原生支援 inert prop，isOpen=false 時整個面板（含子連結）不可聚焦、不可互動。
    expect(source).toMatch(/inert=\{!isOpen\}/);
  });

  it("mobileOpen 開啟時存在 body scroll lock 邏輯（非只有 overflow:hidden）", () => {
    const lockEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*\n\s*if \(!mobileOpen\) return;[\s\S]*?\}, \[mobileOpen\]\);/
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
    const lockEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*\n\s*if \(!mobileOpen\) return;[\s\S]*?\}, \[mobileOpen\]\);/
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
    expect(source).toMatch(/fixed inset-0 z-\[60\]/);
  });

  it("找資源手機版不再使用低透明度 disabled 視覺，找人才等未開放入口仍維持低透明度", () => {
    const resourceItemMatch = source.match(
      /key: "resource",[\s\S]*?dropdown: \[[\s\S]*?\],\s*\n\s*\},/
    );
    expect(resourceItemMatch, "找不到找資源的 HUB_ITEMS 定義").not.toBeNull();
    const resourceItem = resourceItemMatch![0];

    expect(resourceItem).not.toMatch(/text-blue-400\/60/);
    expect(resourceItem).not.toMatch(/text-blue-600\/40/);
    expect(resourceItem).toMatch(/mText: "text-blue-700"/);
    expect(resourceItem).toMatch(/iconCls: "text-blue-600"/);

    const talentItemMatch = source.match(/key: "talent",[\s\S]*?dropdown: \[[\s\S]*?\],\s*\n\s*\},/);
    expect(talentItemMatch, "找不到找人才的 HUB_ITEMS 定義").not.toBeNull();
    expect(talentItemMatch![0]).toMatch(/text-teal-600\/40/);
  });
});
