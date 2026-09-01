/**
 * Search Console 索引問題修正——sitemap 收錄／排除規則、首頁產業卡連結、
 * /search 篩選網址 noindex 的靜態原始碼契約測試。
 *
 * 沿用 server/certificationCenterNoPublicEntry.test.ts 等既有檔案的手法：
 * 純讀原始碼字串比對（readFileSync + regex），因為 /sitemap.xml 的產生邏輯
 * 直接寫在 server/_core/index.ts 的 startServer() 內部，沒有匯出成獨立可
 * import 的函式，最可靠、最貼近實際部署行為的驗證方式就是確認原始碼本身。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { INDUSTRY_SLUGS } from "@shared/constants";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("sitemap.xml 產生邏輯（server/_core/index.ts）", () => {
  const source = readSource("server", "_core", "index.ts");
  // 只抓 sitemap.xml route handler 本體，避免誤判到檔案其他地方的文字。
  const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
  const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";

  it("sitemap route 本身存在", () => {
    expect(sitemapSource.length).toBeGreaterThan(0);
  });

  it("包含首頁、/upgrade-center、已審核工廠、主產業頁、子產業頁與可公開消息", () => {
    expect(sitemapSource).toContain("${BASE}/`");
    expect(sitemapSource).toContain("${BASE}/upgrade-center");
    expect(sitemapSource).toContain("getApprovedFactoriesForSitemap");
    expect(sitemapSource).toContain("INDUSTRY_SLUGS");
    expect(sitemapSource).toContain("PHASE1_SUB_INDUSTRY_PAGES");
    expect(sitemapSource).toContain("${BASE}/news`");
    expect(sitemapSource).toContain("getPublishedNewsForSitemap");
  });

  it("消息 URL 用真實 updatedAt 當 lastmod，不是寫死 today", () => {
    const newsLoopMatch = sitemapSource.match(/for \(const n of publishedNews\)[\s\S]*?\n {4}\}/);
    expect(newsLoopMatch).toBeTruthy();
    expect(newsLoopMatch![0]).toContain("n.updatedAt");
  });

  it("消息查詢只回傳 status === \"published\"（server/db.ts getPublishedNewsForSitemap）", () => {
    const dbSource = readSource("server", "db.ts");
    const fnMatch = dbSource.match(/export async function getPublishedNewsForSitemap[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    expect(fnMatch![0]).toMatch(/eq\(news\.status,\s*"published"\)/);
  });

  it("只有無參數的 /search（不含任何 ?query 篩選變體）", () => {
    expect(sitemapSource).toContain("${BASE}/search`");
    expect(sitemapSource).not.toMatch(/\/search\?/);
  });

  it("完全沒有三個隱藏服務（ISO／ERP／短影音）的任何路徑", () => {
    expect(sitemapSource).not.toMatch(/certification-center/i);
    expect(sitemapSource).not.toMatch(/erp-optimization/i);
    expect(sitemapSource).not.toMatch(/short-video-marketing/i);
  });

  it("完全沒有登入／會員／收藏／後台／註冊工廠／申請表相關路徑", () => {
    expect(sitemapSource).not.toMatch(/\/admin/);
    expect(sitemapSource).not.toMatch(/\/dashboard/);
    expect(sitemapSource).not.toMatch(/\/favorites/);
    expect(sitemapSource).not.toMatch(/\/member/);
    expect(sitemapSource).not.toMatch(/register-factory/);
    expect(sitemapSource).not.toMatch(/\/apply/);
  });

  it("主產業頁與子產業頁的 entry() 呼叫沒有帶 lastmod（沒有真實逐頁更新時間可查，不得每次都用 today 偽造）", () => {
    const industryLoopMatch = sitemapSource.match(/for \(const slug of Object\.values\(INDUSTRY_SLUGS\)\)[\s\S]*?\n {4}\}/);
    expect(industryLoopMatch).toBeTruthy();
    expect(industryLoopMatch![0]).not.toContain("today");

    const subIndustryLoopMatch = sitemapSource.match(/for \(const \{ industrySlug, subSlug \} of PHASE1_SUB_INDUSTRY_PAGES\)[\s\S]*?\n {4}\}/);
    expect(subIndustryLoopMatch).toBeTruthy();
    expect(subIndustryLoopMatch![0]).not.toContain("today");
  });

  it("已審核工廠頁的 lastmod 用工廠實際 updatedAt，不是寫死 today", () => {
    const factoryLoopMatch = sitemapSource.match(/for \(const f of approved\)[\s\S]*?\n {4}\}/);
    expect(factoryLoopMatch).toBeTruthy();
    expect(factoryLoopMatch![0]).toContain("f.updatedAt");
  });

  it("已審核工廠清單只查 status='approved'（server/db.ts getApprovedFactoriesForSitemap）", () => {
    const dbSource = readSource("server", "db.ts");
    const fnMatch = dbSource.match(/export async function getApprovedFactoriesForSitemap[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    expect(fnMatch![0]).toMatch(/eq\(factories\.status,\s*'approved'\)/);
  });
});

describe("首頁產業卡（client/src/pages/Home.tsx）連到 /industry/{slug}，且是可檢索的 <a href>", () => {
  const source = readSource("client", "src", "pages", "Home.tsx");

  it("匯入 INDUSTRY_SLUGS", () => {
    expect(source).toMatch(/INDUSTRY_SLUGS/);
  });

  it("產業卡格線用 wouter 的 <Link href=\"/industry/...\">，不是只靠 onClick 導頁", () => {
    const gridMatch = source.match(/\{\/\* Industry Grid \*\/\}[\s\S]*?<\/section>/);
    expect(gridMatch).toBeTruthy();
    const gridSource = gridMatch![0];
    expect(gridSource).toMatch(/<Link[^>]*href=\{[^}]*industry\/\$\{slug\}/);
    // 不能整段改回原本「Card 本身用 onClick 導到 /search?industry=」的舊寫法
    // （新寫法允許 slug 查無對應時的安全 fallback 仍指向 /search?industry=，
    // 但主要導頁機制必須是 <Link href>，不能整段只剩 onClick）。
    expect(gridSource).toMatch(/<Link\b/);
  });

  it("每個 INDUSTRY_SLUGS 值在 client/src/App.tsx 都有對應且會回傳內容的路由（/industry/:slug）", () => {
    const appSource = readSource("client", "src", "App.tsx");
    expect(appSource).toMatch(/path="\/industry\/:slug"/);
    // 13 個產業全部共用同一個動態路由，不需要逐一列出 slug，但至少確認
    // INDUSTRY_SLUGS 本身沒有任何空字串（能組出合法網址）。
    for (const slug of Object.values(INDUSTRY_SLUGS)) {
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).not.toMatch(/[^a-z0-9-]/);
    }
  });
});

describe("/search 篩選網址 noindex — client 端（client/src/pages/Search.tsx）", () => {
  const source = readSource("client", "src", "pages", "Search.tsx");

  it("Helmet 用 shared/seo/searchPage.ts 的 buildSearchPageMeta，不是各自重寫一份公式", () => {
    expect(source).toMatch(/import \{ buildSearchPageMeta \} from "@shared\/seo\/searchPage"/);
    expect(source).toMatch(/const searchMeta = buildSearchPageMeta\(canonicalQs\)/);
  });

  it("Helmet 內有自我指向 canonical，且帶篩選參數時輸出 noindex,follow", () => {
    expect(source).toMatch(/<link rel="canonical" href=\{searchMeta\.canonical\}/);
    expect(source).toMatch(/searchMeta\.noindex\s*&&\s*<meta name="robots" content="noindex,follow"/);
  });

  it("canonicalQs 的計算方式跟分享搜尋結果相同的 buildParams（不含 page，只看真正的內容篩選條件）", () => {
    expect(source).toMatch(/const canonicalQs = buildParams\(\{/);
  });

  it("沒有把篩選網址 canonical 到 /industry/ 產業頁（不同內容不能強行合併）", () => {
    const helmetMatch = source.match(/<Helmet>[\s\S]*?<\/Helmet>/);
    expect(helmetMatch).toBeTruthy();
    expect(helmetMatch![0]).not.toMatch(/\/industry\//);
  });
});

describe("/search 篩選網址 noindex — 伺服器端原始 HTML（server/_core/vite.ts）", () => {
  it("dev 與正式站兩條路徑都有 pathname === \"/search\" 的專屬分支，且用同一份 shared/seo/searchPage.ts", () => {
    const source = readSource("server", "_core", "vite.ts");
    expect(source).toMatch(/import \{ buildSearchPageMeta \} from "@shared\/seo\/searchPage"/);
    const searchBranches = source.match(/pathname === "\/search"/g) ?? [];
    // dev（setupVite）與正式站（serveStatic）各一個分支，缺一邊代表其中一條
    // 路徑（本機開發或正式站）會漏掉 server 端 noindex 注入。
    expect(searchBranches.length).toBe(2);
  });

  it("注入時用 searchMeta.noindex 控制 noindex，不是寫死 false（否則篩選網址原始 HTML 永遠不會有 noindex）", () => {
    const source = readSource("server", "_core", "vite.ts");
    const searchBlocks = source.match(/const searchMeta = buildSearchPageMeta\([\s\S]*?noindex: searchMeta\.noindex,/g) ?? [];
    expect(searchBlocks.length).toBe(2);
  });
});

describe("四個隱藏服務仍然沒有進 sitemap、沒有公開導覽入口、維持 noindex（本次 SEO 修正不得順帶公開它們）", () => {
  it("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 仍包含四個隱藏服務首頁與 /apply 頁（正式開站前 Index/Noindex 稽核補上先前漏掉的 /finance-optimization）", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    const stringLiterals = match![1].match(/"[^"]*"/g) ?? [];
    expect(stringLiterals).toContain('"/certification-center"');
    expect(stringLiterals).toContain('"/erp-optimization"');
    expect(stringLiterals).toContain('"/short-video-marketing"');
    expect(stringLiterals).toContain('"/finance-optimization"');
    expect(stringLiterals).toContain('"/finance-optimization/apply"');
  });

  it("client/src/components/Navbar.tsx 沒有任何隱藏服務連結或字樣", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).not.toMatch(/certification-center/i);
    expect(source).not.toMatch(/erp-optimization/i);
    expect(source).not.toMatch(/short-video-marketing/i);
    expect(source).not.toMatch(/finance-optimization/i);
  });

  it("FinanceOptimization.tsx／FinanceOptimizationApply.tsx 的 Helmet 都帶 noindex,nofollow,noarchive,nosnippet（雙層防線的第一層）", () => {
    const page = readSource("client", "src", "pages", "FinanceOptimization.tsx");
    expect(page).toMatch(/<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" \/>/);

    const applyPage = readSource("client", "src", "pages", "FinanceOptimizationApply.tsx");
    const robotsCount = (applyPage.match(/noindex, nofollow, noarchive, nosnippet/g) ?? []).length;
    // 每一個 render 分支（loading／error／各種表單狀態）各自的 Helmet 都要有，
    // 不能只有其中一支分支漏加。
    expect(robotsCount).toBeGreaterThanOrEqual(6);
  });
});
