import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderFaqContentHtml, validateFaqContentHtml } from "../scripts/prerender-faq";
import { injectPrerenderedBody } from "./_core/prerenderedBody";
import { injectPublicPageSeo } from "./_core/publicPageMeta";
import { FAQ_CONTENT, getFaqQuestionsFlat } from "@shared/content/faq";
import { getFaqPageSchema } from "@shared/seo/schema";

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

// injectPrerenderedBody 讀取的是實際 build 產物路徑（dist/prerendered/faq.html）。
// 這裡在測試開始前直接用同一份純函式寫入該檔案，讓測試不依賴「剛好已經跑過
// pnpm build」，同時仍然測試到真實的檔案讀取／注入邏輯（不是重新實作一份假的）。
const PRERENDERED_FILE = path.resolve(import.meta.dirname, "..", "dist", "prerendered", "faq.html");

beforeAll(() => {
  const html = renderFaqContentHtml();
  fs.mkdirSync(path.dirname(PRERENDERED_FILE), { recursive: true });
  fs.writeFileSync(PRERENDERED_FILE, html, "utf-8");
});

describe("renderFaqContentHtml (build-time prerender，資料來源只有 shared/content/faq.ts)", () => {
  it("含 H1、四大分類標題，且不含空輸出／undefined／NaN", () => {
    const html = renderFaqContentHtml();

    expect(html).toMatch(/<h1>OXM 常見問答 FAQ<\/h1>/);
    for (const category of FAQ_CONTENT.categories) {
      expect(html).toContain(category.title);
      expect(html).toContain(category.number);
    }
    expect(validateFaqContentHtml(html)).toEqual([]);
  });

  it("16 題 question 全部存在（用 <h3> 標籤，不只是純文字散落在別處）", () => {
    const html = renderFaqContentHtml();
    const flat = getFaqQuestionsFlat();
    expect(flat).toHaveLength(16);
    for (const q of flat) {
      expect(html).toContain(`<h3>${q.question}</h3>`);
    }
  });

  it("16 題的完整 answer 段落全部存在（逐段比對，不只比對第一段）", () => {
    const html = renderFaqContentHtml();
    for (const q of getFaqQuestionsFlat()) {
      for (const paragraph of q.answerParagraphs) {
        // 含換行的段落會被輸出成 <li> 條列，逐行比對；一般段落整段比對。
        if (paragraph.includes("\n")) {
          for (const line of paragraph.split("\n").filter(Boolean)) {
            expect(html).toContain(line);
          }
        } else {
          expect(html).toContain(paragraph);
        }
      }
    }
  });

  it("第一題（market-1）與最後一題（about-4）的 question／answer 都在輸出中", () => {
    const html = renderFaqContentHtml();
    const flat = getFaqQuestionsFlat();
    const first = flat[0];
    const last = flat[flat.length - 1];

    expect(first.id).toBe("market-1");
    expect(html).toContain(first.question);
    expect(html).toContain(first.answerParagraphs[0]);

    expect(last.id).toBe("about-4");
    expect(html).toContain(last.question);
    expect(html).toContain(last.answerParagraphs[0]);
  });

  it("含換行的條列段落輸出成 <ul><li>（原文清單結構合理輸出，非直接整段塞進 <p>）", () => {
    const html = renderFaqContentHtml();
    // market-2 第 5 段是條列（「你最擅長解決哪一類製造需求？\n...」）
    const listParagraph = FAQ_CONTENT.categories[0].questions[1].answerParagraphs[4];
    expect(listParagraph).toContain("\n");
    const firstLine = listParagraph.split("\n")[0];
    expect(html).toContain(`<li>${firstLine}</li>`);
  });

  it("是純函式，重複呼叫結果一致（無隨機值／時間戳）", () => {
    expect(renderFaqContentHtml()).toBe(renderFaqContentHtml());
  });
});

