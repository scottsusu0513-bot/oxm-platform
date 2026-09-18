// @vitest-environment jsdom
/**
 * /library/:slug 文章頁（見任務定案「傳產圖書館 Phase 1 實作」）。Navbar
 * mock 掉的理由同 LibraryIndex.test.tsx。用 window.history.pushState 讓
 * wouter 的預設 location hook（backed by 瀏覽器 History API）在渲染前就
 * match 到目標 slug，不需要額外 mock wouter 本身的 route matching 邏輯
 * ——這樣測到的才是真正的 route matching + resolveLibraryArticle 行為，
 * 不是繞過去的假資料。
 *
 * 這個專案沒有裝 @testing-library/jest-dom（見
 * client/src/components/ConsentGate.test.tsx 的既有說明），一律用純 DOM
 * 屬性斷言（.textContent／.getAttribute／toBeTruthy／toBeNull），不用
 * toBeInTheDocument()／toHaveAttribute() 這類 jest-dom matcher。
 *
 * 涵蓋：
 *   28. article metadata（libraryId／category／updatedAt／H1）正確渲染
 *   29. libraryId 顯示
 *   30. related articles（相關館藏）正確渲染，連到正確 slug
 *   31. CTA（含 oem-vs-odm 的雙 CTA）正確渲染，href 正確
 *   32. 全 45 篇畫面上第一個 H2 問題（LibraryArticle.tsx 的
 *       openingQuestions／article.h1 fallback，不是 shared/content/library.ts
 *       body 裡的第一個 heading 區塊——見任務定案「Library 第一題 generic
 *       opener 修正」audit）存在、不是通用 meta 開場句、且渲染成真正的 H2
 *   非法 slug → 渲染 NotFound（不是空白頁或 500）
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

import LibraryArticle from "./LibraryArticle";
import { LIBRARY_ARTICLE_BY_SLUG, LIBRARY_ARTICLES } from "@shared/content/library";

function renderAt(pathname: string) {
  window.history.pushState({}, "", pathname);
  render(
    <HelmetProvider>
      <LibraryArticle />
    </HelmetProvider>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

describe("LibraryArticle — 合法 slug：MOQ 文章", () => {
  it("H1、libraryId、分類、最後更新日期都正確渲染", () => {
    renderAt("/library/what-is-moq");
    const article = LIBRARY_ARTICLE_BY_SLUG["what-is-moq"];
    expect(screen.getByRole("heading", { level: 1, name: article.h1 })).toBeTruthy();
    expect(screen.getByText(article.libraryId)).toBeTruthy();
    expect(screen.getByText(article.category)).toBeTruthy();
    expect(screen.getByText(new RegExp(`最後更新 ${article.updatedAt}`))).toBeTruthy();
  });

  it("breadcrumb 含「傳產圖書館」與文章標題", () => {
    renderAt("/library/what-is-moq");
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.textContent).toContain("傳產圖書館");
    expect(nav.textContent).toContain(LIBRARY_ARTICLE_BY_SLUG["what-is-moq"].h1);
  });

  it("CTA 按鈕文字與 href 正確（單一主要 CTA，沒有 secondary）", () => {
    renderAt("/library/what-is-moq");
    const ctaLink = screen.getByRole("link", { name: "查看可接小量／可打樣的工廠" });
    expect(ctaLink.getAttribute("href")).toBe("/search?smallBatch=true&sample=true");
  });

  it("相關館藏區塊列出 oem-vs-odm 與 first-time-factory-guide，且 href 正確", () => {
    renderAt("/library/what-is-moq");
    const related = screen.getByTestId("related-articles");
    const links = Array.from(related.querySelectorAll("a"));
    const hrefs = links.map(a => a.getAttribute("href"));
    expect(hrefs).toContain("/library/oem-vs-odm");
    expect(hrefs).toContain("/library/first-time-factory-guide");
  });

  it("沒有「常見問題」區塊（這篇文章沒有 faq）", () => {
    renderAt("/library/what-is-moq");
    expect(screen.queryByText("常見問題")).toBeNull();
  });
});

describe("LibraryArticle — OEM/ODM 文章：雙 CTA 與 FAQ", () => {
  it("主要與次要 CTA 都渲染，各自指向 ODM／OEM 篩選", () => {
    renderAt("/library/oem-vs-odm");
    const odmLink = screen.getByRole("link", { name: "瀏覽提供 ODM 代工的工廠" });
    const oemLink = screen.getByRole("link", { name: "瀏覽提供 OEM 代工的工廠" });
    expect(odmLink.getAttribute("href")).toBe("/search?mfgMode=ODM");
    expect(oemLink.getAttribute("href")).toBe("/search?mfgMode=OEM");
  });

  it("有「常見問題」區塊，且每一題的文字與 article.faq 逐字一致", () => {
    renderAt("/library/oem-vs-odm");
    expect(screen.getByText("常見問題")).toBeTruthy();
    const faq = LIBRARY_ARTICLE_BY_SLUG["oem-vs-odm"].faq!;
    for (const qa of faq) {
      // 部分問題文字（例如「OEM 是什麼？」）跟正文的 H2 標題重複，屬正常
      // 現象（FAQ 是正文重點的 QA 重述），因此用 getAllByText 而不是要求
      // 全站唯一。
      expect(screen.getAllByText(qa.question).length).toBeGreaterThan(0);
      expect(screen.getAllByText(qa.answer).length).toBeGreaterThan(0);
    }
  });

  it("正文含比較表格（OEM／ODM 欄位標題）", () => {
    renderAt("/library/oem-vs-odm");
    expect(screen.getByText("誰提供設計")).toBeTruthy();
    expect(screen.getAllByText("OEM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ODM").length).toBeGreaterThan(0);
  });

});

describe("LibraryArticle — 第一次找代工廠：單一 CTA + 兩個 contextual link", () => {
  it("CTA 導向 /search", () => {
    renderAt("/library/first-time-factory-guide");
    expect(screen.getByRole("link", { name: "開始找工廠" }).getAttribute("href")).toBe("/search");
  });

});

describe("LibraryArticle — 新文章：代工是什麼？代工廠是什麼？", () => {
  it("H1、libraryId、分類、最後更新日期都正確渲染", () => {
    renderAt("/library/what-is-contract-manufacturing");
    const article = LIBRARY_ARTICLE_BY_SLUG["what-is-contract-manufacturing"];
    expect(screen.getByRole("heading", { level: 1, name: article.h1 })).toBeTruthy();
    expect(screen.getByText(article.libraryId)).toBeTruthy();
    expect(screen.getAllByText(article.category).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`最後更新 ${article.updatedAt}`))).toBeTruthy();
  });

  it("7 個核心問題全部渲染成畫面上的標題，順序固定由淺入深", () => {
    renderAt("/library/what-is-contract-manufacturing");
    const headings = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
    const questions = [
      "代工是什麼？",
      "代工廠是什麼？是不是所有工廠都一樣？",
      "哪些人會需要找代工廠？",
      "找代工廠前，要準備什麼？",
      "為什麼同一個產品，不同工廠報價會差很多？",
      "我要怎麼知道自己該找哪一種工廠？",
      "OEM、ODM 跟代工有什麼關係？",
    ];
    let lastIndex = -1;
    for (const q of questions) {
      const idx = headings.indexOf(q);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("結尾有獨立的「OXM 小整理」標題與 5 個重點", () => {
    renderAt("/library/what-is-contract-manufacturing");
    expect(screen.getByRole("heading", { level: 2, name: "OXM 小整理" })).toBeTruthy();
    for (const point of ["先確認需求", "找對工廠類型", "數量會影響工廠選擇", "價格不是唯一條件", "找適合的製造合作夥伴"]) {
      expect(screen.getByText(point)).toBeTruthy();
    }
  });

  it("CTA 導向 /search，文字為「前往 OXM 找工廠」", () => {
    renderAt("/library/what-is-contract-manufacturing");
    const ctaLink = screen.getByRole("link", { name: "前往 OXM 找工廠" });
    expect(ctaLink.getAttribute("href")).toBe("/search");
  });

  it("相關館藏區塊列出 oem-vs-odm 與 first-time-factory-guide，且 href 正確", () => {
    renderAt("/library/what-is-contract-manufacturing");
    const related = screen.getByTestId("related-articles");
    const links = Array.from(related.querySelectorAll("a"));
    const hrefs = links.map(a => a.getAttribute("href"));
    expect(hrefs).toContain("/library/oem-vs-odm");
    expect(hrefs).toContain("/library/first-time-factory-guide");
    expect(hrefs).not.toContain("/library/what-is-moq");
  });

  it("沒有「常見問題」區塊（這篇文章沒有 faq）", () => {
    renderAt("/library/what-is-contract-manufacturing");
    expect(screen.queryByText("常見問題")).toBeNull();
  });
});

describe("LibraryArticle — oem-vs-odm 相關館藏新增前置知識連結", () => {
  it("相關館藏區塊現在包含 what-is-contract-manufacturing，href 正確", () => {
    renderAt("/library/oem-vs-odm");
    const related = screen.getByTestId("related-articles");
    const links = Array.from(related.querySelectorAll("a"));
    const hrefs = links.map(a => a.getAttribute("href"));
    expect(hrefs).toContain("/library/what-is-contract-manufacturing");
    expect(hrefs).toContain("/library/what-is-moq");
  });
});

describe("LibraryArticle — Level 2 第一批 5 篇：H1／結尾 CTA／相關館藏（正文 OXM 導流已於本輪移除）", () => {
  it("small-batch-manufacturing：H1、結尾 CTA 正確渲染", () => {
    renderAt("/library/small-batch-manufacturing");
    expect(screen.getByRole("heading", { level: 1, name: "小量代工怎麼找？MOQ 太高怎麼辦？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看可接小量／可打樣的工廠" }).getAttribute("href")).toBe("/search?smallBatch=true&sample=true");
    const related = screen.getByTestId("related-articles");
    const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/library/what-is-moq", "/library/what-is-prototyping"]);
  });

  it("how-to-read-factory-quotes：H1、結尾 CTA 正確渲染", () => {
    renderAt("/library/how-to-read-factory-quotes");
    expect(screen.getByRole("heading", { level: 1, name: "工廠報價怎麼看？為什麼同一個產品價格差這麼多？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "前往 OXM 找工廠、比較報價" }).getAttribute("href")).toBe("/search");
    const related = screen.getByTestId("related-articles");
    const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/library/what-is-rfq", "/library/how-to-choose-a-factory"]);
  });

  it("how-to-choose-a-factory：H1、結尾 CTA 正確渲染", () => {
    renderAt("/library/how-to-choose-a-factory");
    expect(screen.getByRole("heading", { level: 1, name: "怎麼判斷一間工廠適不適合你的案子？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "前往 OXM 找工廠" }).getAttribute("href")).toBe("/search");
    const related = screen.getByTestId("related-articles");
    const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/library/how-to-read-factory-quotes", "/library/what-is-prototyping"]);
  });

  it("what-is-rfq：H1、結尾 CTA 正確渲染", () => {
    renderAt("/library/what-is-rfq");
    expect(screen.getByRole("heading", { level: 1, name: "詢價要提供哪些資料？RFQ 怎麼準備？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "前往 OXM 開始詢價" }).getAttribute("href")).toBe("/search");
    const related = screen.getByTestId("related-articles");
    const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/library/first-time-factory-guide", "/library/how-to-read-factory-quotes"]);
  });

  it("what-is-prototyping：H1、結尾 CTA 正確渲染", () => {
    renderAt("/library/what-is-prototyping");
    expect(screen.getByRole("heading", { level: 1, name: "打樣是什麼？從樣品到量產通常要經過哪些階段？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看可打樣的工廠" }).getAttribute("href")).toBe("/search?sample=true");
    const related = screen.getByTestId("related-articles");
    const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["/library/small-batch-manufacturing", "/library/how-to-choose-a-factory"]);
  });

  it("本批 5 篇都沒有「常見問題」區塊（都沒有 faq）", () => {
    for (const slug of ["small-batch-manufacturing", "how-to-read-factory-quotes", "how-to-choose-a-factory", "what-is-rfq", "what-is-prototyping"]) {
      renderAt(`/library/${slug}`);
      expect(screen.queryByText("常見問題")).toBeNull();
      cleanup();
    }
  });
});

describe("LibraryArticle — 全 45 篇 UI render 與正文不再有任何 OXM 導流連結（見任務定案「傳產圖書館內容完成階段」／「移除正文 OXM 導流」）", () => {
  const allSlugs = LIBRARY_ARTICLES.map(a => a.slug);

  it("全部 45 篇都能正確渲染 H1，且 H1 文字跟資料源一致（涵蓋本輪新增的 36 篇，不會渲染出空白頁或報錯）", () => {
    for (const slug of allSlugs) {
      renderAt(`/library/${slug}`);
      expect(screen.getByRole("heading", { level: 1, name: LIBRARY_ARTICLE_BY_SLUG[slug].h1 }), slug).toBeTruthy();
      cleanup();
    }
  });

  it("全部 45 篇正文都沒有「延伸閱讀」文字，也沒有 library-context-link（原本 relatedLink／oxmLink 共用的正文連結樣式）", () => {
    for (const slug of allSlugs) {
      renderAt(`/library/${slug}`);
      expect(screen.queryByText(/延伸閱讀/), slug).toBeNull();
      expect(document.querySelectorAll(".library-context-link").length, slug).toBe(0);
      cleanup();
    }
  });

  it("每篇文末都有唯一的 NEXT STEP CTA（library-cta-primary），OXM 導流全部集中在這裡，且 href 都在 allowlist 內", () => {
    for (const slug of allSlugs) {
      renderAt(`/library/${slug}`);
      const ctaLinks = document.querySelectorAll("a.library-cta-primary");
      expect(ctaLinks.length, slug).toBe(1);
      expect(ctaLinks[0].getAttribute("href"), slug).toBe(LIBRARY_ARTICLE_BY_SLUG[slug].cta.href);
      cleanup();
    }
  });

  it("相關館藏區塊每篇都仍存在，且連結數與 relatedArticleSlugs 一致", () => {
    for (const slug of allSlugs) {
      renderAt(`/library/${slug}`);
      const related = screen.getByTestId("related-articles");
      expect(related, slug).toBeTruthy();
      const hrefs = Array.from(related.querySelectorAll("a")).map(a => a.getAttribute("href"));
      expect(hrefs, slug).toEqual(LIBRARY_ARTICLE_BY_SLUG[slug].relatedArticleSlugs.map(s => `/library/${s}`));
      cleanup();
    }
  });
});

describe("LibraryArticle — 全 45 篇第一個問題（見任務定案「Library 第一題 generic opener 修正」audit：原本 openingQuestions 只覆蓋 9 篇，其餘 36 篇會 fallback 成硬編碼的「這份指南從哪裡開始？」，本輪補齊全部 45 篇並移除這個通用字串）", () => {
  const GENERIC_OPENER_SUBSTRINGS = [
    "這份指南從哪裡開始",
    "這篇文章要從哪裡開始",
    "我該先知道什麼",
    "這篇先講什麼",
    "從哪裡開始",
  ];

  it("全部 45 篇都存在畫面上第一個 H2 問題，且真的渲染成 <h2>（不是純文字或其他層級標題）", () => {
    for (const article of LIBRARY_ARTICLES) {
      renderAt(`/library/${article.slug}`);
      const h2s = screen.getAllByRole("heading", { level: 2 });
      expect(h2s.length, article.slug).toBeGreaterThan(0);
      expect(h2s[0].textContent, article.slug).toBeTruthy();
      cleanup();
    }
  });

  it("全部 45 篇第一個問題都不是通用 meta 開場句（不含「從哪裡開始」「我該先知道什麼」「這篇先講什麼」等樣式）", () => {
    for (const article of LIBRARY_ARTICLES) {
      renderAt(`/library/${article.slug}`);
      const firstQuestion = screen.getAllByRole("heading", { level: 2 })[0].textContent ?? "";
      for (const pattern of GENERIC_OPENER_SUBSTRINGS) {
        expect(firstQuestion, `${article.slug}: "${firstQuestion}" 不應含有「${pattern}」`).not.toContain(pattern);
      }
      cleanup();
    }
  });

  it("每篇仍然只有一個 H1（getByRole 在多於一個相符節點時會直接拋錯，等同斷言唯一性）", () => {
    for (const article of LIBRARY_ARTICLES) {
      renderAt(`/library/${article.slug}`);
      expect(screen.getByRole("heading", { level: 1, name: article.h1 }), article.slug).toBeTruthy();
      cleanup();
    }
  });

  it("第一個問題與 body 實際第一個 heading 區塊文字不同（不是機械重複貼兩次同一句），且該 body heading 仍完整存在於畫面上", () => {
    for (const article of LIBRARY_ARTICLES) {
      renderAt(`/library/${article.slug}`);
      const h2Texts = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
      const firstBodyHeading = article.body.find(b => b.type === "heading")?.text;
      if (firstBodyHeading) {
        expect(h2Texts[0], article.slug).not.toBe(firstBodyHeading);
        expect(h2Texts, article.slug).toContain(firstBodyHeading);
      }
      cleanup();
    }
  });

  it("article body 結構沒有被破壞：相關館藏、NEXT STEP CTA 仍正常渲染（抽樣涵蓋新增/修改的 openingQuestions 條目）", () => {
    for (const slug of ["what-is-cnc-machining", "what-is-tolerance", "how-to-find-packaging-manufacturer", "what-is-moq", "first-time-factory-guide"]) {
      renderAt(`/library/${slug}`);
      expect(screen.getByTestId("related-articles"), slug).toBeTruthy();
      expect(document.querySelectorAll("a.library-cta-primary").length, slug).toBe(1);
      cleanup();
    }
  });
});

describe("LibraryArticle — 重點文字標示（見任務定案「Library 重點文字標示」）", () => {
  it("正文出現帶 emphasis class 的 <strong>，且文字內容正確（以 what-is-contract-manufacturing 為例）", () => {
    renderAt("/library/what-is-contract-manufacturing");
    const primaryStrong = Array.from(document.querySelectorAll("strong.library-emphasis-primary"));
    expect(primaryStrong.length).toBeGreaterThan(0);
    expect(primaryStrong.some(el => el.textContent === "適合你產品製造流程的合作夥伴")).toBe(true);
    const secondaryStrong = Array.from(document.querySelectorAll("strong.library-emphasis-secondary"));
    expect(secondaryStrong.length).toBeGreaterThan(0);
  });

  it("segments 渲染後的可見文字，逐字等於原本 text（emphasis 只改樣式，不改內容、不用 raw HTML）", () => {
    renderAt("/library/small-batch-manufacturing");
    const article = LIBRARY_ARTICLE_BY_SLUG["small-batch-manufacturing"];
    const withSegments = article.body.filter(
      (b): b is Extract<typeof article.body[number], { type: "paragraph" }> => b.type === "paragraph" && !!b.segments,
    );
    expect(withSegments.length).toBeGreaterThan(0);
    for (const block of withSegments) {
      expect(screen.getByText((_, node) => node?.textContent === block.text && node?.tagName.toLowerCase() === "p")).toBeTruthy();
    }
  });
});

describe("LibraryArticle — 返回按鈕不再是 deterministic（見任務定案「Library UX 修正」—返回上一頁恢復原本位置）", () => {
  it("FloatingBackButton 沒有 deterministic prop，走預設的 history.back()／sessionStorage fallback 行為", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "LibraryArticle.tsx"), "utf-8");
    const match = source.match(/<FloatingBackButton\b[\s\S]*?\/>/);
    expect(match).toBeTruthy();
    expect(match![0]).not.toContain("deterministic");
    expect(match![0]).toContain('fallbackHref="/library"');
  });
});

describe("LibraryArticle — 非法 slug", () => {
  it("渲染 NotFound，不是空白頁", () => {
    renderAt("/library/does-not-exist");
    expect(screen.queryByRole("heading", { level: 1, name: "MOQ 是什麼？代工廠最低訂購量怎麼談" })).toBeNull();
    // NotFound 頁面本身的確切文案不在這裡的驗證範圍內，只確認沒有把非法
    // slug 誤判成任何一篇真實文章、畫面上也沒有殘留任何 libraryId。
    expect(screen.queryByText(/^LIB-\d{3}$/)).toBeNull();
  });
});
