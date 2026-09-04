/**
 * 找資源總覽（/resources）的靜態入口契約。
 *
 * 這個頁面是四項企業經營／升級資源服務的單一導覽入口。Final Public Index
 * Release 之後，政府補助／企業財務優化／ISO 與低碳認證／ERP 與產線優化
 * 四項服務全部正式開放（available:true、可索引、進 sitemap），各自的
 * /apply 申請表單仍維持 noindex、不進 sitemap。「短影音與品牌內容行銷」
 * 已正式改分類至找形象（/brand），不再屬於找資源，見
 * server/mainEntriesArchitecture.test.ts 的找形象 Hub 相關測試。
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

  it("Navbar 的找資源主入口重新導向 /resources 總覽頁，下拉同步列出四項正式開放服務的快速連結（OXM Navbar Dropdown — Public Service Entries Fix：反轉先前的 hub-and-spoke-only 決策）", () => {
    // 找資源主入口本身 href="/resources"（點擊直接導頁），下拉選單同步列出
    // /resources 目前四項已正式開放（可索引、進 sitemap）服務的快速連結。
    // 短影音與品牌內容行銷已正式改分類至找形象（/brand），不在找資源下拉。
    const navbar = readSource("client", "src", "components", "Navbar.tsx");
    const resourceHub = navbar.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(resourceHub).toMatch(/href: "\/resources"/);
    for (const href of ["/upgrade-center", "/finance-optimization", "/certification-center", "/erp-optimization"]) {
      expect(resourceHub, `找資源 dropdownItems 應包含 ${href}`).toMatch(new RegExp(`href: "${href.replace(/\//g, "\\/")}"`));
    }
    expect(resourceHub.match(/href: "\/(upgrade-center|finance-optimization|certification-center|erp-optimization|short-video-marketing)"/g)).toHaveLength(4);
    expect(resourceHub).not.toMatch(/href: "\/short-video-marketing"/);
  });

  it("總覽完整提供四項企業經營／升級資源服務的精確路徑，Final Public Index Release 後全部標記為 available（GEO Phase 3A：可見文字/href/available 已抽到 shared/content/resources.ts，與 prerender 腳本共用同一份）", () => {
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
    // 四項服務全部標記 available: true（真正 crawlable 的 <Link>），不再有
    // available: false 的「敬請期待」卡片。
    expect(resourcesContent.match(/available: true/g)).toHaveLength(4);
    expect(resourcesContent).not.toMatch(/available: false/);
    // ResourceCenter.tsx 本身只是把 shared 內容跟 UI-only 的 icon/tone/category 合併，
    // 不再各自維護一份 href/available 字面量。
    expect(resourceCenter).toContain("RESOURCES_CONTENT.services.map");
  });

  it("敬請期待 pattern 仍保留在元件裡（供日後新增未開放服務時沿用），可用的服務一律用 <Link href>", () => {
    expect(resourceCenter).toMatch(/service\.available \? \(/);
    expect(resourceCenter).toMatch(/敬請期待/);
  });

  it("資源總覽不直接呼叫後端或寫入資料", () => {
    expect(resourceCenter).not.toMatch(/\btrpc\b|useMutation|fetch\s*\(/);
  });

  it("Final Public Index Release：三個先前受控的服務 Landing Page 已移除完全隱藏的 robots 限制，改為可索引頁", () => {
    for (const file of ["CertificationCenter.tsx", "ErpOptimization.tsx", "ShortVideoMarketing.tsx"]) {
      expect(readSource("client", "src", "pages", file)).not.toMatch(/noindex, nofollow, noarchive, nosnippet/);
    }
  });

  it("三個服務各自的 /apply 申請表單仍維持完整 noindex 限制，不受 Landing Page 開放索引影響", () => {
    for (const file of ["CertificationCenterApply.tsx", "ErpOptimizationApply.tsx", "ShortVideoMarketingApply.tsx"]) {
      expect(readSource("client", "src", "pages", file)).toMatch(/noindex, nofollow, noarchive, nosnippet/);
    }
  });
});
