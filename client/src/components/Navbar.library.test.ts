/**
 * 傳產圖書館（/library）Navbar 入口位置（見任務定案「傳產圖書館
 * Navigation 調整」）：正式入口從「找消息／傳產知識與情報中心」hub 移到
 * 左上角 OXM 品牌下拉選單，跟「首頁」「關於 OXM」「常見問答 FAQ」並列；
 * 找消息 hub 維持原本的時效性內容定位，只剩「產業情報中心」一項。
 *
 * HUB_ITEMS／品牌下拉選單都是 Navbar.tsx 內部未匯出的內容（品牌選單是
 * inline JSX，不是資料陣列），沿用 server/blogGone.test.ts／
 * seoSitemapAndSearchNoindex.test.ts 對「邏輯直接寫在檔案內部、沒有匯出成
 * 獨立函式」的既有純字串驗證手法，只確認資料/連結層有正確接上，不驗證
 * 任何視覺樣式（Library 本身的美術已定稿，這裡不驗證 Library 頁面樣式，
 * 只驗證 Navbar 連結位置）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");
}

const source = readSource("src", "components", "Navbar.tsx");

describe("Navbar：OXM 品牌下拉選單新增「傳產圖書館」", () => {
  // 抓品牌下拉選單 portal 的 content 本體（從 brandMenuOpen && brandMenuPos
  // && createPortal( 開始，到 document.body 為止）。
  const brandMenuMatch = source.match(/brandMenuOpen && brandMenuPos && createPortal\([\s\S]*?document\.body\s*\)\}/);
  const brandMenuSource = brandMenuMatch ? brandMenuMatch[0] : "";

  it("品牌下拉選單本體存在，且抓到的區塊確實包含既有的「首頁」「關於 OXM」「常見問答 FAQ」三項", () => {
    expect(brandMenuSource.length).toBeGreaterThan(0);
    expect(brandMenuSource).toMatch(/href="\/"[\s\S]*?首頁/);
    expect(brandMenuSource).toMatch(/href="\/about"[\s\S]*?關於 OXM/);
    expect(brandMenuSource).toMatch(/href="\/faq"[\s\S]*?常見問答 FAQ/);
  });

  it("新增「傳產圖書館」項目，href 指向 /library，且沿用同一個下拉選單既有的純文字列樣式（不是另外重做的元件）", () => {
    expect(brandMenuSource).toMatch(/href="\/library"[\s\S]*?傳產圖書館/);
    expect(brandMenuSource).toContain(
      'className="px-3.5 py-2 text-sm font-medium text-foreground hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer"',
    );
  });

  it("傳產圖書館項目排在「常見問答 FAQ」之後（維持既有 首頁/關於OXM/FAQ 的順序，新項目接在最後）", () => {
    const faqIdx = brandMenuSource.indexOf('href="/faq"');
    const libraryIdx = brandMenuSource.indexOf('href="/library"');
    expect(faqIdx).toBeGreaterThan(-1);
    expect(libraryIdx).toBeGreaterThan(-1);
    expect(faqIdx).toBeLessThan(libraryIdx);
  });
});

describe("Navbar：找消息 hub 不再包含「傳產圖書館」", () => {
  const newsHubMatch = source.match(/key: "news",[\s\S]*?dropdownItems: \[[\s\S]*?\],\s*\n\s*\},/);
  const newsHubSource = newsHubMatch ? newsHubMatch[0] : "";

  it("找消息 hub 本體存在，且維持既有的「產業情報中心」（/news）項目", () => {
    expect(newsHubSource.length).toBeGreaterThan(0);
    expect(newsHubSource).toContain('title: "產業情報中心"');
    expect(newsHubSource).toContain('href: "/news"');
  });

  it("找消息 hub 的 dropdownItems 陣列本體（不含說明性註解）裡完全沒有「傳產圖書館」或 /library，不留下兩個 Navbar 重複入口", () => {
    // 只檢查 dropdownItems: [ ... ] 陣列本體，排除陣列前方說明「傳產圖書館
    // 已移到 OXM 品牌下拉選單」的中文註解（該註解本身會提到「傳產圖書館」
    // 字樣，屬預期內容，不代表 dropdownItems 陣列裡還留著這個項目）。
    const dropdownItemsMatch = newsHubSource.match(/dropdownItems: \[[\s\S]*?\]/);
    const dropdownItemsSource = dropdownItemsMatch ? dropdownItemsMatch[0] : "";
    expect(dropdownItemsSource.length).toBeGreaterThan(0);
    expect(dropdownItemsSource).not.toContain("傳產圖書館");
    expect(dropdownItemsSource).not.toContain("/library");
  });

  it("找消息 hub 的 dropdownItems 只有 1 筆（只剩產業情報中心）", () => {
    const itemMatches = newsHubSource.match(/\{ title:/g) ?? [];
    expect(itemMatches.length).toBe(1);
  });
});

describe("Navbar：沒有新增第 8 個主導航 hub", () => {
  it("HUB_ITEMS 陣列的 key 清單維持既有 6 個（找工廠／找資源／找人才／找形象／找消息／找討論）", () => {
    const hubKeys = Array.from(source.matchAll(/key: "(\w+)",/g)).map(m => m[1]);
    expect(hubKeys).toEqual(["factory", "resource", "talent", "brand", "news", "discussion"]);
    expect(hubKeys).not.toContain("library");
  });

  it("其餘既有 hub（找工廠／找資源／找人才／找形象／找討論）連結完全沒有被改動", () => {
    expect(source).toContain('href: "/search"');
    expect(source).toContain('href: "/resources"');
    expect(source).toContain('href: "/talent"');
    expect(source).toContain('href: "/brand"');
    expect(source).toContain('href: "/community"');
  });
});
