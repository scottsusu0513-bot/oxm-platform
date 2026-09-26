// @vitest-environment jsdom
/**
 * 後台工廠列表官網欄 regression（見對話「FactoriesList website」）：原本直接
 * 用原始 website 當 href（例如 href="無"），改用 shared/websiteUrl.ts
 * normalizeWebsiteUrl。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AdminFactoryWebsite } from "./FactoriesList";

afterEach(() => cleanup());

const link = (c: HTMLElement) => c.querySelector("a");

describe("AdminFactoryWebsite", () => {
  it.each([[null], [undefined], [""], ["   "]])("empty website %j renders nothing (existing UI)", (website) => {
    const { container } = render(<AdminFactoryWebsite website={website as string | null | undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it.each([["無"], ["N/A"], ["-"], ["javascript:alert(1)"], ["data:text/html,x"], ["ftp://example.com"]])(
    "invalid website %j is shown as plain text, never clickable",
    (website) => {
      const { container } = render(<AdminFactoryWebsite website={website} />);
      expect(link(container)).toBeNull();
      expect(container.textContent).toBe(website);
      expect(container.querySelector('[href="無"]')).toBeNull();
    }
  );

  it("example.com is normalized to https://", () => {
    const { container } = render(<AdminFactoryWebsite website="example.com" />);
    expect(link(container)?.getAttribute("href")).toBe("https://example.com");
    expect(link(container)?.textContent).toBe("example.com");
  });

  it("https URLs are kept, opened in a new tab with a safe rel", () => {
    const { container } = render(<AdminFactoryWebsite website="https://example.com/about" />);
    const a = link(container)!;
    expect(a.getAttribute("href")).toBe("https://example.com/about");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
