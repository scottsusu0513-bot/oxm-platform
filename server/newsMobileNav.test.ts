/**
 * `/news` 手機版分類導覽（五分頁＋產業選擇器）結構回歸測試。
 *
 * 這個專案的 vitest 設定（vitest.config.ts）environment 是 "node"、include
 * 只有 server/**\/*.test.ts，沒有 jsdom／React Testing Library，無法實際
 * render React 元件或模擬點擊。跟本專案既有慣例一致（server/news.test.ts
 * 對 router 權限、server/memberCenterNewsSettings.test.ts 對 MemberCenter.tsx
 * 都是直接讀原始碼字串斷言），這裡直接讀 client/src/pages/News.tsx 與
 * client/src/components/NewsNewBadge.tsx 的原始碼，用結構性斷言驗證：
 *   - 舊的、把全部分類＋12 個產業塞進同一個 <Select> 的做法已完整移除。
 *   - 手機版確實是「五分頁 + 只在選中產業分頁才出現的第二層選擇器」兩層架構。
 *   - 全站 NEW 徽章改用共用的 NewsNewBadge，不再有 label 字串接 " NEW" 的寫法。
 *   - 桌面版既有導覽（aside／FIXED_CATEGORIES／INDUSTRIES 側欄）沒有被移除。
 *
 * NEW 的顯示/消失邏輯本身（168 小時＋已讀）完全沒有改動，已有
 * server/newsCategorySummary.test.ts／server/newsBoardSubscription.test.ts
 * 覆蓋，這裡不重複測後端規則。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const newsSource = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/News.tsx"), "utf-8");
const badgeSource = fs.readFileSync(path.resolve(__dirname, "../client/src/components/NewsNewBadge.tsx"), "utf-8");

describe("News.tsx：舊的手機大型 Select 已完整移除", () => {
  it("不再 import shadcn 的 Select 系列元件", () => {
    expect(newsSource).not.toMatch(/from\s+"@\/components\/ui\/select"/);
  });

  it("原始碼裡沒有任何 <Select>／<SelectTrigger>／<SelectContent>／<SelectItem> JSX", () => {
    expect(newsSource).not.toMatch(/<Select[\s>]/);
    expect(newsSource).not.toMatch(/<SelectTrigger/);
    expect(newsSource).not.toMatch(/<SelectContent/);
    expect(newsSource).not.toMatch(/<SelectItem/);
  });

  it("不再存在把 label 與純文字 \" NEW\" 字串拼接的邏輯（例如「全部最新 NEW」「產業消息：電子零件 NEW」）", () => {
    expect(newsSource).not.toMatch(/\?\s*"\s*NEW"\s*:\s*""/);
    expect(newsSource).not.toMatch(/產業消息：/);
  });
});

describe("News.tsx：手機版兩層架構——五分頁 + 只在「產業」分頁顯示的第二層選擇器", () => {
  it("MOBILE_TABS 恰好是全部／重要／競賽／展覽／產業五個分頁，順序固定", () => {
    const start = newsSource.indexOf("const MOBILE_TABS");
    const end = newsSource.indexOf("];", start);
    const block = newsSource.slice(start, end);
    const labels = [...block.matchAll(/label:\s*"([^"]+)"/g)].map(m => m[1]);
    expect(labels).toEqual(["全部", "重要", "競賽", "展覽", "產業"]);
  });

  it("五分頁對應正確的 value（all/important/competition/exhibition/industry），跟 categoryToQueryParams／boardKey 格式相容", () => {
    const start = newsSource.indexOf("const MOBILE_TABS");
    const end = newsSource.indexOf("];", start);
    const block = newsSource.slice(start, end);
    const values = [...block.matchAll(/value:\s*"([^"]+)"/g)].map(m => m[1]);
    expect(values).toEqual(["all", "important", "competition", "exhibition", "industry"]);
  });

  it("五分頁容器有 role=\"tablist\"，每個分頁是真正的 <button> 且有 role=\"tab\"／aria-selected", () => {
    expect(newsSource).toMatch(/role="tablist"/);
    const tabsBlockStart = newsSource.indexOf("MOBILE_TABS.map(tab =>");
    const tabsBlockEnd = newsSource.indexOf("</div>", newsSource.indexOf("</button>", tabsBlockStart));
    const block = newsSource.slice(tabsBlockStart, tabsBlockEnd);
    expect(block).toMatch(/<button/);
    expect(block).toMatch(/type="button"/);
    expect(block).toMatch(/role="tab"/);
    expect(block).toMatch(/aria-selected=\{active\}/);
    expect(block).toMatch(/focus-visible:/);
  });

  it("五分頁容器使用 grid grid-cols-5，不是可能造成水平捲軸的橫向排列", () => {
    const idx = newsSource.indexOf('role="tablist"');
    const line = newsSource.slice(newsSource.lastIndexOf("<div", idx), idx + 200);
    expect(line).toMatch(/grid-cols-5/);
    expect(line).not.toMatch(/overflow-x-auto|overflow-x-scroll/);
  });

  it("只有「產業」分頁被選中時（mobileActiveTab === \"industry\"）才 render 產業選擇器", () => {
    expect(newsSource).toMatch(/mobileActiveTab === "industry" && \(/);
  });

  it("產業選擇器（PopoverContent 內）只用 INDUSTRIES.map 產生選項，不包含固定分類（全部最新／重要消息／競賽消息／展覽消息）", () => {
    const popoverStart = newsSource.indexOf("<PopoverContent");
    const popoverEnd = newsSource.indexOf("</PopoverContent>");
    const block = newsSource.slice(popoverStart, popoverEnd);
    expect(block).toMatch(/INDUSTRIES\.map/);
    expect(block).not.toMatch(/FIXED_CATEGORIES/);
    expect(block).not.toMatch(/全部最新|重要消息|競賽消息|展覽消息/);
  });

  it("產業選擇器每個選項有 icon、名稱、選中時的 Check icon", () => {
    const popoverStart = newsSource.indexOf("<PopoverContent");
    const popoverEnd = newsSource.indexOf("</PopoverContent>");
    const block = newsSource.slice(popoverStart, popoverEnd);
    expect(block).toMatch(/getIndustryIcon\(ind\.name\)/);
    expect(block).toMatch(/isSelected && <Check/);
  });

  it("產業選擇器有限制高度並允許內部捲動，不會延伸到整個頁面（max-h-[50vh] + overflow-y-auto）", () => {
    const popoverContentTag = newsSource.slice(newsSource.indexOf("<PopoverContent"), newsSource.indexOf(">", newsSource.indexOf("<PopoverContent")) + 1);
    expect(popoverContentTag).toMatch(/max-h-\[50vh\]/);
    expect(popoverContentTag).toMatch(/overflow-y-auto/);
  });

  it("點擊產業選項後會關閉選單（setIndustryPickerOpen(false)）", () => {
    const popoverStart = newsSource.indexOf("<PopoverContent");
    const popoverEnd = newsSource.indexOf("</PopoverContent>");
    const block = newsSource.slice(popoverStart, popoverEnd);
    expect(block).toMatch(/setIndustryPickerOpen\(false\)/);
  });

  it("selectMobileTab：點「產業」分頁時，若目前已經是某個產業則不做事；否則恢復 lastIndustryName（不會產生 industry=undefined）", () => {
    const start = newsSource.indexOf("function selectMobileTab");
    const end = newsSource.indexOf("\n  }", start);
    const block = newsSource.slice(start, end);
    expect(block).toMatch(/category\.startsWith\("industry:"\)/);
    expect(block).toMatch(/selectCategory\(`industry:\$\{lastIndustryName\}`\)/);
  });

  it("lastIndustryName 初始值必定是合法產業名稱：URL 已有產業就沿用，否則 fallback 成 INDUSTRIES[0].name，不可能是 undefined", () => {
    const start = newsSource.indexOf("const [lastIndustryName");
    const end = newsSource.indexOf("});", start);
    const block = newsSource.slice(start, end);
    expect(block).toMatch(/INDUSTRIES\[0\]\.name/);
  });
});

describe("News.tsx：訂閱按鈕 boardKey 仍對應實際選中的看板，不受手機分頁重構影響", () => {
  it("兩處 SubscribeButton（桌面／手機列）都傳入 boardKey={category}，不是分頁的虛擬值", () => {
    const matches = [...newsSource.matchAll(/<SubscribeButton boardKey=\{category\}/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("News.tsx：桌面版既有導覽結構未被移除", () => {
  it("桌面側欄 <aside className=\"hidden lg:block ...\"> 仍存在", () => {
    expect(newsSource).toMatch(/<aside className="hidden lg:block/);
  });
  it("FIXED_CATEGORIES 與 INDUSTRIES 仍各自在桌面側欄 render 一次", () => {
    expect(newsSource).toMatch(/FIXED_CATEGORIES\.map\(c => \{/);
    const asideStart = newsSource.indexOf("<aside className=\"hidden lg:block");
    const asideEnd = newsSource.indexOf("</aside>");
    const asideBlock = newsSource.slice(asideStart, asideEnd);
    expect(asideBlock).toMatch(/INDUSTRIES\.map\(ind => \{/);
  });
});

describe("全站找消息 NEW 徽章統一改用共用的 NewsNewBadge 元件", () => {
  it("NewsNewBadge 支援 default／compact 兩種尺寸，視覺語言（漸層／字重／圓角）共用同一份 class 前綴", () => {
    expect(badgeSource).toMatch(/size\?:\s*"default"\s*\|\s*"compact"/);
    expect(badgeSource).toMatch(/bg-gradient-to-r from-orange-500 to-red-500/);
    expect(badgeSource).toMatch(/font-bold/);
    expect(badgeSource).toMatch(/rounded/);
    expect(badgeSource).toMatch(/text-white/);
  });

  it("News.tsx 沒有另外寫一份 NEW 徽章樣式（不再有本地的 NewBadge 定義）", () => {
    expect(newsSource).not.toMatch(/function NewBadge/);
  });

  it("News.tsx 恰好 7 處 JSX 呼叫 <NewsNewBadge：卡片(1)、桌面固定分類迴圈(1，實際渲染 4 次)、桌面產業父層(1)、桌面產業子項迴圈(1，實際渲染 12 次)、手機分頁迴圈(1，實際渲染 5 次)、手機產業選擇器觸發列(1)、手機產業選項迴圈(1，實際渲染 12 次)——涵蓋規格要求的全部 11 個顯示位置", () => {
    const count = (newsSource.match(/<NewsNewBadge/g) ?? []).length;
    expect(count).toBe(7);
  });

  it("手機分頁與產業選擇器使用 compact 尺寸（跟一般消息卡片的 default 尺寸區分，但共用同一元件）", () => {
    const compactCount = (newsSource.match(/<NewsNewBadge size="compact" \/>/g) ?? []).length;
    // 手機分頁（1 處 render 邏輯，套用在 5 個分頁上）＋ 產業選擇器觸發列（1 處）＋ 產業選項列表（1 處）＝ 原始碼裡至少 3 段 compact 用法。
    expect(compactCount).toBeGreaterThanOrEqual(3);
  });
});
