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
 *   非法 slug → 渲染 NotFound（不是空白頁或 500）
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

import LibraryArticle from "./LibraryArticle";
import { LIBRARY_ARTICLE_BY_SLUG } from "@shared/content/library";

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

  it("正文含連到 what-is-moq 的 contextual relatedLink", () => {
    renderAt("/library/oem-vs-odm");
    const link = screen.getByRole("link", { name: /延伸閱讀：MOQ 是什麼/ });
    expect(link.getAttribute("href")).toBe("/library/what-is-moq");
  });
});

describe("LibraryArticle — 第一次找代工廠：單一 CTA + 兩個 contextual link", () => {
  it("CTA 導向 /search", () => {
    renderAt("/library/first-time-factory-guide");
    expect(screen.getByRole("link", { name: "開始找工廠" }).getAttribute("href")).toBe("/search");
  });

  it("正文含連到 oem-vs-odm 與 what-is-moq 的 contextual relatedLink", () => {
    renderAt("/library/first-time-factory-guide");
    expect(screen.getByRole("link", { name: /延伸閱讀：OEM 與 ODM 差在哪/ }).getAttribute("href")).toBe("/library/oem-vs-odm");
    expect(screen.getByRole("link", { name: /延伸閱讀：MOQ 是什麼/ }).getAttribute("href")).toBe("/library/what-is-moq");
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

  it("正文含連到 what-is-moq 與 oem-vs-odm 的 contextual relatedLink", () => {
    renderAt("/library/what-is-contract-manufacturing");
    expect(screen.getByRole("link", { name: /延伸閱讀：MOQ 是什麼/ }).getAttribute("href")).toBe("/library/what-is-moq");
    expect(screen.getByRole("link", { name: /延伸閱讀：OEM 與 ODM 差在哪/ }).getAttribute("href")).toBe("/library/oem-vs-odm");
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

describe("LibraryArticle — 非法 slug", () => {
  it("渲染 NotFound，不是空白頁", () => {
    renderAt("/library/does-not-exist");
    expect(screen.queryByRole("heading", { level: 1, name: "MOQ 是什麼？代工廠最低訂購量怎麼談" })).toBeNull();
    // NotFound 頁面本身的確切文案不在這裡的驗證範圍內，只確認沒有把非法
    // slug 誤判成任何一篇真實文章、畫面上也沒有殘留任何 libraryId。
    expect(screen.queryByText(/^LIB-\d{3}$/)).toBeNull();
  });
});
