/**
 * GEO Phase 3A — /resources、/news、/search 的 build-time 語意殼。
 *
 * 背景：Audit 確認這三頁 raw HTML 的 <div id="root"></div> 完全是空的，
 * H1／intro／服務內容全部要等 client JS 執行才出現，不執行 JS 的爬蟲／AI
 * 讀不到任何正文。這裡驗證新增的三支 prerender 腳本產生正確的靜態片段，
 * 且透過 injectPrerenderedBody 正確接進 <div id="root">。
 */
import { describe, expect, it } from "vitest";
import { renderResourcesContentHtml, validateResourcesContentHtml } from "../scripts/prerender-resources";
import { renderNewsContentHtml, validateNewsContentHtml } from "../scripts/prerender-news";
import { renderSearchContentHtml, validateSearchContentHtml } from "../scripts/prerender-search";
import { injectPrerenderedBody } from "./_core/prerenderedBody";
import { RESOURCES_CONTENT } from "@shared/content/resources";
import { NEWS_CONTENT } from "@shared/content/news";
import { SEARCH_CONTENT } from "@shared/content/search";
import fs from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head><title>x</title></head>
  <body><div id="root"></div></body>
</html>
`;

describe("renderResourcesContentHtml", () => {
  it("含 H1、intro、五項服務的標題／說明", () => {
    const html = renderResourcesContentHtml();
    expect(html).toContain(RESOURCES_CONTENT.heroH1);
    expect(html).toContain(RESOURCES_CONTENT.heroIntro);
    for (const service of RESOURCES_CONTENT.services) {
      expect(html).toContain(service.title);
      expect(html).toContain(service.description);
    }
  });

  it("已開放服務有真實 <a href>，敬請期待服務不輸出連結（不把 Coming Soon 變成可爬取的連結）", () => {
    const html = renderResourcesContentHtml();
    expect(html).toContain('<a href="/upgrade-center">');
    for (const service of RESOURCES_CONTENT.services) {
      if (!service.available) {
        expect(html).not.toContain(`<a href="${service.href}">`);
      }
    }
  });

  it("通過健檢（無 undefined／NaN／空 href／javascript: URL）", () => {
    expect(validateResourcesContentHtml(renderResourcesContentHtml())).toEqual([]);
  });
});

describe("renderNewsContentHtml", () => {
  it("含 H1、intro、固定分類標籤，但不含任何假造的新聞標題", () => {
    const html = renderNewsContentHtml();
    expect(html).toContain(NEWS_CONTENT.heroH1);
    for (const category of NEWS_CONTENT.fixedCategories) {
      expect(html).toContain(category);
    }
  });

  it("通過健檢", () => {
    expect(validateNewsContentHtml(renderNewsContentHtml())).toEqual([]);
  });
});

describe("renderSearchContentHtml", () => {
  it("只含 H1，不含任何搜尋結果／篩選控制項字樣", () => {
    const html = renderSearchContentHtml();
    expect(html).toContain(SEARCH_CONTENT.heroH1);
  });

  it("通過健檢", () => {
    expect(validateSearchContentHtml(renderSearchContentHtml())).toEqual([]);
  });

  it("GEO Phase 3A 安全校準：不含 intro 欄位——原本的 intro 只存在於 prerender 片段、真正 Search React DOM 沒有對應可見文字，等於 crawler-only 文案，已移除", () => {
    expect(SEARCH_CONTENT).not.toHaveProperty("intro");
  });
});

describe("injectPrerenderedBody：三頁片段正確接進 <div id=\"root\">（需要先跑過 pnpm build 產生 dist/prerendered/*.html）", () => {
  const hasFile = (name: string) => fs.existsSync(path.join(DIST_DIR, name));

  it.runIf(hasFile("resources.html"))("/resources 注入 data-oxm-prerendered=\"resources\"", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/resources");
    expect(out).not.toBeNull();
    expect(out).toContain('data-oxm-prerendered="resources"');
    expect(out).toContain(RESOURCES_CONTENT.heroH1);
  });

  it.runIf(hasFile("news.html"))("/news 注入 data-oxm-prerendered=\"news\"", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/news");
    expect(out).not.toBeNull();
    expect(out).toContain('data-oxm-prerendered="news"');
    expect(out).toContain(NEWS_CONTENT.heroH1);
  });

  it.runIf(hasFile("search.html"))("/search 注入 data-oxm-prerendered=\"search\"", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/search");
    expect(out).not.toBeNull();
    expect(out).toContain('data-oxm-prerendered="search"');
    expect(out).toContain(SEARCH_CONTENT.heroH1);
  });

  it("/news/{slug}（帶 slug 的文章頁）不會被誤判成 /news 列表頁片段", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/news/some-article-slug");
    expect(out).toBeNull();
  });
});
