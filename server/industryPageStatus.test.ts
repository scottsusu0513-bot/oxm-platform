/**
 * /industry/:slug(/:sub) 的失效頁 SEO 稽核修正 — 真實 HTTP 狀態與 metadata。
 *
 * 背景：這一輪稽核發現 buildIndustryPageMeta（shared/seo/industryPages.ts）
 * 對不到任何已知主／子產業 slug 時回傳 null 完全正確，但呼叫端
 * server/_core/vite.ts 在 null 時直接落到「固定公開頁／SPA fallback」分支，
 * 一律回 200 + 全站通用 index.html 內容，沒有 noindex、也沒有專屬 canonical
 * ——這正是 buildFactoryMeta 在 server/factoryPageStatus.test.ts 修正前的同一種
 * 軟式 404（200 狀態碼，但內容跟「這裡沒有東西」沒有兩樣），實際在正式站
 * 對 /industry/does-not-exist-xyz、/industry/chemical-manufacturing/
 * does-not-exist-xyz 這兩種情況（分別是無效主產業 slug、有效主產業配上不存在
 * 的子產業）驗證過都是 200（見任務回報）。
 *
 * 這裡驗證修正後的行為：新增的 buildIndustryMeta()（server/_core/ogMeta.ts）
 * 把「industryPath 對得到路由形狀，但 slug／subSlug 解析不出任何已知產業」
 * 統一轉成真正的 404 + noindex，且沿用 buildFactoryMeta 已驗證過的既有
 * NotFound 慣例：canonical 仍自我指向請求網址本身，不導向首頁。有效組合則
 * 維持 200 + index + 專屬 title/description/canonical，不受影響。
 */
import { describe, expect, it } from "vitest";
import { buildIndustryMeta, injectMetaIntoHtml } from "./_core/ogMeta";

describe("buildIndustryMeta：無效主產業 slug → 404 + noindex（不是 200 + 通用 fallback）", () => {
  it("完全不存在的主產業 slug", () => {
    const meta = buildIndustryMeta({ slug: "does-not-exist-xyz" }, undefined, "/industry/does-not-exist-xyz");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("已退休、沒有 resolveLegacyIndustrySlugRedirect 對應項的舊 slug（plastic-rubber 本身有轉址表項目，這裡用一個完全沒有對應項的假舊 slug 模擬真正退休的情況）", () => {
    const meta = buildIndustryMeta({ slug: "retired-legacy-slug" }, undefined, "/industry/retired-legacy-slug");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildIndustryMeta：有效主產業 slug 配上不存在的子產業 → 404 + noindex", () => {
  it("chemical-manufacturing 底下不存在的子產業 slug", () => {
    const meta = buildIndustryMeta(
      { slug: "chemical-manufacturing", subSlug: "does-not-exist-xyz" },
      undefined,
      "/industry/chemical-manufacturing/does-not-exist-xyz"
    );
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildIndustryMeta：404 fallback 內容與 canonical 慣例", () => {
  it("404 fallback title/description 使用全站通用『查無內容』文案，不洩漏是哪種失效原因", () => {
    const meta = buildIndustryMeta({ slug: "does-not-exist-xyz" }, undefined, "/industry/does-not-exist-xyz");
    expect(meta.title).toContain("OXM");
    expect(meta.description.length).toBeGreaterThan(0);
  });

  it("即使 noindex，canonical 仍自我指向請求網址本身（不導向首頁），沿用 buildFactoryMeta 既有慣例", () => {
    const meta = buildIndustryMeta({ slug: "does-not-exist-xyz" }, undefined, "/industry/does-not-exist-xyz");
    expect(meta.url).toBe("https://www.oxmmatch.com/industry/does-not-exist-xyz");

    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain('<link rel="canonical" href="https://www.oxmmatch.com/industry/does-not-exist-xyz">');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});

describe("buildIndustryMeta：有效組合維持 200 + index + 專屬 metadata（不受這次 404 修正影響）", () => {
  it("有效主產業 slug → 200，noindex 為 false，title 是專屬內容", () => {
    const meta = buildIndustryMeta({ slug: "chemical-manufacturing" }, undefined, "/industry/chemical-manufacturing");
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
    expect(meta.url).toBe("https://www.oxmmatch.com/industry/chemical-manufacturing");
  });

  it("有效主產業 + 有效子產業 slug（Phase 1）→ 200，canonical 正確", () => {
    const meta = buildIndustryMeta(
      { slug: "chemical-manufacturing", subSlug: "cosmetic-odm" },
      undefined,
      "/industry/chemical-manufacturing/cosmetic-odm"
    );
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
    expect(meta.url).toBe("https://www.oxmmatch.com/industry/chemical-manufacturing/cosmetic-odm");
  });

  it("有效組合注入後的 HTML 沒有 robots noindex，且 canonical 自我指向", () => {
    const meta = buildIndustryMeta({ slug: "chemical-manufacturing" }, undefined, "/industry/chemical-manufacturing");
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('<link rel="canonical" href="https://www.oxmmatch.com/industry/chemical-manufacturing">');
  });

  it("Pagination page 參數對有效主產業頁仍正確運作（不受 404 分支影響）", () => {
    const meta = buildIndustryMeta({ slug: "industrial-machinery" }, 2, "/industry/industrial-machinery");
    expect(meta.status).toBe(200);
    expect(meta.url).toBe("https://www.oxmmatch.com/industry/industrial-machinery?page=2");
  });
});

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
