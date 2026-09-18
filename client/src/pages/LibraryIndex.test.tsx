// @vitest-environment jsdom
/**
 * /library 索引頁（見任務定案「傳產圖書館 Phase 1 實作」）。Navbar 需要
 * trpc／auth context 才能渲染，跟這裡要測的 index 頁邏輯無關，比照
 * FAQ.accordion.test.tsx 的既有慣例（mock 掉不相關的重依賴，只測真正相關
 * 的部分）直接 mock 掉，避免整份測試被迫另外接一整套 tRPC Provider。
 *
 * 涵蓋：
 *   26. index 渲染出全部館藏記錄
 *   27. category filter 互動（點擊分類只顯示該分類、「全部館藏」顯示全部）
 *   32. 不是沿用 /news 的卡片版面（NewsDetail／News.tsx 用大面積封面圖 +
 *       「分享」「已讀」語彙，這裡確認 library card 沒有這些元素、且用的是
 *       「查閱資料」而不是「閱讀更多」/「熱門文章」這類 /news 慣用詞）
 *   「傳產圖書館內容完成階段」（Level 3～6，45 篇）上線後：四個分類都有
 *   文章（不再有空分類），且卡片排序讀 learningOrder。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

import LibraryIndex from "./LibraryIndex";
import { LIBRARY_ARTICLES } from "@shared/content/library";

const FILTER_STORAGE_KEY = "oxm.library.filter";

beforeEach(() => {
  // 每個測試從乾淨的 sessionStorage 開始，避免「返回上一頁恢復原本位置」的
  // filter persistence（見任務定案「Library UX 修正」）造成測試互相污染。
  try { sessionStorage.removeItem(FILTER_STORAGE_KEY); } catch { /* unavailable */ }
});

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
  it("預設（全部館藏）渲染出全部 45 筆館藏資料卡", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    expect(cards).toHaveLength(LIBRARY_ARTICLES.length);
    expect(cards).toHaveLength(45);
  });

  it("卡片依 learningOrder（入門閱讀順序）排列，不是依陣列宣告順序或 libraryId：Level 1～6 依實際閱讀順序排列", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    const libraryIds = cards.map(c => c.querySelector(".library-record-id")?.textContent);
    expect(libraryIds).toEqual([
      // Level 1 + 2
      "LIB-004", "LIB-002", "LIB-001", "LIB-003",
      "LIB-005", "LIB-008", "LIB-006", "LIB-007", "LIB-009",
      // Level 3（10～25）
      "LIB-010", "LIB-011", "LIB-012", "LIB-013", "LIB-014", "LIB-015", "LIB-016", "LIB-017",
      "LIB-018", "LIB-019", "LIB-020", "LIB-021", "LIB-022", "LIB-023", "LIB-024", "LIB-025",
      // Level 4（26～35，內部順序：28,27,26,29,30,31,32,33,34,35）
      "LIB-028", "LIB-027", "LIB-026", "LIB-029", "LIB-030", "LIB-031", "LIB-032", "LIB-033", "LIB-034", "LIB-035",
      // Level 5（36～40）
      "LIB-036", "LIB-037", "LIB-038", "LIB-039", "LIB-040",
      // Level 6（41～45）
      "LIB-041", "LIB-042", "LIB-043", "LIB-044", "LIB-045",
    ]);
  });

  it("每張卡片顯示 libraryId、分類、標題、摘要、最後更新日期", () => {
    renderIndex();
    const cards = screen.getAllByTestId("library-card");
    for (const article of LIBRARY_ARTICLES) {
      // 好幾篇文章的 updatedAt 剛好是同一天，所以「最後更新」文字在畫面上
      // 不是唯一的，必須先用 libraryId（每張卡片唯一）鎖定卡片範圍，再用
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
  it("點擊「代工基礎」顯示該分類的 5 篇", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "代工基礎" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(5);
  });

  it("點擊「採購與品質」顯示該分類的 7 篇", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "採購與品質" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(7);
  });

  it("點擊「製程與設備」顯示該分類的 23 篇（內容完成階段新增後不再是空分類）", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "製程與設備" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(23);
  });

  it("點擊「材料知識」顯示該分類的 10 篇（內容完成階段新增後不再是空分類）", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "材料知識" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(10);
  });

  it("切回「全部館藏」恢復顯示 45 篇", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "材料知識" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(10);
    fireEvent.click(screen.getByRole("tab", { name: "全部館藏" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(45);
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

describe("LibraryIndex — category filter 用 sessionStorage 持久化（見任務定案「Library UX 修正」—返回上一頁恢復原本位置）", () => {
  it("點選分類後，sessionStorage 記下這個選擇", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "採購與品質" }));
    expect(sessionStorage.getItem(FILTER_STORAGE_KEY)).toBe("採購與品質");
  });

  it("重新掛載（模擬瀏覽器 history.back() 讓元件重新掛載）會恢復上次選擇的分類，不是重置回「全部館藏」", () => {
    renderIndex();
    fireEvent.click(screen.getByRole("tab", { name: "採購與品質" }));
    expect(screen.getAllByTestId("library-card")).toHaveLength(7);
    cleanup();

    renderIndex();
    const restoredTab = screen.getByRole("tab", { name: "採購與品質" });
    expect(restoredTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("library-card")).toHaveLength(7);
  });

  it("sessionStorage 沒有值（例如第一次進站）時，預設仍是「全部館藏」", () => {
    renderIndex();
    const allTab = screen.getByRole("tab", { name: "全部館藏" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("library-card")).toHaveLength(45);
  });

  it("sessionStorage 存了不合法的分類字串（防禦性處理）時，忽略並 fallback 回「全部館藏」，不會整頁壞掉", () => {
    sessionStorage.setItem(FILTER_STORAGE_KEY, "不存在的分類");
    renderIndex();
    const allTab = screen.getByRole("tab", { name: "全部館藏" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("library-card")).toHaveLength(45);
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
