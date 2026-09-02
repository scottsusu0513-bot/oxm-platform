/**
 * 找資源總覽（/resources）的靜態入口契約。
 *
 * 這個頁面是四項企業經營／升級資源服務的單一導覽入口；ISO、ERP 兩個服務雖可
 * 由此進入，原有 noindex／noarchive、sitemap 與 prerender 限制仍維持不變。
 * 「短影音與品牌內容行銷」已正式改分類至找形象（/brand），不再屬於找資源，
 * 見 server/mainEntriesArchitecture.test.ts 的找形象 Hub 相關測試。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("/resources 找資源總覽入口", () => {
  const resourceCenter = readSource("client", "src", "pages", "ResourceCenter.tsx");

  it("App 註冊 /resources 路由", () => {
    expect(readSource("client", "src", "App.tsx")).toMatch(/path="\/resources" component=\{ResourceCenter\}/);
  });

  it("About 六大服務的「找資源」導向 /resources 總覽（GEO Phase 2：主入口語意層級須與特定子服務區分，不可用 /upgrade-center 取代整體找資源）", () => {
    const about = readSource("client", "src", "pages", "AboutOXM.tsx");
    expect(about).toMatch(/action: \{ label: "前往找資源總覽", href: "\/resources" \}/);
  });

  it("About 頁尾 CTA 仍可指向特定子服務（政府補助／企業升級中心），與六大服務主入口語意層級不同", () => {
    const aboutContent = readSource("shared", "content", "about.ts");
    expect(aboutContent).toMatch(/href: "\/upgrade-center"/);
  });

  it("Navbar 的找資源主入口重新導向 /resources 總覽頁，下拉額外提供政府補助專區快速連結", () => {
    // 六大主入口架構調整：找資源重新成為真實可進入的主入口，主入口本身
    // href="/resources"（點擊直接導頁），下拉選單額外提供目前唯一已開放子
    // 服務「政府補助專區」的快速連結。/resources 頁面本身列出的另外四項
    // 服務目前是不可互動的「敬請期待」卡片（見 ResourceCenter.tsx 的
    // available 欄位），對應 route／component／API／資料庫與既有登入／工廠
    // 資格權限限制維持不變，已知網址的人仍可直接輸入進入。
    const navbar = readSource("client", "src", "components", "Navbar.tsx");
    const resourceHub = navbar.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(resourceHub).toMatch(/href: "\/resources"/);
    expect(resourceHub).toMatch(/href: "\/upgrade-center"/);
    expect(resourceHub.match(/href: "\/(upgrade-center|finance-optimization|certification-center|erp-optimization|short-video-marketing)"/g)).toHaveLength(1);
  });

  it("總覽完整提供四項企業經營／升級資源服務的精確路徑，但只有政府補助專區標記為 available（GEO Phase 3A：可見文字/href/available 已抽到 shared/content/resources.ts，與 prerender 腳本共用同一份）", () => {
    const resourcesContent = readSource("shared", "content", "resources.ts");
    for (const href of [
      "/upgrade-center",
      "/finance-optimization",
      "/certification-center",
      "/erp-optimization",
    ]) {
      expect(resourcesContent).toContain(`href: "${href}"`);
    }
    // 「短影音與品牌內容行銷」不再屬於找資源，改歸類找形象（/brand）。
    expect(resourcesContent).not.toContain('href: "/short-video-marketing"');
    // 只有第一項（政府補助與企業升級）標記 available: true，其餘三項
    // available: false（卡片顯示「敬請期待」，不可點擊，但 route／component
    // 仍完整保留，已知網址的人仍可直接輸入進入）。
    expect(resourcesContent.match(/available: true/g)).toHaveLength(1);
    expect(resourcesContent.match(/available: false/g)).toHaveLength(3);
    // ResourceCenter.tsx 本身只是把 shared 內容跟 UI-only 的 icon/tone/category 合併，
    // 不再各自維護一份 href/available 字面量。
    expect(resourceCenter).toContain("RESOURCES_CONTENT.services.map");
  });

  it("敬請期待卡片不是 <Link>，可用的服務才用 <Link href>", () => {
    expect(resourceCenter).toMatch(/service\.available \? \(/);
    expect(resourceCenter).toMatch(/敬請期待/);
  });

  it("資源總覽不直接呼叫後端或寫入資料", () => {
    expect(resourceCenter).not.toMatch(/\btrpc\b|useMutation|fetch\s*\(/);
  });

  it("三個受控服務仍保有完整 robots 保護", () => {
    for (const file of ["CertificationCenter.tsx", "ErpOptimization.tsx", "ShortVideoMarketing.tsx"]) {
      expect(readSource("client", "src", "pages", file)).toMatch(/noindex, nofollow, noarchive, nosnippet/);
    }
  });
});
