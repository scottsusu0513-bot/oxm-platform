// @vitest-environment jsdom
/**
 * 「相關工廠」推薦卡片（見任務定案「工廠詳情頁底部同類型工廠推薦」）。
 *
 * 涵蓋（見任務定案「二十、Tests」）：
 *   19. card 使用真正的 <a href>（一般模式）
 *   presentational 模式：沒有任何 <a>，供跑馬燈複製軌道使用（見
 *   RelatedFactoriesMarquee.test.tsx 的 18 號測試，兩邊互相驗證同一份契約）
 *   不顯示收藏／一鍵詢價／購物車／電話／官網／長簡介
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RelatedFactoryCard, type RelatedFactoryCardData } from "./RelatedFactoryCard";

afterEach(() => {
  cleanup();
});

const BASE: RelatedFactoryCardData = {
  id: 42,
  name: "測試精密工業",
  industry: ["金屬加工"],
  subIndustry: ["CNC 加工"],
  region: "台中市",
  mfgModes: ["OEM", "ODM"],
  avgRating: "4.5",
  reviewCount: 12,
};

describe("RelatedFactoryCard", () => {
  it("19. 一般模式渲染成真正的 <a href=\"/factory/:id\">", () => {
    render(<RelatedFactoryCard factory={BASE} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/factory/42");
  });

  it("顯示名稱、主/子產業、地區、mfgModes、評分", () => {
    render(<RelatedFactoryCard factory={BASE} />);
    expect(screen.getByText("測試精密工業")).toBeTruthy();
    expect(screen.getByText("CNC 加工")).toBeTruthy();
    expect(screen.getByText("台中市")).toBeTruthy();
    expect(screen.getByText("OEM")).toBeTruthy();
    expect(screen.getByText("ODM")).toBeTruthy();
    expect(screen.getByText("4.5（12）")).toBeTruthy();
  });

  it("沒有評論（reviewCount=0）時不顯示評分", () => {
    render(<RelatedFactoryCard factory={{ ...BASE, avgRating: "0", reviewCount: 0 }} />);
    expect(screen.queryByText(/（0）/)).toBeNull();
  });

  it("不顯示收藏／一鍵詢價／購物車／電話／官網／長簡介這類 Search 卡片才有的欄位", () => {
    render(<RelatedFactoryCard factory={BASE} />);
    expect(screen.queryByText(/加入一鍵詢價/)).toBeNull();
    expect(screen.queryByText(/收藏/)).toBeNull();
    expect(screen.queryByText(/聯絡電話/)).toBeNull();
    expect(screen.queryByText(/官方網站/)).toBeNull();
  });

  it("presentational 模式不渲染任何 <a>（供跑馬燈複製軌道使用，避免螢幕閱讀器／Tab 重複讀取同一批推薦）", () => {
    render(<RelatedFactoryCard factory={BASE} presentational />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelectorAll("a")).toHaveLength(0);
    // 內容本身仍然渲染（只是不可互動），供視覺上維持跟真實軌道一致。
    expect(screen.getByText("測試精密工業")).toBeTruthy();
  });
});
