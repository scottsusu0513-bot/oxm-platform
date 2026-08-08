/**
 * 找資源總覽（/resources）的靜態入口契約。
 *
 * 這個頁面是五項既有企業服務的單一導覽入口；ISO、ERP、短影音三個服務雖可
 * 由此進入，原有 noindex／noarchive、sitemap 與 prerender 限制仍維持不變。
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

  it("About 的找資源 CTA 先導向資源總覽，不再預設政府補助專區", () => {
    const about = readSource("client", "src", "pages", "AboutOXM.tsx");
    expect(about).toMatch(/action: \{ label: "前往找資源", href: "\/resources" \}/);
    const resourcesBlock = about.match(/artwork: "resources"[\s\S]*?theme:/)?.[0] ?? "";
    expect(resourcesBlock).not.toMatch(/href: "\/upgrade-center"/);
  });

  it("Navbar 的找資源主入口導向 /resources，下拉不重複放資源總覽", () => {
    const navbar = readSource("client", "src", "components", "Navbar.tsx");
    const resourceHub = navbar.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(resourceHub).toMatch(/href: "\/resources"/);
    expect(resourceHub).not.toMatch(/title: "資源服務總覽"/);
    expect(resourceHub.match(/href: "\/(upgrade-center|finance-optimization|certification-center|erp-optimization|short-video-marketing)"/g)).toHaveLength(5);
  });

  it("總覽完整提供五項既有服務的精確路徑", () => {
    for (const href of [
      "/upgrade-center",
      "/finance-optimization",
      "/certification-center",
      "/erp-optimization",
      "/short-video-marketing",
    ]) {
      expect(resourceCenter).toContain(`href: "${href}"`);
    }
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
