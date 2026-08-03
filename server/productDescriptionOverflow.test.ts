/**
 * 工廠公開頁「商品描述」手機版橫向溢位修正的回歸測試。
 *
 * 同 server/myMessagesTitleLayout.test.ts／server/navbarMobileAccordion.test.ts
 * 的既有做法：本專案 vitest 設定（vitest.config.ts）只涵蓋
 * server/**\/*.test.ts、environment: "node"，沒有 jsdom／React Testing
 * Library，無法在這裡對 FactoryDetailView 做真正的 DOM render／
 * document.scrollWidth 量測——那部分改用真人瀏覽器在 320px／375px／390px
 * 寬度下實測（見本輪任務 Part 四／Part 五的真實瀏覽器驗證紀錄），這裡只做
 * 最低限度的原始碼層防護，避免這個具體回歸情境（flex 版面缺少 min-w-0、
 * 文字層缺少 whitespace-pre-wrap／break-words）被後續修改不小心移除。
 *
 * 根因回顧：flex item 預設 min-width: auto，不會縮小到內容本身的
 * min-content 寬度以下，即使父層有 max-width/overflow-hidden，內容夠長
 * （尤其是無空格的長字串／URL）還是會把 flex item 撐開、進而撐開整個頁面
 * 橫向捲動；whitespace-pre-wrap + break-words 則是讓文字本身在寬度受限時
 * 換行，同時保留使用者輸入的換行。兩者缺一都無法真正修好。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FACTORY_DETAIL_VIEW_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "FactoryDetailView.tsx",
);

describe("FactoryDetailView.tsx：商品列表 flex 版面鏈與文字層的溢位防護", () => {
  const source = fs.readFileSync(FACTORY_DETAIL_VIEW_PATH, "utf-8");

  it("商品卡片外層容器有 min-w-0", () => {
    expect(source).toMatch(/p-4 rounded-lg border hover:bg-muted\/30 transition-colors min-w-0/);
  });

  it("圖片＋文字的 flex 容器（flex-1）有 min-w-0，避免因內容撐開而不縮小", () => {
    expect(source).toMatch(/className="flex gap-3 flex-1 min-w-0"/);
  });

  it("文字區塊（名稱＋描述所在的 flex-1）有 min-w-0", () => {
    // 圖片＋文字容器內、真正包住名稱與描述文字的 flex-1 div。
    const textBlockMatch = source.match(/\)\}\s*<div className="flex-1 min-w-0">\s*<h4/);
    expect(textBlockMatch, "找不到商品名稱／描述所在、帶 min-w-0 的文字容器").not.toBeNull();
  });

  it("商品名稱 <h4> 有 break-words，避免無空格長字串把卡片撐開", () => {
    expect(source).toMatch(/<h4 className="font-medium mb-1 break-words">\{product\.name\}<\/h4>/);
  });

  it("商品描述 <p> 同時有 whitespace-pre-wrap 與 break-words，且沒有截斷/省略號/固定高度/橫向捲動的寫法", () => {
    const descMatch = source.match(/<p className="([^"]*)">\{product\.description\}<\/p>/);
    expect(descMatch, "找不到商品描述 <p>").not.toBeNull();
    const className = descMatch![1];
    expect(className).toMatch(/\bwhitespace-pre-wrap\b/);
    expect(className).toMatch(/\bbreak-words\b/);

    // 明確排除使用者要求「完整顯示、禁止截斷」情境下不該出現的寫法。
    expect(className).not.toMatch(/\btruncate\b/);
    expect(className).not.toMatch(/\bline-clamp/);
    expect(className).not.toMatch(/\bmax-h-/);
    expect(className).not.toMatch(/\boverflow-x-/);
    expect(className).not.toMatch(/\boverflow-hidden\b/);
  });

  it("頁面／版面沒有用外層 overflow-x-hidden 掩蓋溢位，而是修正真正撐開的內層元素", () => {
    expect(source).not.toMatch(/overflow-x-hidden/);
  });
});
