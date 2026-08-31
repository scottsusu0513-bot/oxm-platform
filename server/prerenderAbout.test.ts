import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderAboutContentHtml, validateAboutContentHtml } from "../scripts/prerender-about";
import { injectPrerenderedBody } from "./_core/prerenderedBody";
import { injectPublicPageSeo } from "./_core/publicPageMeta";
import { ABOUT_CONTENT } from "@shared/content/about";

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

// injectPrerenderedBody 讀取的是實際 build 產物路徑
// (dist/prerendered/about.html)。這裡在測試開始前直接用同一份純函式寫入該
// 檔案，讓測試不依賴「剛好已經跑過 pnpm build」，同時仍然測試到真實的
// 檔案讀取／注入邏輯（不是重新實作一份假的）。
const PRERENDERED_FILE = path.resolve(import.meta.dirname, "..", "dist", "prerendered", "about.html");

beforeAll(() => {
  const html = renderAboutContentHtml();
  fs.mkdirSync(path.dirname(PRERENDERED_FILE), { recursive: true });
  fs.writeFileSync(PRERENDERED_FILE, html, "utf-8");
});

describe("renderAboutContentHtml (build-time prerender)", () => {
  it("produces non-empty HTML containing every required piece of content", () => {
    const html = renderAboutContentHtml();

    expect(html).toContain(ABOUT_CONTENT.heroH1); // About 頁 H1
    expect(html).toContain(ABOUT_CONTENT.whatIsTitle); // OXM 是什麼？
    expect(html).toContain(ABOUT_CONTENT.whatIsParagraphs[0]); // OXM 正式品牌定義
    expect(html).toContain(ABOUT_CONTENT.whyTitle); // 為什麼會有 OXM？
    for (const name of ABOUT_CONTENT.serviceNames) {
      expect(html).toContain(name); // 六大服務名稱
    }
    expect(html).toContain(ABOUT_CONTENT.audienceTitle); // 誰適合使用 OXM
    expect(html).toContain(ABOUT_CONTENT.ctaTitle); // 最終 CTA 主要文字
    expect(html).toContain(ABOUT_CONTENT.lastUpdated); // 最後更新日期
  });

  it("contains a real <h1> tag (not just the text elsewhere)", () => {
    const html = renderAboutContentHtml();
    expect(html).toMatch(new RegExp(`<h1>${ABOUT_CONTENT.heroH1}</h1>`));
  });

  it("passes its own validation (no empty output, no literal 'undefined'/'NaN')", () => {
    const html = renderAboutContentHtml();
    expect(validateAboutContentHtml(html)).toEqual([]);
  });

  it("is stable across repeated calls in the same build (no randomness/timestamps)", () => {
    const first = renderAboutContentHtml();
    const second = renderAboutContentHtml();
    expect(second).toBe(first);
  });
});

describe("validateAboutContentHtml (SSR-safety guard)", () => {
  it("flags empty output", () => {
    expect(validateAboutContentHtml("   ")).toContain("generated HTML is empty");
  });

  it("flags a literal 'undefined' leaking into the output", () => {
    const problems = validateAboutContentHtml("<h1>title</h1><p>undefined</p>");
    expect(problems.some(p => p.includes("undefined"))).toBe(true);
  });

  it("flags a literal 'NaN' leaking into the output", () => {
    const problems = validateAboutContentHtml("<p>NaN</p>");
    expect(problems.some(p => p.includes("NaN"))).toBe(true);
  });

  it("passes clean content with no problems", () => {
    expect(validateAboutContentHtml("<h1>OK</h1>")).toEqual([]);
  });
});

describe("injectPrerenderedBody", () => {
  it("injects the prerendered fragment into #root, marked with data-oxm-prerendered=\"about\"", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/about");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain('<div id="root" data-oxm-prerendered="about">');
    expect(html).toContain(ABOUT_CONTENT.heroH1);
    expect(html).toContain(ABOUT_CONTENT.whatIsParagraphs[0]);
    // the empty root shell must be gone, replaced by the marked+populated one
    expect(html).not.toContain('<div id="root"></div>');
  });

  it("injects the home page's own fragment for \"/\", not the About fragment (Stage 2C)", () => {
    // 第二階段 C 之後 "/" 也有自己的預渲染片段，這裡確認 /about 的注入邏輯
    // 不會誤把 about 的內容套用到 "/"，兩者互不污染（詳見 prerenderHome.test.ts）。
    const out = injectPrerenderedBody(BASE_HTML, "/");
    if (out !== null) {
      expect(out).not.toContain(ABOUT_CONTENT.whatIsTitle);
      expect(out).toContain('data-oxm-prerendered="home"');
    }
  });

  it("does not affect other SPA routes with no registered fragment (e.g. /upgrade-center)", () => {
    // GEO Phase 3A：/search 現在也有自己的固定語意殼（見
    // server/prerenderResourcesNewsSearch.test.ts），不再適合當「沒有註冊
    // 預渲染片段的路由」範例，改用同樣沒有註冊片段的 /upgrade-center。
    expect(injectPrerenderedBody(BASE_HTML, "/upgrade-center")).toBeNull();
  });

  it("returns null (no-op) if there is no empty #root div to inject into", () => {
    const alreadyFilled = BASE_HTML.replace('<div id="root"></div>', '<div id="root">already has content</div>');
    expect(injectPrerenderedBody(alreadyFilled, "/about")).toBeNull();
  });
});

describe("prerendered body + Stage 2A SEO head stay compatible", () => {
  it("keeps title/description/canonical/JSON-LD from Stage 2A alongside the prerendered /about body", () => {
    const withHead = injectPublicPageSeo(BASE_HTML, "/about") as string;
    expect(withHead).toContain('title data-oxm-seo-transient="true"');
    expect(withHead).toContain('rel="canonical"');
    expect(withHead).toContain('"@type":"AboutPage"');
    expect(withHead).toContain('"@type":"BreadcrumbList"');

    const withBody = injectPrerenderedBody(withHead, "/about") as string;
    expect(withBody).not.toBeNull();

    // head injection must still be intact after body injection runs afterwards
    expect(withBody).toContain('title data-oxm-seo-transient="true"');
    expect(withBody).toContain('rel="canonical"');
    expect(withBody).toContain('"@type":"AboutPage"');
    expect(withBody).toContain('"@type":"BreadcrumbList"');
    // and the body content is present too
    expect(withBody).toContain(ABOUT_CONTENT.heroH1);
    expect(withBody).toContain('data-oxm-prerendered="about"');
  });
});
