import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 同 server/navbarMobileAccordion.test.ts 的做法：此專案 vitest 僅涵蓋
// server/**/*.test.ts、environment: "node"，沒有 jsdom／React Testing Library，
// 無法對 MyMessages 做真正的 DOM render／視覺置中驗證。這裡改用原始碼內容斷言，
// 針對「手機版『我的訊息』標題被左上角浮動返回鍵遮住」這個具體回歸情境做最低
// 限度防護。
//
// 規格重點：手機版只有「我的訊息」四個字本身要真正水平置中——不是「圖示+文字」
// 整組置中（那樣文字會因為左側圖示佔位而偏移，不是文字本身的正中心）。做法是
// mobile-first 用 text-center 對付純文字置中，圖示用 hidden lg:block 只在桌面版
// 出現，桌面版再用 lg:flex ... lg:text-left 恢復原本「圖示+文字」左對齊排版。

const MY_MESSAGES_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "pages",
  "MyMessages.tsx"
);

function extractH1(source: string): string {
  const match = source.match(/<h1 className="([^"]*)">/);
  expect(match, "找不到標題 <h1>").not.toBeNull();
  return match![1];
}

describe("MyMessages.tsx: 手機版「我的訊息」文字本身真正水平置中，不用左側留白閃避浮動返回鍵", () => {
  const source = fs.readFileSync(MY_MESSAGES_PATH, "utf-8");

  it("標題文字仍是「我的訊息」，內容沒有被改動", () => {
    expect(source).toMatch(/<span>我的訊息<\/span>/);
  });

  it("手機版（未加 lg: 前綴的預設樣式）是 text-center，讓文字本身（不含圖示）真正置中", () => {
    const className = extractH1(source);
    expect(className).toMatch(/\btext-center\b/);
    // 手機版預設不能是 flex／justify-center 整組置中那種寫法——那樣文字會被圖示
    // 往右推、不是文字本身的正中心。預設（無 lg: 前綴）不應該出現 flex／
    // justify-center，這兩個字串只能帶 lg: 前綴出現。
    const unprefixedTokens = className
      .split(/\s+/)
      .filter((token) => token.length > 0 && !token.startsWith("lg:"));
    expect(unprefixedTokens).not.toContain("flex");
    expect(unprefixedTokens).not.toContain("justify-center");
  });

  it("MessageCircle 圖示手機版隱藏（hidden）、只在桌面版顯示（lg:block），確保手機版標題只剩純文字", () => {
    const iconMatch = source.match(/<MessageCircle className="([^"]*)" \/>\s*\n\s*<span>我的訊息<\/span>/);
    expect(iconMatch, "找不到標題列的 MessageCircle 圖示").not.toBeNull();
    const iconClassName = iconMatch![1];
    expect(iconClassName).toMatch(/\bhidden\b/);
    expect(iconClassName).toMatch(/\blg:block\b/);
  });

  it("桌面版（lg: 前綴）恢復圖示+文字左對齊排版：lg:flex、lg:items-center、lg:justify-start、lg:gap-2、lg:text-left", () => {
    const className = extractH1(source);
    expect(className).toMatch(/\blg:flex\b/);
    expect(className).toMatch(/\blg:items-center\b/);
    expect(className).toMatch(/\blg:justify-start\b/);
    expect(className).toMatch(/\blg:gap-2\b/);
    expect(className).toMatch(/\blg:text-left\b/);
  });

  it("沒有用大量左側 padding／margin 或硬編碼像素把標題往右推來閃避返回鍵", () => {
    const className = extractH1(source);
    expect(className).not.toMatch(/\bpl-\d/);
    expect(className).not.toMatch(/\bml-\d/);
    expect(className).not.toMatch(/\bpl-\[/);
    expect(className).not.toMatch(/\bml-\[/);
    expect(className).not.toMatch(/left-\d/);
    expect(className).not.toMatch(/left-\[/);
  });

  it("浮動返回鍵（FloatingBackButton）本身沒有被修改", () => {
    expect(source).toMatch(/<FloatingBackButton fallbackHref="\/" \/>/);
  });

  it("標題所在的容器結構沒有變動（container py-6 max-w-3xl），只有 h1 自己的 class 與內部結構改變", () => {
    expect(source).toMatch(/<div className="container py-6 max-w-3xl">/);
  });
});
