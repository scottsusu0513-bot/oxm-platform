/**
 * OXM Navbar Dropdown — Public Service Entries Fix。
 *
 * 背景：/resources、/brand 底下的服務頁面本身與 SEO／Sitemap 早已正式開放
 * （見 server/mainEntriesArchitecture.test.ts、server/resourceCenterEntry.test.ts
 * 的 Final Public Index Release 相關測試），但 Navbar 的「找資源」「找形象」
 * 下拉選單先前只反轉了「主入口本身可進入」，沒有同步把已公開的子服務放進
 * dropdownItems——使用者仍必須先手動進 /resources 或 /brand 才看得到四項
 * 正式服務與短影音入口。本輪只修 Navbar 這一層，不動服務頁內容／Sitemap／
 * Index／SEO／DB／API／AI／taxId／Community／Talent／Brand 頁面 UI。
 *
 * 同 server/navbarMobileAccordion.test.ts 的做法：此專案 vitest 僅涵蓋
 * server/**\/*.test.ts、environment: "node"，沒有 jsdom／React Testing Library，
 * 無法對 Navbar 做真正的 DOM render／互動測試，改用原始碼內容斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const NAVBAR_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "Navbar.tsx",
);

function readSource(): string {
  // 正規化成 LF：Windows checkout 下 fs.readFileSync 讀到的是實際 CRLF
  // 內容，字串比對（尤其是內嵌 "\n" 的寫法）需要固定的換行符號。
  return fs.readFileSync(NAVBAR_PATH, "utf-8").replace(/\r\n/g, "\n");
}

describe("找資源 dropdown：四項正式服務快速連結", () => {
  const source = readSource();
  const resourceBlock = source.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";

  it("找不到找資源的 HUB_ITEMS 定義時測試本身要先失敗，不能是空字串誤判通過", () => {
    expect(resourceBlock.length).toBeGreaterThan(0);
  });

  it("四項服務標題與 href 完全對應 shared/content/resources.ts 的正式服務清單", () => {
    const expected: Array<[string, string]> = [
      ["政府補助與企業升級", "/upgrade-center"],
      ["企業財務優化", "/finance-optimization"],
      ["ISO 與低碳認證", "/certification-center"],
      ["ERP、MES 與產線優化", "/erp-optimization"],
    ];
    for (const [title, href] of expected) {
      const itemMatch = resourceBlock.match(
        new RegExp(`title: "${title}"[\\s\\S]*?href: "${href.replace(/\//g, "\\/")}"`),
      );
      expect(itemMatch, `找不到「${title}」→ ${href}`).not.toBeNull();
    }
  });

  it("四個子項全部有 href、沒有任何一個是 disabled（全部已正式開放，不是 Coming Soon）", () => {
    const items = [...resourceBlock.matchAll(/\{\s*title: "[^"]+",\s*\n\s*description: "[^"]+",\s*\n\s*href: "[^"]+",\s*\n\s*Icon: \w+,\s*\n\s*\},/g)];
    expect(items.length).toBe(4);
    expect(resourceBlock).not.toMatch(/disabled: true/);
  });

  it("dropdownItems 陣列本身不得包含短影音／品牌與市場（已正式改分類至找形象，不屬於找資源；只檢查陣列內容，不誤判說明性註解提及短影音已搬家的文字）", () => {
    const dropdownItemsBlock = resourceBlock.slice(resourceBlock.indexOf("dropdownItems:"));
    expect(dropdownItemsBlock).not.toMatch(/title: "短影音/);
    expect(dropdownItemsBlock).not.toMatch(/品牌與市場/);
    expect(dropdownItemsBlock).not.toMatch(/href: "\/short-video-marketing"/);
  });
});

describe("找形象 dropdown：短影音可點、工廠形象攝影 Coming Soon", () => {
  const source = readSource();
  const brandBlock = source.match(/key: "brand"[\s\S]*?\n  \},/)?.[0] ?? "";

  it("找不到找形象的 HUB_ITEMS 定義時測試本身要先失敗", () => {
    expect(brandBlock.length).toBeGreaterThan(0);
  });

  it("短影音與品牌內容行銷：有真實 href，且不是 disabled", () => {
    const shortVideoMatch = brandBlock.match(/\{\s*\n\s*title: "短影音與品牌內容行銷",[\s\S]*?\n\s*\},/);
    expect(shortVideoMatch, "找不到短影音子項").not.toBeNull();
    const block = shortVideoMatch![0];
    expect(block).toMatch(/href: "\/short-video-marketing"/);
    expect(block).not.toMatch(/disabled: true/);
  });

  it("工廠形象攝影：disabled:true、沒有 href（不得產生可點擊的 /factory-photography 連結）", () => {
    const photographyMatch = brandBlock.match(/\{\s*\n\s*title: "工廠形象攝影",[\s\S]*?\n\s*\},/);
    expect(photographyMatch, "找不到工廠形象攝影子項").not.toBeNull();
    const block = photographyMatch![0];
    expect(block).toMatch(/disabled: true/);
    expect(block).not.toMatch(/href:/);
    expect(block).toMatch(/description: "即將開放"/);
  });

  it("brandBlock 全文都不得出現 /factory-photography 這個可點擊目標（無論以任何欄位形式）", () => {
    expect(brandBlock).not.toMatch(/href: "\/factory-photography"/);
  });
});

describe("桌面版 dropdown 面板渲染邏輯：disabled 子項要顯示、但不可點擊（不再整個被過濾消失）", () => {
  const source = readSource();

  it("hasDropdown 只看是否存在至少一個可導頁子項，但要渲染的 items 是完整 hub.dropdownItems（不是先過濾掉 disabled）", () => {
    expect(source).toMatch(/const items = hub\.dropdownItems;/);
    expect(source).toMatch(/const hasDropdown = items\.some\(\(item\) => item\.href && !item\.disabled\);/);
    // 回歸防護：不能改回「items 本身已經是過濾後結果」的舊寫法，那樣 disabled
    // 子項會整個從選單消失，而不是以「即將開放」狀態顯示。
    expect(source).not.toMatch(/const items = hub\.dropdownItems\.filter\(\(item\) => item\.href && !item\.disabled\);/);
  });

  it("桌面版選單面板對每個子項做 href/disabled 分支：可點的用 <Link>，不可點的用不可互動的 disabled 區塊", () => {
    const panelMatch = source.match(/\{items\.map\(\(item\) =>\s*\n\s*item\.href && !item\.disabled \? \([\s\S]*?\n\s*\)\s*\n\s*\)\}/);
    expect(panelMatch, "找不到桌面版選單面板的 items.map 分支").not.toBeNull();
    const panel = panelMatch![0];
    expect(panel).toMatch(/<Link key=\{item\.title\} href=\{item\.href\} onClick=\{closeHub\}>/);
    expect(panel).toMatch(/aria-disabled="true"/);
    expect(panel).toMatch(/cursor-not-allowed/);
    // disabled 分支不能真的渲染 <Link>/<a> 元素，避免產生指向 undefined/空
    // 字串的假連結——先濾掉整行 `//` 說明性註解再檢查，避免誤判註解散文裡
    // 提到「不是 <Link>」這種文字本身也含有 "<Link" 子字串。
    const disabledBranch = panel
      .slice(panel.indexOf(") : ("))
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(disabledBranch).not.toMatch(/<Link[\s>]/);
    expect(disabledBranch).not.toMatch(/<a[\s>]/);
  });
});

describe("桌機／手機共用同一份 HUB_ITEMS：不是各自硬編碼兩份 dropdown 內容", () => {
  const source = readSource();

  it("整份檔案只有一個 HUB_ITEMS 定義，桌機與手機都直接讀 hub.dropdownItems，沒有第二份平行資料", () => {
    const hubItemsDeclarations = source.match(/const HUB_ITEMS: HubItem\[\] = \[/g) ?? [];
    expect(hubItemsDeclarations.length).toBe(1);
    // 桌機（items.map）與手機（hub.dropdownItems.map）都是直接引用同一個
    // hub.dropdownItems，不是各自另外宣告一份找資源／找形象專屬陣列。
    expect(source).toMatch(/\{items\.map\(\(item\) =>/);
    expect(source).toMatch(/\{hub\.dropdownItems\.map\(\(item\) =>/);
  });

  it("手機版 disabled 子項分支維持既有視覺（opacity-60 + cursor-not-allowed + 非 <Link>），本輪未變更手機邏輯本身", () => {
    expect(source).toMatch(
      /aria-disabled="true"\s*\n\s*className="flex items-start gap-2 py-2 px-3 rounded-lg opacity-60 cursor-not-allowed select-none"/,
    );
  });
});