describe("validateFaqContentHtml（SSR-safety guard）", () => {
  it("flags empty output", () => {
    expect(validateFaqContentHtml("   ")).toContain("generated HTML is empty");
  });

  it("flags a literal 'undefined' leaking into the output", () => {
    expect(validateFaqContentHtml("<h3>q</h3><p>undefined</p>").some(p => p.includes("undefined"))).toBe(true);
  });

  it("flags a literal 'NaN' leaking into the output", () => {
    expect(validateFaqContentHtml("<p>NaN</p>").some(p => p.includes("NaN"))).toBe(true);
  });
});

describe("injectPrerenderedBody(\"/faq\") — /faq 已加入 PRERENDERED_PAGES", () => {
  it("把 faq 片段注入 #root，標記 data-oxm-prerendered=\"faq\"，且原本的空殼 root 消失", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/faq");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain('<div id="root" data-oxm-prerendered="faq">');
    expect(html).toContain("OXM 常見問答 FAQ");
    expect(html).toContain(getFaqQuestionsFlat()[0].question);
    expect(html).not.toContain('<div id="root"></div>');
  });

  it("不影響 / 與 /about 既有注入邏輯（各自對應各自的片段，互不污染）", () => {
    const homeOut = injectPrerenderedBody(BASE_HTML, "/");
    if (homeOut !== null) {
      expect(homeOut).toContain('data-oxm-prerendered="home"');
      expect(homeOut).not.toContain("OXM 常見問答 FAQ");
    }
    const aboutOut = injectPrerenderedBody(BASE_HTML, "/about");
    if (aboutOut !== null) {
      expect(aboutOut).toContain('data-oxm-prerendered="about"');
      expect(aboutOut).not.toContain("OXM 常見問答 FAQ");
    }
  });

  it("不影響其他沒有註冊預渲染片段的路由（例如 /upgrade-center）", () => {
    // GEO Phase 3A：/search 現在也有自己的固定語意殼，不再適合當「沒有
    // 註冊預渲染片段的路由」範例，改用同樣沒有註冊片段的 /upgrade-center。
    expect(injectPrerenderedBody(BASE_HTML, "/upgrade-center")).toBeNull();
  });
});

describe("prerendered body + SEO head 兩層注入相容（/faq）", () => {
  it("先注入 SEO head（title/description/canonical/JSON-LD）、再注入 prerendered body，兩者都完整保留", () => {
    const withHead = injectPublicPageSeo(BASE_HTML, "/faq") as string;
    expect(withHead).toContain('title data-oxm-seo-transient="true"');
    expect(withHead).toContain('rel="canonical"');
    expect(withHead).toContain('"@type":"FAQPage"');
    expect(withHead).toContain('"@type":"BreadcrumbList"');

    const withBody = injectPrerenderedBody(withHead, "/faq") as string;
    expect(withBody).not.toBeNull();

    // head 注入的內容在 body 注入之後仍然完整
    expect(withBody).toContain('title data-oxm-seo-transient="true"');
    expect(withBody).toContain('rel="canonical"');
    expect(withBody).toContain('"@type":"FAQPage"');
    expect(withBody).toContain('"@type":"BreadcrumbList"');
    // canonical 與 FAQPage／BreadcrumbList 仍然各只有一份
    expect((withBody.match(/rel="canonical"/g) ?? []).length).toBe(1);
    expect((withBody.match(/"@type":"FAQPage"/g) ?? []).length).toBe(1);
    expect((withBody.match(/"@type":"BreadcrumbList"/g) ?? []).length).toBe(1);
    // body 內容也存在
    expect(withBody).toContain('data-oxm-prerendered="faq"');
    expect(withBody).toContain(getFaqQuestionsFlat()[0].question);
  });

  it("FAQPage JSON-LD 在 body 注入前後皆恰好 16 題 mainEntity", () => {
    const withHead = injectPublicPageSeo(BASE_HTML, "/faq") as string;
    const withBody = injectPrerenderedBody(withHead, "/faq") as string;

    expect((withHead.match(/"@type":"Question"/g) ?? []).length).toBe(16);
    expect((withBody.match(/"@type":"Question"/g) ?? []).length).toBe(16);
    expect(getFaqPageSchema().mainEntity as unknown[]).toHaveLength(16);
  });
});
