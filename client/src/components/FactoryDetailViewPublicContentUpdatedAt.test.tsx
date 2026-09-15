// @vitest-environment jsdom
/**
 * 工廠公開頁「資料最近維護時間」顯示的 regression test。
 *
 * 只聚焦這次任務新增的那一行顯示邏輯本身（factory.publicContentUpdatedAt →
 * formatPublicContentUpdatedAt() → 是否渲染「資料最近維護：...」），不是
 * FactoryDetailView 整體行為的完整測試——那已超出這輪任務範圍。日期格式化
 * 規則本身（不用相對時間、不顯示時分秒、null 安全）已經在
 * client/src/lib/factoryDates.test.ts 完整覆蓋。文案用「維護」不用「更新」
 * ——見 server/db.ts 的 PUBLIC_CONTENT_FACTORY_FIELDS 說明：這個欄位代表
 * 工廠近期主動維護公開資料，不要求內容一定實際改變。
 *
 * mock Navbar／LoginDialog 為極簡 stub，並補上 jsdom 沒有原生實作的
 * IntersectionObserver（FactoryDetailView 用它追蹤目前捲動到哪個章節），
 * 避免載入這兩個重量級元件與瀏覽器 API 缺口造成無關的測試失敗。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/LoginDialog", () => ({ default: () => null }));

import { FactoryDetailView, type FactoryDetailViewFactory } from "./FactoryDetailView";

beforeAll(() => {
  if (typeof (globalThis as any).IntersectionObserver === "undefined") {
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => {
  cleanup();
});

const BASE_FACTORY: FactoryDetailViewFactory = {
  id: 1,
  name: "測試工廠",
  products: [],
};

describe("FactoryDetailView：資料最近維護時間顯示", () => {
  it("(14) 有 publicContentUpdatedAt 時，公開頁顯示固定日期格式", () => {
    render(
      <FactoryDetailView
        factory={{ ...BASE_FACTORY, publicContentUpdatedAt: new Date(2026, 8, 15) }}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
      />
    );
    expect(screen.getByText("資料最近維護：2026 年 9 月 15 日")).toBeTruthy();
  });

  it("(16) publicContentUpdatedAt 缺失時不顯示壞字串（整行不渲染，不是 \"—\" 或 \"Invalid Date\"）", () => {
    render(
      <FactoryDetailView
        factory={{ ...BASE_FACTORY, publicContentUpdatedAt: null }}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
      />
    );
    expect(screen.queryByText(/資料最近維護/)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});
