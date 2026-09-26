// @vitest-environment jsdom
/**
 * FactoryDetailView 官網連結 regression（見對話「FactoryResultCard nested <a> /
 * href="無"」）：官網 href 改由 shared/websiteUrl.ts normalizeWebsiteUrl 產生，
 * 與搜尋卡片同一套規則。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/LoginDialog", () => ({ default: () => null }));

import { FactoryDetailView } from "./FactoryDetailView";

beforeAll(() => {
  if (typeof (globalThis as any).IntersectionObserver === "undefined") {
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterEach(() => cleanup());

function renderDetail(website: string | null, isPreview = false) {
  return render(
    <FactoryDetailView
      factory={{ id: 1, name: "測試工廠", products: [], website }}
      photos={[]}
      categories={[]}
      reviewData={{ items: [] }}
      isAuthenticated={false}
      similarFactories={[]}
      mode={isPreview ? "preview" : undefined}
    />
  );
}

const websiteAnchors = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));

describe("FactoryDetailView website", () => {
  it("valid scheme-less website → https:// external link with safe rel", () => {
    const { container } = renderDetail("example.com");
    const anchors = websiteAnchors(container);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.getAttribute("href")).toBe("https://example.com");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it.each([["無"], ["javascript:alert(1)"], ["data:text/html,x"], ["https://無"]])(
    "website=%j never produces a clickable link",
    (website) => {
      const { container } = renderDetail(website);
      expect(websiteAnchors(container)).toHaveLength(0);
      expect(container.querySelector('a[href="無"]')).toBeNull();
      expect(container.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
    }
  );

  it("preview mode shows the website as text only", () => {
    const { container } = renderDetail("https://example.com", true);
    expect(websiteAnchors(container)).toHaveLength(0);
  });
});
