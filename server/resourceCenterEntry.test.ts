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

  it("About 的資源相關 CTA 暫時改導向政府補助專區，不再連到 /resources 總覽", () => {
    // /resources 總覽入口暫不公開曝光：About 頁原本「前往找資源」→ /resources
    // 的 CTA 改成「前往政府補助專區」→ /upgrade-center，其餘文案／美術／版型
    // 不變。/resources route／component 本身仍完整保留，只是拿掉這個公開曝光
    // 的連結，已知網址的人仍可直接輸入進入。
    const about = readSource("client", "src", "pages", "AboutOXM.tsx");
    expect(about).toMatch(/action: \{ label: "前往政府補助專區", href: "\/upgrade-center" \}/);
    const resourcesBlock = about.match(/artwork: "resources"[\s\S]*?theme:/)?.[0] ?? "";
    expect(resourcesBlock).not.toMatch(/href: "\/resources"/);
  });

  it("Navbar 的找資源主入口暫時只作下拉觸發器，不導向 /resources，下拉只保留政府補助專區", () => {
    // 公開導覽入口暫時只保留政府補助專區：主入口本身不設 href（點擊只切換
    // 下拉／Accordion，不導頁），其餘四項服務暫時從 dropdownItems 隱藏，但
    // route／component／API／資料庫與既有登入／工廠資格權限限制全部維持不變，
    // 已知網址的人仍可直接輸入進入。/resources 總覽頁 route／component 本身
    // 也完整保留，不受影響。
    const navbar = readSource("client", "src", "components", "Navbar.tsx");
    const resourceHub = navbar.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(resourceHub).not.toMatch(/href: "\/resources"/);
    expect(resourceHub).not.toMatch(/title: "資源服務總覽"/);
    expect(resourceHub.match(/href: "\/(upgrade-center|finance-optimization|certification-center|erp-optimization|short-video-marketing)"/g)).toHaveLength(1);
    expect(resourceHub).toMatch(/href: "\/upgrade-center"/);
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
