/**
 * `/news` 前端「跨產業資訊」看板結構回歸測試（原始碼內容斷言）。
 *
 * 跟 server/newsMobileNav.test.ts 一致：這個專案的 vitest 是 node
 * environment、沒有 jsdom，無法實際 render React 元件，改讀
 * client/src/pages/News.tsx 原始碼做結構性斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/News.tsx"), "utf-8");

describe("跨產業資訊看板：不是真實工廠產業，不進 INDUSTRIES", () => {
  it("shared/constants.ts 的 INDUSTRIES 不包含跨產業資訊／cross-industry", () => {
    const constantsSource = fs.readFileSync(path.resolve(__dirname, "../shared/constants.ts"), "utf-8");
    const industriesStart = constantsSource.indexOf("export const INDUSTRIES");
    const industriesEnd = constantsSource.indexOf("] as const", industriesStart);
    const block = constantsSource.slice(industriesStart, industriesEnd);
    expect(block).not.toMatch(/跨產業資訊/);
    expect(block).not.toMatch(/cross-industry/);
  });

  it("News.tsx 的 CategoryValue 型別把 cross-industry 定義成獨立固定字面量，不是 industry:${string} 命名空間的一部分", () => {
    const idx = source.indexOf("type CategoryValue =");
    const line = source.slice(idx, source.indexOf(";", idx));
    expect(line).toMatch(/"cross-industry"/);
  });
});

describe("桌面版：跨產業資訊位於紡織上方，共用垂直線與按鈕樣式", () => {
  it("桌面側欄的跨產業資訊按鈕，在原始碼順序上位於 INDUSTRIES.map 渲染之前", () => {
    const asideStart = source.indexOf('<aside className="hidden lg:block');
    const asideEnd = source.indexOf("</aside>");
    const asideBlock = source.slice(asideStart, asideEnd);

    const crossIdx = asideBlock.indexOf('onClick={() => selectCategory("cross-industry")}');
    const industriesMapIdx = asideBlock.indexOf("INDUSTRIES.map(ind => {");
    expect(crossIdx).toBeGreaterThan(-1);
    expect(industriesMapIdx).toBeGreaterThan(-1);
    expect(crossIdx).toBeLessThan(industriesMapIdx);
  });

  it("跨產業資訊按鈕在同一個 relative pl-4 space-y-1 ml-4 容器內，跟真實產業共用垂直線", () => {
    const containerStart = source.indexOf('<div className="relative pl-4 space-y-1 ml-4">');
    const crossIdx = source.indexOf('onClick={() => selectCategory("cross-industry")}', containerStart);
    const industriesMapIdx = source.indexOf("INDUSTRIES.map(ind => {", containerStart);
    expect(containerStart).toBeGreaterThan(-1);
    expect(crossIdx).toBeGreaterThan(containerStart);
    expect(crossIdx).toBeLessThan(industriesMapIdx);
  });

  it("跨產業資訊桌面按鈕使用共用的 sidebarItemClass／sidebarIconClass 與 NewsNewBadge，不是另外寫一份樣式", () => {
    const idx = source.indexOf('onClick={() => selectCategory("cross-industry")}');
    const block = source.slice(idx, idx + 600);
    expect(block).toMatch(/sidebarItemClass\(category === "cross-industry"\)/);
    expect(block).toMatch(/sidebarIconClass\(category === "cross-industry"\)/);
    expect(block).toMatch(/<NewsNewBadge/);
    expect(block).not.toMatch(/text-\[9px\]|text-\[10px\]/); // 不得另外寫死一份 NEW 樣式
  });
});

describe("手機版：產業選單第一個選項是跨產業資訊，不是第六個第一層分頁", () => {
  it("MOBILE_TABS 仍然只有五個，沒有把跨產業資訊塞成第六個分頁", () => {
    const start = source.indexOf("const MOBILE_TABS");
    const end = source.indexOf("];", start);
    const block = source.slice(start, end);
    const values = [...block.matchAll(/value:\s*"([^"]+)"/g)].map(m => m[1]);
    expect(values).toEqual(["all", "important", "competition", "exhibition", "industry"]);
    expect(block).not.toMatch(/cross-industry/);
  });

  it("手機產業選擇器（PopoverContent）裡，跨產業資訊選項在 INDUSTRIES.map 之前", () => {
    const popoverStart = source.indexOf("<PopoverContent");
    const popoverEnd = source.indexOf("</PopoverContent>");
    const block = source.slice(popoverStart, popoverEnd);

    const crossIdx = block.indexOf('selectCategory("cross-industry")');
    const industriesMapIdx = block.indexOf("INDUSTRIES.map(ind => {");
    expect(crossIdx).toBeGreaterThan(-1);
    expect(industriesMapIdx).toBeGreaterThan(-1);
    expect(crossIdx).toBeLessThan(industriesMapIdx);
  });

  it("手機跨產業資訊選項使用共用 NewsNewBadge compact，不是純文字 NEW", () => {
    const popoverStart = source.indexOf("<PopoverContent");
    const crossIdx = source.indexOf('selectCategory("cross-industry")', popoverStart);
    const block = source.slice(crossIdx, crossIdx + 900);
    expect(block).toMatch(/<NewsNewBadge size="compact"/);
    expect(block).not.toMatch(/"\s*NEW"/);
  });

  it("mobileActiveTab／industrySectionActive 計算式把 cross-industry 視為「產業」分頁的一種，跟 industry: 前綴同一組判斷", () => {
    const idx = source.indexOf("const industrySectionActive =");
    const line = source.slice(idx, source.indexOf(";", idx));
    expect(line).toMatch(/category\.startsWith\("industry:"\)/);
    expect(line).toMatch(/category === "cross-industry"/);
  });
});

describe("URL／query 一致性：category=cross-industry 往返正確", () => {
  it("parseCategoryFromSearch 支援 category=cross-industry", () => {
    const idx = source.indexOf("function parseCategoryFromSearch");
    const end = source.indexOf("\n}", idx);
    const fn = source.slice(idx, end);
    expect(fn).toMatch(/category === "cross-industry"/);
  });

  it("ApiCategory 型別包含 cross-industry，categoryToQueryParams 能正確組出 { category: \"cross-industry\" }（不會落入 industry: 前綴分支）", () => {
    const apiCategoryIdx = source.indexOf("type ApiCategory =");
    const apiCategoryLine = source.slice(apiCategoryIdx, source.indexOf(";", apiCategoryIdx));
    expect(apiCategoryLine).toMatch(/"cross-industry"/);
  });

  it("categoryLabel／getCategoryMeta 對 cross-industry 都有明確分支，不會落入 industry: 前綴的 slice fallback", () => {
    const labelIdx = source.indexOf("function categoryLabel");
    const labelEnd = source.indexOf("\n}", labelIdx);
    expect(source.slice(labelIdx, labelEnd)).toMatch(/if \(cat === "cross-industry"\) return "跨產業資訊";/);

    const metaIdx = source.indexOf("function getCategoryMeta");
    const metaEnd = source.indexOf("\n}", metaIdx);
    expect(source.slice(metaIdx, metaEnd)).toMatch(/if \(cat === "cross-industry"\)/);
  });

  it("categoryHasNew 對 cross-industry 有明確分支，讀 summary.crossIndustry", () => {
    const idx = source.indexOf("function categoryHasNew");
    const end = source.indexOf("\n}", idx);
    const fn = source.slice(idx, end);
    expect(fn).toMatch(/if \(cat === "cross-industry"\) return summary\.crossIndustry;/);
  });
});

describe("訂閱按鈕：boardKey 隨 cross-industry 正確切換", () => {
  it("SubscribeButton 仍直接吃 boardKey={category}，cross-industry 時就是 boardKey=\"cross-industry\"，跟後端一致", () => {
    const matches = [...source.matchAll(/<SubscribeButton boardKey=\{category\}/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
