// @vitest-environment jsdom
/**
 * 工廠詳情頁「相關工廠」區塊整合測試（見任務定案「工廠詳情頁底部同類型工廠
 * 推薦」／「無論相關工廠數量多少都要有內容，不要整區隱藏」）。只聚焦這次
 * 任務新增的區塊本身要不要渲染、渲染在哪裡——不是 FactoryDetailView 整體
 * 行為的完整測試（同 FactoryDetailViewPublicContentUpdatedAt.test.tsx
 * 既有原則）。
 *
 * 涵蓋：
 *   0 筆真實推薦 → section 仍渲染，全部是招募卡補位，沒有任何假工廠連結/資料
 *   1 筆真實推薦 → section 渲染，1 張真實卡 + 招募卡補位
 *   3 筆真實推薦 → section 渲染，3 張真實卡 + 招募卡補位
 *   8 筆真實推薦 → section 渲染，全部真實卡，不需要招募卡
 *   similarFactories 為 undefined（載入中／查詢失敗）→ 區塊不渲染
 *   public 模式 → 區塊渲染，標題「相關工廠」；preview 模式 → 不渲染
 *   「相關工廠」在「顧客評價」之後（DOM 順序）
 *   招募卡 CTA 使用真實既有 route（/register-factory）
 *   真實工廠卡仍使用 /factory/:id
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/LoginDialog", () => ({ default: () => null }));

import { FactoryDetailView, type FactoryDetailViewFactory } from "./FactoryDetailView";
import type { RelatedFactoryCardData } from "./RelatedFactoryCard";

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

function makeSimilar(count: number): RelatedFactoryCardData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    name: `相關工廠 ${i + 1}`,
    industry: ["金屬加工"],
    region: "台中市",
    mfgModes: ["OEM"],
  }));
}

describe("FactoryDetailView — 相關工廠區塊", () => {
  it("0 筆真實推薦 → section 仍渲染，用招募卡補位，沒有任何真實工廠連結", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={[]}
      />
    );
    expect(screen.getByText("相關工廠")).toBeTruthy();
    expect(screen.getByText("目前這個類別仍有更多合作夥伴進駐空間")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /相關工廠 \d/ })).toBeNull();
    expect(screen.getAllByTestId("recruitment-card").length).toBeGreaterThan(0);
    // 招募卡沒有偽造任何看起來像真實工廠的資料。
    for (const card of screen.getAllByTestId("recruitment-card")) {
      expect(card.textContent).not.toMatch(/OEM|ODM|OBM/);
    }
  });

  it("1 筆真實推薦 → 1 張真實卡 + 招募卡補位", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(1)}
      />
    );
    expect(screen.getByText("相關工廠")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /相關工廠 \d/ })).toHaveLength(1);
    expect(screen.getAllByTestId("recruitment-card").length).toBeGreaterThan(0);
  });

  it("3 筆真實推薦 → 3 張真實卡 + 招募卡補位，副標維持一般文案", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(3)}
      />
    );
    expect(screen.getByText("相關工廠")).toBeTruthy();
    expect(screen.getByText("看看其他提供相近製程與服務的工廠")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /相關工廠 \d/ })).toHaveLength(3);
    expect(screen.getAllByTestId("recruitment-card").length).toBeGreaterThan(0);
  });

  it("8 筆真實推薦 → 全部真實卡，不需要招募卡", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(8)}
      />
    );
    expect(screen.getAllByRole("link", { name: /相關工廠 \d/ })).toHaveLength(8);
    expect(screen.queryAllByTestId("recruitment-card")).toHaveLength(0);
  });

  it("similarFactories 為 undefined（載入中／查詢失敗）→ 區塊不渲染", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
      />
    );
    expect(screen.queryByText("相關工廠")).toBeNull();
  });

  it("public 模式（預設）→ 區塊渲染，標題「相關工廠」", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(3)}
      />
    );
    expect(screen.getByText("相關工廠")).toBeTruthy();
  });

  it("preview 模式：即使有足夠推薦資料，也不渲染區塊", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        mode="preview"
        similarFactories={makeSimilar(8)}
      />
    );
    expect(screen.queryByText("相關工廠")).toBeNull();
  });

  it("preview 模式：即使 similarFactories 是空陣列，也不會冒出招募卡", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        mode="preview"
        similarFactories={[]}
      />
    );
    expect(screen.queryByTestId("recruitment-card")).toBeNull();
  });

  it("「相關工廠」區塊在「顧客評價」之後（DOM 順序）", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(3)}
      />
    );
    const reviewsSection = document.querySelector("#section-reviews");
    const relatedSection = document.querySelector("#section-related-factories");
    expect(reviewsSection).toBeTruthy();
    expect(relatedSection).toBeTruthy();
    // Node.compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) 表示
    // relatedSection 在 reviewsSection 之後。
    const position = reviewsSection!.compareDocumentPosition(relatedSection!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("招募卡 CTA 使用真實既有 route（/register-factory），真實工廠卡仍使用 /factory/:id", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(2)}
      />
    );
    // 真實軌道與複製軌道都會渲染同一批卡片，複製軌道用 presentational
    // 模式（沒有 href），這裡只在「真實（非複製）軌道」範圍內驗證 href。
    const realTrackEl = document.querySelector(".related-marquee-track:not(.related-marquee-track-duplicate)")!;
    const factoryLinks = within(realTrackEl as HTMLElement).getAllByRole("link", { name: /相關工廠 \d/ });
    for (const link of factoryLinks) {
      expect(link.getAttribute("href")).toMatch(/^\/factory\/\d+$/);
    }
    const recruitmentCards = within(realTrackEl as HTMLElement).getAllByTestId("recruitment-card");
    for (const card of recruitmentCards) {
      expect(card.getAttribute("href")).toBe("/register-factory");
    }
  });

  it("複製軌道（duplicate track）不會增加任何可互動的招募 CTA 或工廠連結", () => {
    render(
      <FactoryDetailView
        factory={BASE_FACTORY}
        photos={[]}
        categories={[]}
        reviewData={{ items: [] }}
        isAuthenticated={false}
        similarFactories={makeSimilar(2)}
      />
    );
    // 2 家真實工廠 + 6 張招募卡補到 8 張＝真實軌道 8 個連結；複製軌道用
    // presentational 模式渲染，完全不含 <a>，總連結數應該還是只有 8。
    const relatedSection = document.querySelector("#section-related-factories")!;
    expect(relatedSection.querySelectorAll("a")).toHaveLength(8);
  });
});
