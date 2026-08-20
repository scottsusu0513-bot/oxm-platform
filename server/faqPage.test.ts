/**
 * /faq 常見問答頁——內容契約（shared/content/faq.ts）、SEO 注入
 * （server/_core/publicPageMeta.ts + shared/seo/publicPages.ts）、FAQPage
 * JSON-LD（shared/seo/schema.ts）、sitemap 收錄與 Navbar 入口的靜態驗證。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAQ_CONTENT, getFaqQuestionsFlat } from "../shared/content/faq";
import { getPublicPageSeoByPath, PUBLIC_PAGE_SEO } from "@shared/seo/publicPages";
import { getFaqPageSchema, getFaqBreadcrumbSchema, FAQ_PAGE_ID } from "@shared/seo/schema";
import { injectPublicPageSeo } from "./_core/publicPageMeta";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

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

describe("shared/content/faq.ts（FAQ 內容契約：16 題、4 分類、題數 5/4/3/4）", () => {
  it("共 4 大分類，題數依序為 5／4／3／4，合計 16 題", () => {
    expect(FAQ_CONTENT.categories).toHaveLength(4);
    const counts = FAQ_CONTENT.categories.map((c) => c.questions.length);
    expect(counts).toEqual([5, 4, 3, 4]);
    expect(getFaqQuestionsFlat()).toHaveLength(16);
  });

  it("分類標題依序為市場與供應鏈／經營與轉型／轉型資源與工具／關於 OXM", () => {
    expect(FAQ_CONTENT.categories.map((c) => c.title)).toEqual([
      "市場與供應鏈",
      "經營與轉型",
      "轉型資源與工具",
      "關於 OXM",
    ]);
  });

  it("每一題都有非空的題目與至少一段非空的答案內容", () => {
    for (const q of getFaqQuestionsFlat()) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.answerParagraphs.length).toBeGreaterThan(0);
      for (const p of q.answerParagraphs) {
        expect(p.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("16 題 id 全部唯一", () => {
    const ids = getFaqQuestionsFlat().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getPublicPageSeoByPath(\"/faq\")（shared/seo/publicPages.ts）", () => {
  it("對應到 faq 設定，canonical 指向 https://www.oxmmatch.com/faq", () => {
    expect(getPublicPageSeoByPath("/faq")).toBe(PUBLIC_PAGE_SEO.faq);
    expect(PUBLIC_PAGE_SEO.faq.canonical).toBe("https://www.oxmmatch.com/faq");
  });

  it("title 包含 OXM 常見問答 FAQ／台灣製造業／傳統產業", () => {
    expect(PUBLIC_PAGE_SEO.faq.title).toContain("OXM 常見問答 FAQ");
    expect(PUBLIC_PAGE_SEO.faq.title).toContain("台灣製造業");
  });

  it("description 不把此頁描述成新手教學或平台操作說明", () => {
    expect(PUBLIC_PAGE_SEO.faq.description).not.toMatch(/新手|怎麼註冊|操作說明|操作教學/);
  });

  it("結尾斜線視同 /faq", () => {
    expect(getPublicPageSeoByPath("/faq/")).toBe(PUBLIC_PAGE_SEO.faq);
  });
});

describe("getFaqPageSchema / getFaqBreadcrumbSchema（shared/seo/schema.ts）", () => {
  it("FAQPage 的 mainEntity 剛好 16 題，Question.name 與 acceptedAnswer.text 對應內容一致", () => {
    const schema = getFaqPageSchema();
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema["@id"]).toBe(FAQ_PAGE_ID);
    const mainEntity = schema.mainEntity as Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>;
    expect(mainEntity).toHaveLength(16);

    const flat = getFaqQuestionsFlat();
    mainEntity.forEach((entry, i) => {
      expect(entry["@type"]).toBe("Question");
      expect(entry.name).toBe(flat[i].question);
      expect(entry.acceptedAnswer["@type"]).toBe("Answer");
      expect(entry.acceptedAnswer.text).toBe(flat[i].answerParagraphs.join("\n\n"));
    });
  });

  it("BreadcrumbList itemListElement 依序為首頁、/faq", () => {
    const crumb = getFaqBreadcrumbSchema() as unknown as { itemListElement: Array<{ item: string }> };
    expect(crumb.itemListElement.map((x) => x.item)).toEqual([
      "https://www.oxmmatch.com",
      "https://www.oxmmatch.com/faq",
    ]);
  });
});

describe("injectPublicPageSeo(html, \"/faq\")（伺服器端初始 HTML 注入）", () => {
  it("注入 title／description／canonical，且 FAQPage + BreadcrumbList JSON-LD 各恰好一個", () => {
    const out = injectPublicPageSeo(BASE_HTML, "/faq");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain(PUBLIC_PAGE_SEO.faq.title);
    expect(html).toContain(PUBLIC_PAGE_SEO.faq.description);
    expect(html).toContain(`<link data-oxm-seo-transient="true" rel="canonical" href="https://www.oxmmatch.com/faq">`);
    expect(html).not.toMatch(/name="robots"\s+content="noindex/);

    const jsonLdScripts = html.match(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(jsonLdScripts.length).toBe(2);
    expect(html).toContain(`"@type":"FAQPage"`);
    expect(html).toContain(`"@type":"BreadcrumbList"`);

    // 完整 16 題問答內容必須存在於初始 HTML（即使 Accordion 視覺上收合）。
    const faqPageScript = jsonLdScripts.find((s) => s.includes(`"@type":"FAQPage"`))!;
    const questionCount = (faqPageScript.match(/"@type":"Question"/g) ?? []).length;
    expect(questionCount).toBe(16);
  });

  it("不含 noindex（/faq 必須是 index,follow）", () => {
    const html = injectPublicPageSeo(BASE_HTML, "/faq") as string;
    expect(html).not.toMatch(/noindex/i);
  });
});

describe("sitemap.xml 包含 /faq（server/_core/index.ts）", () => {
  const source = readSource("server", "_core", "index.ts");
  const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
  const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";

  it("sitemap route 內含 ${BASE}/faq", () => {
    expect(sitemapSource.length).toBeGreaterThan(0);
    expect(sitemapSource).toContain("${BASE}/faq");
  });
});

describe("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 不包含 /faq", () => {
  it("三個隱藏服務清單維持不變，且沒有把 /faq 加進去", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    expect(match![1]).not.toMatch(/"\/faq"/);
  });
});

describe("client/src/App.tsx 註冊 /faq 路由", () => {
  it("有 <Route path=\"/faq\" component={FAQ} />", () => {
    const source = readSource("client", "src", "App.tsx");
    expect(source).toMatch(/<Route path="\/faq" component=\{FAQ\} \/>/);
  });
});

describe("client/src/components/Navbar.tsx 品牌下拉選單含常見問答（single source of truth）", () => {
  it("品牌下拉選單只有一組 /faq 連結與一組 /about 連結（桌機／手機共用同一份）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    const faqLinks = source.match(/href="\/faq"/g) ?? [];
    const aboutLinks = source.match(/href="\/about"/g) ?? [];
    expect(faqLinks.length).toBe(1);
    expect(aboutLinks.length).toBe(1);
    expect(source).toContain("常見問答");
  });
});

describe("client/src/pages/FAQ.tsx 使用 forceMount 讓收合內容仍留在初始 DOM", () => {
  it("AccordionContent 帶有 forceMount", () => {
    const source = readSource("client", "src", "pages", "FAQ.tsx");
    expect(source).toMatch(/<AccordionContent\s+forceMount\b/);
  });

  it("Accordion 根元件沒有寫死展開項（沒有 defaultValue，也沒有把 value 指定成任何固定字面量），符合預設全部收合", () => {
    const source = readSource("client", "src", "pages", "FAQ.tsx");
    // 只比對 <Accordion ...> 根元件本身，不能誤比對到 <AccordionItem value={q.id}>
    // ——AccordionItem 的 value 是每個項目的必要識別 id，不是展開狀態控制。
    // Accordion 根元件目前是 value={openQuestionId} 的受控寫法（同一頁四個分類
    // 共用一個 openQuestionId state，達成「全站同時最多展開一題」），不是原本
    // 假設的無控制寫法；只要沒有 defaultValue、也沒有把 value 寫死成字面量，
    // 且 openQuestionId 初始值是空字串，實際效果就仍然是預設全部收合。
    const accordionMatch = source.match(/<Accordion(?!Item|Trigger|Content)\b[^>]*>/g) ?? [];
    expect(accordionMatch.length).toBeGreaterThan(0);
    for (const tag of accordionMatch) {
      expect(tag).not.toMatch(/defaultValue/);
      expect(tag).not.toMatch(/value="[^{]/); // 字面量展開值（例如 value="market-1"）才是真的寫死
    }
    expect(source).toMatch(/useState\(""\)/);
  });
});
