/**
 * /industry/:slug 與 /industry/:slug/:sub 的伺服器端初始 HTML metadata。
 *
 * 背景：修正前這兩種路由完全沒有伺服器端 meta 注入，正式站原始 HTML（未
 * 執行 JS 前，Googlebot 第一次抓取拿到的內容）一律是全站通用的
 * <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>，且完全
 * 沒有 <link rel="canonical">——13 個主產業頁＋所有子產業頁的原始 HTML
 * title/description 彼此完全相同，容易被 Google 判斷為重複頁面。這裡驗證
 * buildIndustryPageMeta／parseIndustryPath（純資料查表，不查 DB，供
 * server/_core/vite.ts 使用）與 injectMetaIntoHtml 共同運作後的結果。
 */
import { describe, expect, it } from "vitest";
import { parseIndustryPath, buildIndustryPageMeta } from "@shared/seo/industryPages";
import { injectMetaIntoHtml, DEFAULT_OG_IMAGE } from "./_core/ogMeta";
import { INDUSTRY_SLUGS, PHASE1_SUB_INDUSTRY_PAGES } from "@shared/constants";

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

describe("parseIndustryPath", () => {
  it("解析主產業路徑", () => {
    expect(parseIndustryPath("/industry/chemical-manufacturing")).toEqual({ slug: "chemical-manufacturing", subSlug: undefined });
  });

  it("解析子產業路徑", () => {
    expect(parseIndustryPath("/industry/metal-processing/cnc-machining")).toEqual({ slug: "metal-processing", subSlug: "cnc-machining" });
  });

  it("忽略結尾斜線", () => {
    expect(parseIndustryPath("/industry/chemical-manufacturing/")).toEqual({ slug: "chemical-manufacturing", subSlug: undefined });
  });

  it("非 /industry/ 路徑回傳 null", () => {
    expect(parseIndustryPath("/search")).toBeNull();
    expect(parseIndustryPath("/factory/1")).toBeNull();
    expect(parseIndustryPath("/")).toBeNull();
  });
});

describe("buildIndustryPageMeta：13 個主產業 slug 都能算出有效 meta", () => {
  it.each(Object.values(INDUSTRY_SLUGS))("slug=%s", (slug) => {
    const meta = buildIndustryPageMeta(slug);
    expect(meta).not.toBeNull();
    expect(meta!.title).toContain("OXM");
    expect(meta!.description.length).toBeGreaterThan(0);
    expect(meta!.canonical).toBe(`https://www.oxmmatch.com/industry/${slug}`);
  });

  it("不同主產業 slug 的 title 彼此都不相同（不會被判斷為重複頁面）", () => {
    const titles = Object.values(INDUSTRY_SLUGS).map(slug => buildIndustryPageMeta(slug)!.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("buildIndustryPageMeta：子產業頁（Phase 1）", () => {
  it.each(PHASE1_SUB_INDUSTRY_PAGES)("industrySlug=$industrySlug subSlug=$subSlug", ({ industrySlug, subSlug }) => {
    const meta = buildIndustryPageMeta(industrySlug, subSlug);
    expect(meta).not.toBeNull();
    expect(meta!.canonical).toBe(`https://www.oxmmatch.com/industry/${industrySlug}/${subSlug}`);
  });
});

describe("buildIndustryPageMeta：無效 slug", () => {
  it("完全不存在的 slug 回傳 null（呼叫端應保留預設 index.html，不硬塞內容）", () => {
    expect(buildIndustryPageMeta("not-a-real-industry")).toBeNull();
  });

  it("有效主產業 slug 搭配不存在的子產業 slug 回傳 null", () => {
    expect(buildIndustryPageMeta("chemical-manufacturing", "not-a-real-sub")).toBeNull();
  });
});

describe("injectMetaIntoHtml + buildIndustryPageMeta：注入後的原始 HTML", () => {
  it("有獨立 title、canonical，且 canonical 自我指向（不是導向首頁）", () => {
    const meta = buildIndustryPageMeta("chemical-manufacturing")!;
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: meta.title,
      description: meta.description,
      image: DEFAULT_OG_IMAGE,
      url: meta.canonical,
      status: 200,
      noindex: false,
    });
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="https://www.oxmmatch.com/industry/chemical-manufacturing">`);
    expect(html).not.toContain('name="robots"');
    // 不再是全站通用 title
    expect(html).not.toContain("<title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>");
  });

  it("兩個不同主產業頁注入後的原始 HTML title 彼此不同", () => {
    const metaChem = buildIndustryPageMeta("chemical-manufacturing")!;
    const metaTextile = buildIndustryPageMeta("textile")!;
    const htmlChem = injectMetaIntoHtml(BASE_HTML, { title: metaChem.title, description: metaChem.description, image: DEFAULT_OG_IMAGE, url: metaChem.canonical, status: 200, noindex: false });
    const htmlTextile = injectMetaIntoHtml(BASE_HTML, { title: metaTextile.title, description: metaTextile.description, image: DEFAULT_OG_IMAGE, url: metaTextile.canonical, status: 200, noindex: false });
    expect(htmlChem).not.toBe(htmlTextile);
    expect(htmlChem).toContain(metaChem.title);
    expect(htmlTextile).toContain(metaTextile.title);
  });
});
