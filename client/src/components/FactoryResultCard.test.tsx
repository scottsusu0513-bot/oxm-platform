// @vitest-environment jsdom
/**
 * FactoryResultCard DOM／官網連結 regression（見對話「FactoryResultCard nested
 * <a> / href="無"」）：
 * - 原本整張卡片包在 wouter <Link>（<a>）裡，電話／官網 <a> 與收藏／詢價
 *   <button> 都巢狀在 <a> 內（React 報 "<a> cannot be a descendant of <a>"）。
 * - 原本官網只判斷 truthy，website="無" 會直接變成 href="無"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: { favorite: { toggle: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
}));

import { FactoryCard } from "./FactoryResultCard";

const noop = () => {};
function renderCard(factory: Record<string, unknown>, extra: { previewMode?: boolean; isMobile?: boolean } = {}) {
  return render(
    <FactoryCard
      factory={{ id: 42, name: "測試工廠", avgRating: 4.5, reviewCount: 3, mfgModes: ["OEM"], ...factory }}
      getFavState={() => false}
      handleFavToggle={noop}
      cartHas={() => false}
      cartAdd={noop}
      cartRemove={noop}
      setCartOpen={noop}
      isMobile={extra.isMobile ?? false}
      previewMode={extra.previewMode}
    />
  );
}

const externalLinks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));

let pushState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.history.replaceState(null, "", "/search");
  pushState = vi.spyOn(window.history, "pushState");
});
afterEach(() => {
  pushState.mockRestore();
  cleanup();
});

describe("FactoryResultCard DOM structure", () => {
  it("has no nested interactive content inside any <a>", () => {
    const { container } = renderCard({ website: "https://example.com", phone: "02-1234-5678" }, { isMobile: true });
    expect(container.querySelectorAll("a a").length).toBe(0);
    expect(container.querySelectorAll("a button").length).toBe(0);
    // phone (mobile), website, and the detail link are all present, as siblings
    expect(container.querySelectorAll("a").length).toBe(3);
  });

  it("the card's detail link goes to /factory/:id and stretches over the card", () => {
    renderCard({ website: null });
    const link = screen.getByRole("link", { name: "測試工廠" });
    expect(link.getAttribute("href")).toBe("/factory/42");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    fireEvent.click(link);
    expect(pushState).toHaveBeenCalled();
    expect(String(pushState.mock.calls.at(-1)?.[2])).toBe("/factory/42");
  });

  it("a valid website is a separate, safe external link that does not trigger card navigation", () => {
    const { container } = renderCard({ website: "https://example.com" });
    const [site] = externalLinks(container);
    expect(site.getAttribute("href")).toBe("https://example.com");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    expect(site.parentElement?.closest("a")).toBeNull();
    fireEvent.click(site);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("favorite / inquiry buttons are real buttons outside any link and do not navigate", () => {
    renderCard({ website: null });
    const inquiry = screen.getByRole("button", { name: /加入一鍵詢價/ });
    expect(inquiry.closest("a")).toBeNull();
    fireEvent.click(inquiry);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("keyboard: the detail link and each action are separately focusable", () => {
    renderCard({ website: "example.com" });
    const link = screen.getByRole("link", { name: "測試工廠" });
    link.focus();
    expect(document.activeElement).toBe(link);
    const site = screen.getByRole("link", { name: "連結" });
    site.focus();
    expect(document.activeElement).toBe(site);
  });

  it("preview mode renders no links", () => {
    const { container } = renderCard({ website: "https://example.com" }, { previewMode: true });
    expect(container.querySelector('a[href^="/factory/"]')).toBeNull();
  });
});

describe("FactoryResultCard website", () => {
  it.each([["無"], [""], ["   "], [null], [undefined], ["N/A"], ["-"], ["javascript:alert(1)"], ["data:text/html,<b>x</b>"]])(
    "website=%j renders plain 「無」 without any external link",
    (website) => {
      const { container } = renderCard({ website });
      expect(externalLinks(container)).toHaveLength(0);
      expect(container.querySelector('a[href="無"]')).toBeNull();
      expect(container.querySelector('a[href*="://無"]')).toBeNull();
      expect(container.textContent).toContain("官方網站：無");
    }
  );

  it("scheme-less domains are normalized to https://", () => {
    const { container } = renderCard({ website: "www.example.com" });
    expect(externalLinks(container)[0].getAttribute("href")).toBe("https://www.example.com");
  });

  it("http:// URLs are kept", () => {
    const { container } = renderCard({ website: "http://example.com" });
    expect(externalLinks(container)[0].getAttribute("href")).toBe("http://example.com");
  });
});
