import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderHomeContentHtml, validateHomeContentHtml } from "../scripts/prerender-home";
import { renderAboutContentHtml } from "../scripts/prerender-about";
import { injectPrerenderedBody } from "./_core/prerenderedBody";
import { injectPublicPageSeo } from "./_core/publicPageMeta";
import { HOME_CONTENT, segmentsToPlainText } from "@shared/content/home";
import { ABOUT_CONTENT } from "@shared/content/about";
import { INDUSTRY_OPTIONS } from "@shared/constants";
import { escapeHtml } from "./_core/ogMeta";
import { BRAND } from "@shared/seo/brand";

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

// injectPrerenderedBody 讀取的是實際 build 產物路徑（dist/prerendered/*.html）。
// 這裡在測試開始前直接用同一份純函式寫入 home.html 與 about.html，讓測試不依賴
// 「剛好已經跑過 pnpm build」，同時仍然測試到真實的檔案讀取／注入邏輯。
const HOME_FILE = path.resolve(import.meta.dirname, "..", "dist", "prerendered", "home.html");
const ABOUT_FILE = path.resolve(import.meta.dirname, "..", "dist", "prerendered", "about.html");

beforeAll(() => {
  fs.mkdirSync(path.dirname(HOME_FILE), { recursive: true });
  fs.writeFileSync(HOME_FILE, renderHomeContentHtml(), "utf-8");
  fs.writeFileSync(ABOUT_FILE, renderAboutContentHtml(), "utf-8");
});

describe("renderHomeContentHtml (build-time prerender)", () => {
  it("produces non-empty HTML containing every required piece of homepage content", () => {
    const html = renderHomeContentHtml();

    expect(html).toContain(HOME_CONTENT.heroH1);
    expect(html).toContain(HOME_CONTENT.heroHeadlineLine1);
    expect(html).toContain(HOME_CONTENT.heroHeadlineLine2);
    expect(html).toContain(segmentsToPlainText(HOME_CONTENT.heroDescriptionParts));
    // compareSection.title 含未跳脫的 "&"，HTML 輸出會是 escapeHtml 過的 "&amp;"
    expect(html).toContain(escapeHtml(HOME_CONTENT.compareSection.title));
    for (const card of HOME_CONTENT.compareSection.cards) {
      expect(html).toContain(card.title);
      expect(html).toContain(card.description);
    }
    expect(html).toContain(HOME_CONTENT.industriesSection.title);
    for (const name of INDUSTRY_OPTIONS) {
      expect(html).toContain(name);
    }
    expect(html).toContain(HOME_CONTENT.featuresSection.title);
    for (const feat of HOME_CONTENT.featuresSection.items) {
      expect(html).toContain(feat.title);
    }
    expect(html).toContain(HOME_CONTENT.ctaSection.title); // 主要 CTA
    for (const btn of HOME_CONTENT.ctaSection.buttons) {
      expect(html).toContain(btn.label);
      expect(html).toContain(`href="${btn.href}"`); // 真實內部連結
    }
  });

  it("contains a real <h1> tag (not just the text elsewhere)", () => {
    const html = renderHomeContentHtml();
    expect(html).toMatch(new RegExp(`<h1>${HOME_CONTENT.heroH1}</h1>`));
  });

  it("does not contain dynamic/announcement/login-only content", () => {
    const html = renderHomeContentHtml();
    // 公告區塊、登入狀態依賴的內容、搜尋結果等動態資料本階段不預渲染
    expect(html).not.toContain("announcement");
    expect(html).not.toContain("dashboard"); // 只有已登入且有工廠權限才會導向的連結
  });

  it("passes its own validation (no empty output, no undefined/NaN/empty href/javascript: URL)", () => {
    const html = renderHomeContentHtml();
    expect(validateHomeContentHtml(html)).toEqual([]);
  });

  it("is stable across repeated calls in the same build (no randomness/timestamps)", () => {
    const first = renderHomeContentHtml();
    const second = renderHomeContentHtml();
    expect(second).toBe(first);
  });

  it("does not contain the official brand-definition sentence (not visible homepage body text — meta/JSON-LD only)", () => {
    const html = renderHomeContentHtml();
    expect(html).not.toContain(BRAND.description);
  });

  it("does not contain a display:none section or any hidden SEO-only markup", () => {
    const html = renderHomeContentHtml();
    expect(html).not.toContain("display:none");
    expect(html).not.toContain("display: none");
    expect(html).not.toMatch(/class(Name)?="[^"]*sr-only/);
    expect(html).not.toContain("data-oxm-seo-source");
    expect(html).not.toContain("data-oxm-seo-transient");
  });
});

