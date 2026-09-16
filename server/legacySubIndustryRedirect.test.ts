/**
 * SEO route consolidation：舊 Phase 1 子產業頁（/industry/:industry/:subIndustry）
 * 301 永久轉址到新子產業搜尋頁（/factories/:subIndustrySlug）。
 *
 * 涵蓋：
 *   - resolveLegacySubIndustryRedirect 純函式：13 筆合法 mapping、非法子產業
 *     slug、主產業 URL（無 sub）、與這次新增的 72 個子產業裡「不在舊 13 筆
 *     Phase 1 名單內」的其餘子產業（從未有過合法舊網址，不該被轉址）
 *   - server/_core/vite.ts 的 dev／prod 兩處都有正確接上 301（原始碼掃描，
 *     跟 server/regionIndustrySeo.test.ts 對既有 DB-driven 區塊的驗證手法
 *     一致），且不轉發 query string（跟既有 plastic-rubber 那筆轉發 query
 *     的行為刻意不同）
 *   - sitemap：舊 URL 完全移除、主產業頁不受影響（新子產業頁本身的 DB-gated
 *     sitemap 邏輯已在 server/subIndustrySeo.test.ts 驗證過，這裡只做交叉
 *     確認）
 *   - SEO 內容保留：NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT 是 reuse 既有
 *     SUB_INDUSTRY_SEO_CONTENT，不是複製或改寫出來的第二份文案
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveLegacySubIndustryRedirect } from "@shared/seo/industryPages";
import {
  LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG, NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT,
  SUB_INDUSTRY_SEO_CONTENT, SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY,
} from "@shared/constants";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("resolveLegacySubIndustryRedirect：13 筆 Phase 1 合法 mapping（純由既有 constants 推導）", () => {
  it("CNC加工：/industry/metal-processing/cnc-machining → /factories/cnc-machining", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/cnc-machining")).toBe("/factories/cnc-machining");
  });

  it("SMT：/industry/electronics/smt-assembly → /factories/smt-assembly", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/electronics/smt-assembly")).toBe("/factories/smt-assembly");
  });

  it("塑膠射出：/industry/plastic/plastic-injection → /factories/plastic-injection", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/plastic/plastic-injection")).toBe("/factories/plastic-injection");
  });

  it("鈑金：/industry/metal-processing/sheet-metal → /factories/sheet-metal", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/sheet-metal")).toBe("/factories/sheet-metal");
  });

  it("PCB：/industry/electronics/pcb → /factories/pcb", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/electronics/pcb")).toBe("/factories/pcb");
  });

  it("eco-packaging：/industry/packaging/eco-packaging → /factories/eco-packaging", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/packaging/eco-packaging")).toBe("/factories/eco-packaging");
  });

  it("其餘 7 筆（金屬原料、模具製造、包裝印刷、貼紙標籤、保養品化妝品、飲料代工、成衣服飾）同樣正確", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/metal-materials")).toBe("/factories/metal-materials");
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/mold-making")).toBe("/factories/mold-making");
    expect(resolveLegacySubIndustryRedirect("/industry/printing/packaging-print")).toBe("/factories/packaging-print");
    expect(resolveLegacySubIndustryRedirect("/industry/printing/sticker-label")).toBe("/factories/sticker-label");
    expect(resolveLegacySubIndustryRedirect("/industry/chemical-manufacturing/cosmetic-odm")).toBe("/factories/cosmetic-odm");
    expect(resolveLegacySubIndustryRedirect("/industry/food/beverage-oem")).toBe("/factories/beverage-oem");
    expect(resolveLegacySubIndustryRedirect("/industry/textile/apparel-manufacturing")).toBe("/factories/apparel-manufacturing");
  });

  it("完整 13 筆：對 LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG 的每一筆逐一驗證，resolver 輸出跟這張表完全一致", () => {
    expect(Object.keys(LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG).length).toBe(13);
    for (const [legacyKey, newSlug] of Object.entries(LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG)) {
      expect(resolveLegacySubIndustryRedirect(`/industry/${legacyKey}`)).toBe(`/factories/${newSlug}`);
    }
  });

  it("忽略結尾斜線，行為與不帶斜線一致", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/cnc-machining/")).toBe("/factories/cnc-machining");
  });
});

describe("resolveLegacySubIndustryRedirect：不該被誤轉的情況", () => {
  it("合法主產業配上不存在的子產業 slug → null", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/not-real")).toBeNull();
  });

  it("主產業 URL（沒有 sub）→ null，不能被誤判成需要轉址", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing")).toBeNull();
    expect(resolveLegacySubIndustryRedirect("/industry/plastic")).toBeNull();
  });

  it("完全不相干的路徑 → null", () => {
    expect(resolveLegacySubIndustryRedirect("/search")).toBeNull();
    expect(resolveLegacySubIndustryRedirect("/")).toBeNull();
    expect(resolveLegacySubIndustryRedirect("/factory/1")).toBeNull();
  });

  it("已經是新網址 → null（/factories/:slug 不是這個 resolver 該處理的路徑）", () => {
    expect(resolveLegacySubIndustryRedirect("/factories/cnc-machining")).toBeNull();
    expect(resolveLegacySubIndustryRedirect("/factories/taichung/cnc-machining")).toBeNull();
  });

  it("非法主產業 slug 配子產業 → null", () => {
    expect(resolveLegacySubIndustryRedirect("/industry/not-a-real-industry/cnc-machining")).toBeNull();
  });

  it("上一輪新增、但不在舊 13 筆 Phase 1 名單內的子產業（例如「焊接 / 組裝」welding-assembly）從未有過合法舊網址，不該被誤轉", () => {
    // welding-assembly 是本輪上一次任務新增的 72 個子產業搜尋 slug 之一，
    // 但它從來不是 Phase 1 的 13 筆之一——/industry/metal-processing/welding-assembly
    // 這個網址在 301 修正之前跟之後都應該是查無此頁（buildIndustryPageMeta
    // 對不到 SUB_INDUSTRY_SLUG_TO_NAME 就回 404），不應該因為新 slug 系統
    // 存在就被這裡誤轉成看似合法的 301。
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY["welding-assembly"]).toBeDefined();
    expect(resolveLegacySubIndustryRedirect("/industry/metal-processing/welding-assembly")).toBeNull();
  });
});

describe("server/_core/vite.ts：dev（setupVite）與 prod（serveStatic）都正確接上 301，且不轉發 query string", () => {
  const source = readSource("server", "_core", "vite.ts");

  it("import 了 resolveLegacySubIndustryRedirect", () => {
    expect(source).toContain("resolveLegacySubIndustryRedirect");
  });

  it("出現兩次呼叫（dev + prod 各一次），對應既有 resolveLegacyIndustrySlugRedirect 的既有雙處理模式", () => {
    const occurrences = source.match(/resolveLegacySubIndustryRedirect\(pathname\)/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("兩處都緊接著 res.redirect(301, ...) 並 return（在任何 meta 注入之前）", () => {
    const blocks = source.match(/const legacySubIndustryRedirectTarget = resolveLegacySubIndustryRedirect\(pathname\);[\s\S]{0,200}/g) ?? [];
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block).toMatch(/res\.redirect\(301,\s*legacySubIndustryRedirectTarget\)/);
      expect(block).toContain("return;");
    }
  });

  it("不轉發 query string（跟既有 plastic-rubber 轉發 query 的行為刻意不同——這裡的 redirect 呼叫沒有 qs 變數參與）", () => {
    const blocks = source.match(/const legacySubIndustryRedirectTarget = resolveLegacySubIndustryRedirect\(pathname\);[\s\S]{0,200}/g) ?? [];
    for (const block of blocks) {
      expect(block).not.toMatch(/legacySubIndustryRedirectTarget\}\?\$\{qs\}/);
      expect(block).not.toContain("extractQueryString");
    }
  });

  it("兩處都排在既有 resolveLegacyIndustrySlugRedirect 檢查之後、factory/search 等其他處理之前（順序正確，不會被其他分支搶先攔截）", () => {
    const devIdx = source.indexOf("resolveLegacyIndustrySlugRedirect(pathname)");
    const devSubIdx = source.indexOf("resolveLegacySubIndustryRedirect(pathname)");
    const devFactoryIdx = source.indexOf("parseFactoryPath(pathname)");
    expect(devIdx).toBeGreaterThan(-1);
    expect(devSubIdx).toBeGreaterThan(devIdx);
    expect(devFactoryIdx).toBeGreaterThan(devSubIdx);
  });
});

describe("client/src/pages/IndustryPage.tsx：SPA fallback 沿用同一個 resolver（不另建 mapping）", () => {
  const source = readSource("client", "src", "pages", "IndustryPage.tsx");

  it("import 並呼叫 resolveLegacySubIndustryRedirect", () => {
    expect(source).toContain("resolveLegacySubIndustryRedirect");
  });

  it("client 端 navigate 呼叫不帶 searchString（不 preserve query，跟舊主產業 slug fallback 刻意不同）", () => {
    const match = source.match(/const legacySubIndustryTarget = resolveLegacySubIndustryRedirect\(basePath\);[\s\S]{0,150}/);
    expect(match).toBeTruthy();
    expect(match![0]).toMatch(/navigate\(legacySubIndustryTarget,\s*\{\s*replace:\s*true\s*\}\)/);
  });
});

describe("Sitemap：舊 /industry/.../:sub 完全移除，主產業頁不受影響", () => {
  const source = readSource("server", "_core", "index.ts");
  const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
  const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";

  it("PHASE1_SUB_INDUSTRY_PAGES 的舊子產業迴圈已經移除", () => {
    expect(sitemapSource).not.toContain("PHASE1_SUB_INDUSTRY_PAGES");
    expect(sitemapSource).not.toMatch(/for \(const \{ industrySlug, subSlug \}/);
  });

  it("主產業頁迴圈（INDUSTRY_SLUGS）完全不變", () => {
    expect(sitemapSource).toMatch(/for \(const slug of Object\.values\(INDUSTRY_SLUGS\)\)/);
    expect(sitemapSource).toMatch(/\$\{BASE\}\/industry\/\$\{slug\}/);
  });

  it("新的全台子產業／地區×子產業 DB-gated sitemap 區塊存在（沿用上一輪既有邏輯，本輪沒有改動）", () => {
    expect(sitemapSource).toContain("getApprovedIndustrySubIndustryCombosForSitemap");
    expect(sitemapSource).toContain("getApprovedRegionIndustrySubIndustryCombosForSitemap");
  });
});

describe("SEO 內容保留：NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT 是 reuse，不是複製或改寫", () => {
  it("cnc-machining 的內容跟舊 SUB_INDUSTRY_SEO_CONTENT[\"metal-processing/cnc-machining\"] 逐字相同（同一個物件參照）", () => {
    const legacy = SUB_INDUSTRY_SEO_CONTENT["metal-processing/cnc-machining"];
    expect(NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT["cnc-machining"]).toBe(legacy);
  });

  it("smt-assembly 的內容跟舊 SUB_INDUSTRY_SEO_CONTENT[\"electronics/smt-assembly\"] 逐字相同", () => {
    const legacy = SUB_INDUSTRY_SEO_CONTENT["electronics/smt-assembly"];
    expect(NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT["smt-assembly"]).toBe(legacy);
  });

  it("全部 13 筆都是同一個物件參照（不是深拷貝出來的第二份）", () => {
    for (const [legacyKey, newSlug] of Object.entries(LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG)) {
      expect(NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT[newSlug]).toBe(SUB_INDUSTRY_SEO_CONTENT[legacyKey]);
    }
  });

  it("沒有舊內容的子產業（例如 welding-assembly）查不到，新頁行為應維持現狀（component 端用 && 短路，不會 render 這個區塊）", () => {
    expect(NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT["welding-assembly"]).toBeUndefined();
  });
});

describe("client/src/pages/SubIndustryPage.tsx：正確 reuse 內容並附加渲染", () => {
  const source = readSource("client", "src", "pages", "SubIndustryPage.tsx");

  it("import 了 NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT，沒有另外複製一份 SUB_INDUSTRY_SEO_CONTENT 或自己重新宣告文案物件", () => {
    expect(source).toContain("NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT");
    expect(source).not.toContain("SUB_INDUSTRY_SEO_CONTENT[");
  });

  it("SEO 內容區塊有條件渲染（legacySeoContent &&），不影響既有 title/description/H1/intro 的 Helmet 區塊", () => {
    expect(source).toMatch(/\{legacySeoContent && \(/);
    // 既有 content.title／content.description／content.h1／content.intro 完全不受影響
    expect(source).toContain("content.title");
    expect(source).toContain("content.description");
    expect(source).toContain("content.h1");
    expect(source).toContain("content.intro");
  });
});
