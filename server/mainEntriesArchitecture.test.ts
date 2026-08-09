/**
 * 七大主入口 SEO 架構＋未開放專區 Coming Soon 頁——靜態原始碼契約測試，
 * 沿用 server/certificationCenterNoPublicEntry.test.ts 等既有檔案的手法：
 * 純讀原始碼字串比對（readFileSync + regex）。
 *
 * 涵蓋範圍：
 * - Navbar 右側六個功能入口順序（找工廠／找資源／找人才／找形象／找消息／
 *   找討論）與各入口的可進入性（全部不再有「鎖定、點擊沒反應」的入口）；
 *   關於OXM 改放在左上角 OXM 品牌下拉選單（首頁／關於OXM），不在 HUB_ITEMS 內
 * - 找人才／找形象／找討論的 Coming Soon 頁：route 註冊或既有 route 沿用、
 *   共用元件、noindex,follow
 * - sitemap／noindex 一致性：/resources 可索引且在 sitemap 內；/talent、
 *   /brand、/community（找討論）noindex 且不在 sitemap 內
 * - shared/seo/publicPages.ts 的 title／description／canonical 設定
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getPublicPageSeoByPath } from "@shared/seo/publicPages";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("Navbar 主要入口順序與可進入性（client/src/components/Navbar.tsx）", () => {
  const source = readSource("client", "src", "components", "Navbar.tsx");
  const hubItemsMatch = source.match(/const HUB_ITEMS: HubItem\[\] = \[[\s\S]*?\n\];/);
  const hubItemsSource = hubItemsMatch ? hubItemsMatch[0] : "";

  it("HUB_ITEMS 存在，且六個功能入口依序為 找工廠／找資源／找人才／找形象／找消息／找討論（關於OXM 不在其中）", () => {
    expect(hubItemsSource.length).toBeGreaterThan(0);
    const keys = [...hubItemsSource.matchAll(/key: "(\w+)"/g)].map(m => m[1]);
    expect(keys).toEqual(["factory", "resource", "talent", "brand", "news", "discussion"]);
  });

  it("關於OXM 已移出 HUB_ITEMS，改放在左上角 OXM 品牌下拉選單，跟首頁同一份 dropdown，不是重建第二套", () => {
    expect(hubItemsSource).not.toMatch(/key: "about"/);
    const brandMenuMatch = source.match(/\{brandMenuOpen && brandMenuPos && createPortal\([\s\S]*?document\.body\s*\)\}/);
    expect(brandMenuMatch, "找不到 OXM 品牌下拉選單區塊").not.toBeNull();
    const brandMenu = brandMenuMatch![0];
    expect(brandMenu).toMatch(/<Link href="\/" onClick=\{\(\) => setBrandMenuOpen\(false\)\}>/);
    expect(brandMenu).toMatch(/首頁/);
    expect(brandMenu).toMatch(/<Link href="\/about" onClick=\{\(\) => setBrandMenuOpen\(false\)\}>/);
    expect(brandMenu).toMatch(/關於 OXM/);
  });

  it("Navbar 右側不再有獨立的「關於 OXM」主導航按鈕", () => {
    expect(source).not.toMatch(/short: "關於 OXM"/);
  });

  it("找人才：soon:false（不再鎖定），下拉有真實連結到 /talent", () => {
    const block = hubItemsSource.match(/key: "talent"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(block).toMatch(/soon: false/);
    expect(block).toMatch(/href: "\/talent"/);
    expect(block).not.toMatch(/disabled: true/);
  });

  it("找形象：soon:false（不再鎖定），下拉有真實連結到 /brand", () => {
    const block = hubItemsSource.match(/key: "brand"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(block).toMatch(/soon: false/);
    expect(block).toMatch(/href: "\/brand"/);
    expect(block).not.toMatch(/disabled: true/);
  });

  it("找討論：soon:false（不再鎖定），下拉有真實連結到既有 /community route（不是新建的重複 route）", () => {
    const block = hubItemsSource.match(/key: "discussion"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(block).toMatch(/soon: false/);
    expect(block).toMatch(/href: "\/community"/);
    expect(block).not.toMatch(/disabled: true/);
  });

  it("找工廠主入口直接導向 /search（真正的搜尋功能頁），不是品牌首頁 \"/\"；dropdownItems 刻意留空，不與主 href 重複", () => {
    const factoryBlock = hubItemsSource.match(/key: "factory"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(factoryBlock).toMatch(/href: "\/search"/);
    expect(factoryBlock).toMatch(/soon: false/);
    expect(factoryBlock).toMatch(/dropdownItems: \[\],/);
    expect(factoryBlock).not.toMatch(/搜尋工廠/);
  });

  it("找消息：既有已開放入口，本輪未變更其 href／soon 狀態", () => {
    const newsBlock = hubItemsSource.match(/key: "news"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(newsBlock).toMatch(/soon: false/);
    expect(newsBlock).toMatch(/href: "\/news"/);
  });

  it("桌機與手機共用同一份 HUB_ITEMS／dropdownItems 資料來源（不是各自硬編碼兩份文案）", () => {
    const desktopUsage = source.match(/HUB_ITEMS\.map\(\(hub\)/g) ?? [];
    expect(desktopUsage.length).toBe(2); // 桌機一次、手機一次
  });

  it("手機版有 href 但沒有真正下拉子項的入口（找工廠）改用獨立 <Link> 分支，不會展開空白手風琴面板", () => {
    // 手機版 accordion 觸發鈕原本不看 hub.href，一律只切換展開狀態；若某個
    // hub 的 dropdownItems 是空陣列，沿用原本邏輯會展開出一個永遠是空的面板，
    // 使用者永遠點不到目的地。找工廠改成 href="/search" + dropdownItems: []
    // 後，必須改用這個獨立分支直接導頁，不能只沿用桌機那套判斷式。
    expect(source).toMatch(/const hasDropdown = hubHasDropdown\(hub\);/);
    expect(source).toMatch(/if \(!hasDropdown && hub\.href\) \{/);
    const directLinkBranchMatch = source.match(/if \(!hasDropdown && hub\.href\) \{[\s\S]*?\n {14}\}/);
    expect(directLinkBranchMatch, "找不到手機版直接連結分支").not.toBeNull();
    expect(directLinkBranchMatch![0]).toMatch(/<Link\s*\n\s*key=\{hub\.key\}\s*\n\s*href=\{hub\.href\}/);
  });
});

describe("找人才／找形象 Coming Soon 頁", () => {
  it("App.tsx 註冊 /talent、/brand 兩條路由", () => {
    const app = readSource("client", "src", "App.tsx");
    expect(app).toMatch(/path="\/talent" component=\{Talent\}/);
    expect(app).toMatch(/path="\/brand" component=\{Brand\}/);
  });

  it("Talent.tsx／Brand.tsx 共用同一個 SectionComingSoon 元件，不是各自複製一套版面", () => {
    const talent = readSource("client", "src", "pages", "Talent.tsx");
    const brand = readSource("client", "src", "pages", "Brand.tsx");
    expect(talent).toMatch(/import \{ SectionComingSoon \} from "@\/components\/SectionComingSoon"/);
    expect(brand).toMatch(/import \{ SectionComingSoon \} from "@\/components\/SectionComingSoon"/);
    expect(fs.existsSync(path.resolve(import.meta.dirname, "..", "client", "src", "components", "SectionComingSoon.tsx"))).toBe(true);
  });

  it("SectionComingSoon 元件內含 Navbar（品牌視覺延續）、返回首頁按鈕與狀態徽章", () => {
    const component = readSource("client", "src", "components", "SectionComingSoon.tsx");
    expect(component).toMatch(/<Navbar \/>/);
    expect(component).toMatch(/返回首頁/);
    expect(component).toMatch(/準備開放中・敬請期待/);
  });

  it("Talent.tsx／Brand.tsx 的 Helmet 帶 noindex,follow（不是完全 nofollow，也不是直接可索引）", () => {
    const talent = readSource("client", "src", "pages", "Talent.tsx");
    const brand = readSource("client", "src", "pages", "Brand.tsx");
    expect(talent).toMatch(/<meta name="robots" content="noindex,follow" \/>/);
    expect(brand).toMatch(/<meta name="robots" content="noindex,follow" \/>/);
  });

  it("server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS 含 /talent、/brand、/community，且 header 值是 noindex, follow（不是完全隱藏頁那組 nofollow/noarchive/nosnippet）", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_FOLLOW_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    const paths = match![1].match(/"[^"]*"/g) ?? [];
    expect(paths).toContain('"/talent"');
    expect(paths).toContain('"/brand"');
    expect(paths).toContain('"/community"');
    expect(source).toMatch(/res\.setHeader\("X-Robots-Tag", "noindex, follow"\)/);
  });

  it("Talent.tsx／Brand.tsx 都有可回到已開放功能的第二顆 CTA（先找工廠）", () => {
    const talent = readSource("client", "src", "pages", "Talent.tsx");
    const brand = readSource("client", "src", "pages", "Brand.tsx");
    expect(talent).toMatch(/secondaryCta=\{\{ label: "先找工廠", href: "\/search" \}\}/);
    expect(brand).toMatch(/secondaryCta=\{\{ label: "先找工廠", href: "\/search" \}\}/);
  });
});

describe("找討論 Coming Soon 頁：沿用既有 /community route，不建立重複的第二條 route", () => {
  it("App.tsx 沒有新建 /discussion 或其他重複概念的 route，/community 仍是唯一入口", () => {
    const app = readSource("client", "src", "App.tsx");
    expect(app).not.toMatch(/path="\/discussion"/);
    expect(app).toMatch(/path="\/community\/\*\?" component=\{Community\}/);
  });

  it("Navbar 找討論下拉連到 /community，不是自建的新路徑", () => {
    const navbar = readSource("client", "src", "components", "Navbar.tsx");
    const block = navbar.match(/key: "discussion"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(block).toMatch(/href: "\/community"/);
  });

  it("CommunityComingSoon.tsx 改用共用的 SectionComingSoon 元件，不是自己另一套版面", () => {
    const component = readSource("client", "src", "components", "community", "CommunityComingSoon.tsx");
    expect(component).toMatch(/import \{ SectionComingSoon \} from "@\/components\/SectionComingSoon"/);
    expect(component).toMatch(/title="找討論"/);
    expect(component).toMatch(/tagline="讓傳統產業經驗、問題與合作需求有地方交流"/);
    expect(component).toMatch(/secondaryCta=\{\{ label: "先找工廠", href: "\/search" \}\}/);
  });

  it("找討論 Coming Soon 文案沒有宣稱目前已經可以發文／留言／建立討論／參與社群", () => {
    const component = readSource("client", "src", "components", "community", "CommunityComingSoon.tsx");
    const comingSoonBlock = component.slice(component.indexOf("// 找討論主入口的"));
    expect(comingSoonBlock).not.toMatch(/可以發文|可以留言|可以建立討論|可以參與/);
  });

  it("找討論 Coming Soon 的 Helmet 帶 noindex,follow，title／canonical 正確", () => {
    const component = readSource("client", "src", "components", "community", "CommunityComingSoon.tsx");
    expect(component).toMatch(/<title>找討論｜傳統產業交流與企業討論｜OXM<\/title>/);
    expect(component).toMatch(/<link rel="canonical" href="https:\/\/www\.oxmmatch\.com\/community" \/>/);
    expect(component).toMatch(/<meta name="robots" content="noindex,follow" \/>/);
  });

  it("既有的 canAccessCommunity 權限判斷與維護模式（maintenance）分支本輪未被刪除或改動邏輯", () => {
    const component = readSource("client", "src", "components", "community", "CommunityComingSoon.tsx");
    expect(component).toMatch(/function resolveView/);
    expect(component).toMatch(/view === "maintenance"/);
    expect(component).toMatch(/系統維護中，請稍後再試/);

    const communityPage = readSource("client", "src", "pages", "Community.tsx");
    expect(communityPage).toMatch(/function canAccessCommunity/);
    expect(communityPage).toMatch(/COMMUNITY_FEATURE_STATUS/);
  });

  it("本輪沒有新增任何討論相關的 DB／API／發文／留言／按讚／收藏／通知／moderation 程式碼", () => {
    // 只檢查本輪實際修改的檔案清單，確認沒有新的 schema／router 變更被混入。
    const schemaSource = readSource("drizzle", "schema.ts");
    expect(schemaSource).not.toMatch(/discussionPosts|discussionComments|discussionLikes/);
  });
});

describe("sitemap／noindex 一致性（server/_core/index.ts、server/_core/security.ts）", () => {
  const sitemapSource = readSource("server", "_core", "index.ts").match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/)?.[0] ?? "";

  it("sitemap 包含 /resources（內容完整、非 thin page，維持可索引）", () => {
    expect(sitemapSource).toMatch(/\$\{BASE\}\/resources/);
  });

  it("sitemap 不包含 /talent、/brand 或 /community（noindex 頁面不送入 sitemap，避免矛盾訊號）", () => {
    expect(sitemapSource).not.toMatch(/\$\{BASE\}\/talent/);
    expect(sitemapSource).not.toMatch(/\$\{BASE\}\/brand/);
    expect(sitemapSource).not.toMatch(/\$\{BASE\}\/community/);
  });

  it("sitemap 仍包含既有六大入口相關頁面：/about、/news、/upgrade-center、/search", () => {
    expect(sitemapSource).toMatch(/\$\{BASE\}\/about/);
    expect(sitemapSource).toMatch(/\$\{BASE\}\/news`/);
    expect(sitemapSource).toMatch(/\$\{BASE\}\/upgrade-center/);
    expect(sitemapSource).toMatch(/\$\{BASE\}\/search`/);
  });

  it("sitemap 沒有因為本輪調整就把產業分類頁移除（禁止誤傷產業 SEO）", () => {
    expect(sitemapSource).toMatch(/INDUSTRY_SLUGS/);
    expect(sitemapSource).toMatch(/PHASE1_SUB_INDUSTRY_PAGES/);
  });
});

describe("shared/seo/publicPages.ts：找消息／找資源／找人才／找形象／找討論的 title／description／canonical", () => {
  it("getPublicPageSeoByPath 對五個新／更新路徑回傳正確的 title 與自我 canonical", () => {
    const news = getPublicPageSeoByPath("/news");
    expect(news?.title).toBe("找消息｜台灣製造業與傳統產業情報｜OXM");
    expect(news?.canonical).toBe("https://www.oxmmatch.com/news");

    const resources = getPublicPageSeoByPath("/resources");
    expect(resources?.title).toBe("找資源｜企業升級與傳統產業專業資源｜OXM");
    expect(resources?.canonical).toBe("https://www.oxmmatch.com/resources");

    const talent = getPublicPageSeoByPath("/talent");
    expect(talent?.title).toBe("找人才｜傳統產業人才媒合｜OXM");
    expect(talent?.canonical).toBe("https://www.oxmmatch.com/talent");

    const brand = getPublicPageSeoByPath("/brand");
    expect(brand?.title).toBe("找形象｜企業品牌與數位形象資源｜OXM");
    expect(brand?.canonical).toBe("https://www.oxmmatch.com/brand");

    const discussion = getPublicPageSeoByPath("/community");
    expect(discussion?.title).toBe("找討論｜傳統產業交流與企業討論｜OXM");
    expect(discussion?.canonical).toBe("https://www.oxmmatch.com/community");
  });

  it("既有的首頁／關於OXM／企業升級中心設定本輪未被誤改", () => {
    const home = getPublicPageSeoByPath("/");
    expect(home?.title).toBe("OXM｜台灣工廠媒合與傳統產業數位資源平台");

    const about = getPublicPageSeoByPath("/about");
    expect(about?.title).toBe("關於 OXM｜台灣傳統產業數位資源平台");

    const upgradeCenter = getPublicPageSeoByPath("/upgrade-center");
    expect(upgradeCenter?.title).toBe("企業升級中心｜OXM");
  });

  it("News.tsx 的 client 端 title 與 shared/seo/publicPages.ts 的伺服器端設定一致（避免掛載前後 title 不一致）", () => {
    const newsSource = readSource("client", "src", "pages", "News.tsx");
    expect(newsSource).toMatch(/const pageTitle = "找消息｜台灣製造業與傳統產業情報｜OXM"/);
    expect(newsSource).toMatch(/useRemoveServerSeoHead\(\)/);
  });

  it("ResourceCenter.tsx／News.tsx 都呼叫 useRemoveServerSeoHead，避免伺服器注入節點與 Helmet 節點重複", () => {
    const resourceCenter = readSource("client", "src", "pages", "ResourceCenter.tsx");
    expect(resourceCenter).toMatch(/useRemoveServerSeoHead\(\)/);
  });
});

describe("本輪調整不影響管理員後台、顧問中心與既有找工廠搜尋功能", () => {
  it("App.tsx 的 /admin、/consultant-center route registrations 仍然存在，未被移動或刪除", () => {
    const app = readSource("client", "src", "App.tsx");
    expect(app).toMatch(/path="\/admin" component=\{AdminDashboard\}/);
    expect(app).toMatch(/path="\/consultant-center" component=\{ConsultantHub\}/);
  });

  it("Navbar.tsx 沒有改動 /search 路由本身的存在（找工廠 hub 下拉仍連到 /search）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    const factoryBlock = source.match(/key: "factory"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(factoryBlock).toMatch(/href: "\/search"/);
  });
});
