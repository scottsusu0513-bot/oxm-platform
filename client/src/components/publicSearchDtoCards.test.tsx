// @vitest-environment jsdom
/**
 * Batch 3.1：factory.search／getSimilar 改回傳明確白名單 DTO（見
 * server/publicFactoryDto.ts）後，所有吃這個形狀的卡片（搜尋結果卡片桌機／
 * 手機、SEO landing 卡片、相關工廠卡片）只拿到白名單欄位也必須正常渲染：
 * 不 crash、不出現 "undefined"／"null" 字樣、頭貼有圖時不壞圖、沒圖時有
 * fallback、沒有 React key warning。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: { favorite: { toggle: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
}));

import { FactoryCard } from "./FactoryResultCard";
import { RelatedFactoryCard } from "./RelatedFactoryCard";
import { FactoriesLandingResults } from "./seo/FactoriesLandingResults";

/** 與 server/publicFactoryDto.ts toPublicFactorySearchResult 的輸出欄位完全相同。 */
const dto = (over: Record<string, unknown> = {}) => ({
  id: 7, name: "白名單工廠", industry: ["金屬加工"], subIndustry: ["金屬加工-CNC"], mfgModes: ["OEM", "ODM"],
  region: "新北市", description: "描述文字", capitalLevel: "<1000萬", foundedYear: 1999, ownerName: "王先生",
  contactPersonName: "李小姐", phone: "02-1234-5678", website: "https://example.test", address: "新北市某路 1 號",
  avgRating: "4.50", reviewCount: 3, avatarUrl: "https://img.example.test/a.jpg", avatarCrop: null,
  businessType: "factory", operationStatus: "normal", certified: false, weekdayHours: "08:00-17:00", weekendHours: null,
  certificationBadgesVisible: ["bni"], ...over,
});

const noop = () => {};
afterEach(() => cleanup());

function captureErrors() {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
  return { errors, restore: () => spy.mockRestore() };
}

describe("DTO-only 物件渲染", () => {
  for (const isMobile of [false, true]) {
    it(`FactoryResultCard（${isMobile ? "手機" : "桌機"}）：名稱／地區／評分／描述／頭貼正常，無 undefined`, () => {
      const cap = captureErrors();
      for (const f of [dto(), dto({ id: 8, avatarUrl: null, description: null, website: null, phone: null })]) {
        const { container, unmount } = render(
          <FactoryCard factory={f} getFavState={() => false} handleFavToggle={noop} cartHas={() => false}
            cartAdd={noop} cartRemove={noop} setCartOpen={noop} isMobile={isMobile} />,
        );
        const text = container.textContent ?? "";
        expect(text).toContain(String(f.name));
        expect(text).toContain("新北市");
        expect(text).toContain("4.5");
        expect(text).not.toMatch(/undefined|NaN|\bnull\b/);
        const imgs = Array.from(container.querySelectorAll("img"));
        if (f.avatarUrl) expect(imgs.some(i => i.getAttribute("src") === f.avatarUrl)).toBe(true);
        for (const img of imgs) expect(img.getAttribute("src")).toBeTruthy();
        unmount();
      }
      cap.restore();
      expect(cap.errors.filter(e => /key|undefined/i.test(e))).toEqual([]);
    });
  }

  it("RelatedFactoryCard：DTO-only 物件正常渲染", () => {
    const { container } = render(<RelatedFactoryCard factory={dto() as any} />);
    expect(container.textContent).toContain("白名單工廠");
    expect(container.textContent).not.toMatch(/undefined|NaN/);
  });

  it("FactoriesLandingResults（SEO 產業／地區頁）：產業 badge、地區、評分正常，無 key warning", () => {
    const cap = captureErrors();
    const { container } = render(
      <FactoriesLandingResults isLoading={false} factories={[dto(), dto({ id: 9, avatarUrl: null })]} total={2} viewAllHref="/search" viewAllLabel="全部" />,
    );
    cap.restore();
    expect(container.textContent).toContain("金屬加工");
    expect(container.textContent).toContain("OEM");
    expect(container.textContent).not.toMatch(/undefined|NaN/);
    expect(cap.errors.filter(e => /key/i.test(e))).toEqual([]);
  });
});
