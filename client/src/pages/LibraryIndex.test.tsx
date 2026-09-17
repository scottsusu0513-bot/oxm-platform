// @vitest-environment jsdom
/**
 * /library 索引頁（見任務定案「傳產圖書館 Phase 1 實作」）。Navbar 需要
 * trpc／auth context 才能渲染，跟這裡要測的 index 頁邏輯無關，比照
 * FAQ.accordion.test.tsx 的既有慣例（mock 掉不相關的重依賴，只測真正相關
 * 的部分）直接 mock 掉，避免整份測試被迫另外接一整套 tRPC Provider。
 *
 * 涵蓋：
 *   26. index 渲染出 3 筆館藏記錄
 *   27. category filter 互動（點擊分類只顯示該分類、「全部館藏」顯示全部）
 *   32. 不是沿用 /news 的卡片版面（NewsDetail／News.tsx 用大面積封面圖 +
 *       「分享」「已讀」語彙，這裡確認 library card 沒有這些元素、且用的是
 *       「查閱資料」而不是「閱讀更多」/「熱門文章」這類 /news 慣用詞）
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

import LibraryIndex from "./LibraryIndex";
import { LIBRARY_ARTICLES } from "@shared/content/library";

afterEach(() => {
  cleanup();
});

function renderIndex() {
  render(
    <HelmetProvider>
      <LibraryIndex />
    </HelmetProvider>,
  );
}

describe("LibraryIndex — 渲染館藏記錄", () => {
  it("預設（全部館藏）渲染出全部 4 筆館藏資料卡", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    expect(cards).toHaveLength(LIBRARY_ARTICLES.length);
    expect(cards).toHaveLength(4);
  });

  it("卡片依 learningOrder（入門閱讀順序）排列，不是依陣列宣告順序或 libraryId：代工是什麼 → OEM/ODM → MOQ → 第一次找代工廠", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    const libraryIds = cards.map(c => c.querySelector(".library-record-id")?.textContent);
    expect(libraryIds).toEqual(["LIB-004", "LIB-002", "LIB-001", "LIB-003"]);
  });

  it("每張卡片顯示 libraryId、分類、標題、摘要、最後更新日期", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    for (const article of LIBRARY_ARTICLES) {
      // 3 篇文章的 updatedAt 目前剛好都是同一天，所以「最後更新」文字在畫面
      // 上不是唯一的，必須先用 libraryId（每張卡片唯一）鎖定卡片範圍，再用
      // within() 在該範圍內確認其餘欄位，避免 getByText 因為「找到多個相符
      // 元素」而誤判成測試失敗。
      const card = cards.find(c => c.textContent?.includes(article.libraryId));
      expect(card).toBeTruthy();
      const scoped = within(card!);
      expect(scoped.getByText(article.title)).toBeTruthy();
      expect(scoped.getByText(article.excerpt)).toBeTruthy();
      expect(scoped.getByText(new RegExp(`最後更新 ${article.updatedAt}`))).toBeTruthy();
    }
  });

  it("H1 與簡短說明存在", () => {
    renderIndex();
    expect(screen.getByRole("heading", { level: 1, name: "OXM 傳產圖書館" })).toBeTruthy();
  });
});

describe("LibraryIndex — category filter 互動", () => {
  it("點擊「代工基礎」（唯一有文章的分類）仍顯示全部 4 篇；其餘分類目前沒有文章", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "代工基礎" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(4);
  });

  it("點擊「製程與設備」（目前無文章）顯示空狀態文字，不是卡片", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "製程與設備" }));
    expect(screen.queryAllByTestId("library-card")).toHaveLength(0);
    expect(screen.getByText("此分類目前尚無館藏資料。")).toBeTruthy();
  });

  it("切回「全部館藏」恢復顯示 4 篇", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "材料知識" }));
    expect(screen.queryAllByTestId("library-card")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "全部館藏" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(4);
  });

  it("aria-selected 正確反映目前選中的分類", () => {
    renderIndex();
    const allTab = screen.getByRole("tab", { name: "全部館藏" });
    const basicsTab = screen.getByRole("tab", { name: "代工基礎" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(basicsTab);
    expect(basicsTab.getAttribute("aria-selected")).toBe("true");
    expect(allTab.getAttribute("aria-selected")).toBe("false");
  });
});

describe("LibraryIndex — 不是 /news 卡片版面的複製版", () => {
  it("卡片操作文案是「查閱資料」，不是 /news 慣用的「閱讀更多」「熱門文章」「最新文章」", () => {
    renderIndex();
    expect(screen.getAllByText("查閱資料").length).toBeGreaterThan(0);
    expect(screen.queryByText("閱讀更多")).toBeNull();
    expect(screen.queryByText("熱門文章")).toBeNull();
    expect(screen.queryByText("最新文章")).toBeNull();
  });

  it("卡片沒有封面圖片 <img>（/news 卡片用大面積封面圖，library 刻意不用）", () => {
    renderIndex();
    const cardList = screen.getByTestId("library-card-list");
    expect(cardList.querySelectorAll("img")).toHaveLength(0);
  });

  it("每個連結都指向 /library/:slug，不是 /news/:slug", () => {
    renderIndex();
    const cardList = screen.getByTestId("library-card-list");
    const links = Array.from(cardList.querySelectorAll("a"));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^\/library\//);
    }
  });
});
