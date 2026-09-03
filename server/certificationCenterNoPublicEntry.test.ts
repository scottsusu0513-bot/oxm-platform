/**
 * ISO 與低碳認證專區（/certification-center）— 靜態原始碼契約測試。
 *
 * Final Public Index Release：本頁面已從「隱藏預覽頁」正式轉為公開索引的
 * 服務 Landing Page，加入 sitemap，移除 X-Robots-Tag noindex。唯一沒變的
 * 是導覽入口方式——仍只透過 /resources 資源總覽的服務卡進入（hub-and-spoke
 * 架構），不在 Navbar／首頁／Footer／APP 底部導覽另立與 Hub 同權重的頂層
 * 入口。這裡沿用與 server/industryAndMfgModeConstants.test.ts 相同的手法
 * ——純靜態原始碼字串比對（readFileSync + 字串比對）。
 *
 * 同時確認：路由本身確實存在（能被直接輸入網址開啟）、noindex 只精準套用
 * 在 /certification-center/apply 申請表單，不波及其他頁面。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("/certification-center 沒有資源總覽以外的主要導覽直達連結", () => {
  it("client/src/components/Navbar.tsx 完全沒有 certification-center 連結（含找資源下拉選單也暫時隱藏）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).not.toMatch(/certification-center/i);
  });

  it("client/src/pages/Home.tsx（含首頁 Footer）沒有任何 certification-center 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Home.tsx");
    expect(source).not.toMatch(/certification-center/i);
  });

  it("client/src/components/AppBottomNav.tsx（APP 底部導覽）沒有任何 certification-center 連結或字樣", () => {
    const source = readSource("client", "src", "components", "AppBottomNav.tsx");
    expect(source).not.toMatch(/certification-center/i);
  });

  it("client/src/pages/Search.tsx（工廠搜尋／相關服務推薦）沒有任何 certification-center 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Search.tsx");
    expect(source).not.toMatch(/certification-center/i);
  });
});

describe("/certification-center 正式加入 sitemap（Final Public Index Release），但仍不在 prerender 清單中", () => {
  it("server/_core/index.ts 的 sitemap.xml 產生邏輯含 /certification-center，但不含 /certification-center/apply", () => {
    const source = readSource("server", "_core", "index.ts");
    const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
    const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";
    expect(sitemapSource).toMatch(/\$\{BASE\}\/certification-center/);
    expect(sitemapSource).not.toMatch(/certification-center\/apply/);
  });

  it("server/_core/prerenderedBody.ts 的 PRERENDERED_PAGES 清單沒有 /certification-center（本輪未新增 build-time prerender，索引狀態改變不等於要新增 prerender）", () => {
    const source = readSource("server", "_core", "prerenderedBody.ts");
    expect(source).not.toMatch(/certification-center/i);
  });
});

describe("/certification-center 與 /certification-center/apply 路由本身確實存在（可直接輸入網址開啟）", () => {
  it("client/src/App.tsx 有註冊 /certification-center、/certification-center/apply、/certification-consultant/cases 與 /admin/certification-services 路由", () => {
    const source = readSource("client", "src", "App.tsx");
    expect(source).toMatch(/path="\/certification-center\/apply"/);
    expect(source).toMatch(/path="\/certification-center"/);
    expect(source).toMatch(/path="\/certification-consultant\/cases"/);
    expect(source).toMatch(/path="\/admin\/certification-services"/);
  });
});

describe("noindex／X-Robots-Tag 只套用在 /certification-center/apply 申請表單，不影響 Landing Page 或其他頁面", () => {
  it("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 包含 /certification-center/apply 與 /erp-optimization/apply，但不含 Landing Page 本身", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    const listed = match![1];
    const stringLiterals = listed.match(/"[^"]*"/g) ?? [];
    expect(stringLiterals).toContain('"/certification-center/apply"');
    expect(stringLiterals).toContain('"/erp-optimization/apply"');
    expect(stringLiterals).not.toContain('"/certification-center"');
    expect(stringLiterals).not.toContain('"/erp-optimization"');
    // 需登入的顧問看板不算公開隱藏預覽頁，同 /finance-consultant/cases 慣例，不應列入。
    expect(stringLiterals).not.toContain('"/certification-consultant/cases"');
  });

  it("server/_core/security.ts 沒有把 noindex 套用到整個網站（沒有 \"/\" 這種會匹配全站的萬用路徑）", () => {
    const source = readSource("server", "_core", "security.ts");
    expect(source).not.toMatch(/NOINDEX_EXACT_PATHS[\s\S]{0,200}"\/"/);
  });

  it("client/src/pages/CertificationCenterApply.tsx 有完整的 meta robots 限制", () => {
    const source = readSource("client", "src", "pages", "CertificationCenterApply.tsx");
    expect(source).toMatch(/noindex, nofollow, noarchive, nosnippet/);
  });

  it("client/src/pages/CertificationCenter.tsx（Landing Page 本身）已不再有 meta robots noindex 限制", () => {
    const source = readSource("client", "src", "pages", "CertificationCenter.tsx");
    expect(source).not.toMatch(/<meta name="robots"/);
  });
});

describe("/certification-center/apply 申請表單：需登入、需合格工廠資格、服務選項來自現有目錄、公司資料不可修改", () => {
  const source = readSource("client", "src", "pages", "CertificationCenterApply.tsx");

  it("要求登入（有 useAuth 與登入 gate）", () => {
    expect(source).toMatch(/useAuth/);
    expect(source).toMatch(/請先登入/);
  });

  it("要求工廠通過審核（approved）才能申請", () => {
    expect(source).toMatch(/status === "approved"/);
  });

  it("公司名稱與地址欄位為 readOnly，不可修改", () => {
    const fieldsetMatch = source.match(/公司資料（由 OXM 工廠資料帶入，不可修改）[\s\S]*?<\/fieldset>/);
    expect(fieldsetMatch).toBeTruthy();
    const readOnlyCount = (fieldsetMatch![0].match(/readOnly/g) ?? []).length;
    expect(readOnlyCount).toBe(2);
  });

  it("服務選項來自 trpc.certificationCenter.listServices（現有目錄），不是另建固定清單", () => {
    expect(source).toMatch(/trpc\.certificationCenter\.listServices\.useQuery/);
  });

  it("呼叫 trpc.certificationCenter.submitApplication 送出申請", () => {
    expect(source).toMatch(/trpc\.certificationCenter\.submitApplication\.useMutation/);
  });
});