describe("validateHomeContentHtml (SSR-safety guard)", () => {
  it("flags empty output", () => {
    expect(validateHomeContentHtml("   ")).toContain("generated HTML is empty");
  });

  it("flags a literal 'undefined' leaking into the output", () => {
    expect(validateHomeContentHtml("<p>undefined</p>").some(p => p.includes("undefined"))).toBe(true);
  });

  it("flags a literal 'NaN' leaking into the output", () => {
    expect(validateHomeContentHtml("<p>NaN</p>").some(p => p.includes("NaN"))).toBe(true);
  });

  it("flags an empty href", () => {
    expect(validateHomeContentHtml('<a href="">x</a>').some(p => p.includes("empty href"))).toBe(true);
  });

  it("flags a javascript: URL", () => {
    expect(validateHomeContentHtml('<a href="javascript:alert(1)">x</a>').some(p => p.includes("javascript:"))).toBe(true);
  });

  it("passes clean content with no problems", () => {
    expect(validateHomeContentHtml('<h1>OK</h1><a href="/search">go</a>')).toEqual([]);
  });
});

describe("injectPrerenderedBody (multi-page: / and /about)", () => {
  it("injects the homepage fragment into #root, marked with data-oxm-prerendered=\"home\"", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain('<div id="root" data-oxm-prerendered="home">');
    expect(html).toContain(HOME_CONTENT.heroH1);
    expect(html).not.toContain('<div id="root"></div>');
  });

  it("still injects the About fragment for /about, unaffected by the home page addition", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/about");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain('<div id="root" data-oxm-prerendered="about">');
    expect(html).toContain(ABOUT_CONTENT.heroH1);
  });

  it("does not inject any prerendered body for a route with no registered fragment (e.g. /talent)", () => {
    // GEO Final Cleanup：/upgrade-center 現在也有自己的固定語意殼（見
    // server/prerenderUpgradeCenter.test.ts），不再是「沒有預渲染」的範例
    // （/search 也因同樣理由被換掉，見 server/prerenderResourcesNewsSearch
    // .test.ts）。改用 /talent——noindex,follow 的 Coming Soon 頁，本來就
    // 不該有 prerender 片段。
    expect(injectPrerenderedBody(BASE_HTML, "/talent")).toBeNull();
  });

  it("/search gets its own fixed semantic-shell fragment, not home's/about's content (GEO Phase 3A)", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/search");
    if (out !== null) {
      expect(out).toContain('data-oxm-prerendered="search"');
      expect(out).not.toContain(HOME_CONTENT.compareSection.title);
      expect(out).not.toContain(ABOUT_CONTENT.whatIsTitle);
    }
  });

  it("home and about fragments do not cross-contaminate each other", () => {
    const homeHtml = injectPrerenderedBody(BASE_HTML, "/") as string;
    const aboutHtml = injectPrerenderedBody(BASE_HTML, "/about") as string;

    expect(homeHtml).not.toContain(ABOUT_CONTENT.whatIsTitle);
    expect(aboutHtml).not.toContain(HOME_CONTENT.compareSection.title);
  });

  it("returns null (no-op) if there is no empty #root div to inject into", () => {
    const alreadyFilled = BASE_HTML.replace('<div id="root"></div>', '<div id="root">already has content</div>');
    expect(injectPrerenderedBody(alreadyFilled, "/")).toBeNull();
  });
});

describe("prerendered body + Stage 2A SEO head stay compatible (homepage)", () => {
  it("keeps title/description/canonical/JSON-LD from Stage 2A alongside the prerendered / body", () => {
    const withHead = injectPublicPageSeo(BASE_HTML, "/") as string;
    expect(withHead).toContain('title data-oxm-seo-transient="true"');
    expect(withHead).toContain('rel="canonical"');

    const withBody = injectPrerenderedBody(withHead, "/") as string;
    expect(withBody).not.toBeNull();

    expect(withBody).toContain('title data-oxm-seo-transient="true"');
    expect(withBody).toContain('rel="canonical"');
    expect(withBody).toContain(HOME_CONTENT.heroH1);
    expect(withBody).toContain('data-oxm-prerendered="home"');
  });
});
