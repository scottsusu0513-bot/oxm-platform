// @vitest-environment jsdom
/**
 * 「自然入口」——/industry/:industrySlug 主產業列正下方的子產業快速導覽列
 * （見任務定案）。這裡涵蓋的是元件層級、可以在 jsdom 下實際 render 驗證的
 * 行為（資料正確性、切換更新、連結目標、文字來源、結構）；左／中／右三種
 * 對齊公式本身是純函式，jsdom 的 getBoundingClientRect 永遠回傳全 0，無法
 * 用 render 驗證真實像素對齊結果，因此那部分改在
 * shared/subIndustryQuickNav.test.ts 直接單元測試 computeSubNavOffset。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IndustryQuickNav } from "./IndustryQuickNav";
import { SUB_INDUSTRY_SEARCH_ENTRIES } from "@shared/constants";

afterEach(() => {
  cleanup();
});

function subNavLinks(): HTMLAnchorElement[] {
  const container = screen.getByTestId("sub-industry-quick-nav");
  return Array.from(container.querySelectorAll("a"));
}

describe("IndustryQuickNav — 子產業資料正確對應目前主產業", () => {
  it("metal-processing（金屬加工）顯示自己底下全部子產業，且僅限這些", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const expected = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.parentIndustrySlug === "metal-processing").map(e => e.displayName);
    const rendered = subNavLinks().map(a => a.textContent);
    expect(rendered).toEqual(expected);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("textile（紡織）顯示自己的子產業，不會混入其他產業的子產業", () => {
    render(<IndustryQuickNav activeIndustryName="紡織" activeIndustrySlug="textile" />);
    const rendered = subNavLinks().map(a => a.textContent);
    expect(rendered).toContain("成衣");
    expect(rendered).not.toContain("CNC加工");
    expect(rendered).not.toContain("模具");
  });

  it("sustainable-materials（永續材料）顯示自己的子產業", () => {
    render(<IndustryQuickNav activeIndustryName="永續材料" activeIndustrySlug="sustainable-materials" />);
    const rendered = subNavLinks().map(a => a.textContent);
    expect(rendered).toEqual(
      SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.parentIndustrySlug === "sustainable-materials").map(e => e.displayName)
    );
  });

  it("切換 active 主產業後，子產業列內容立即更新為新主產業的子產業（不殘留舊的）", () => {
    const { rerender } = render(<IndustryQuickNav activeIndustryName="紡織" activeIndustrySlug="textile" />);
    expect(subNavLinks().map(a => a.textContent)).toContain("成衣");

    rerender(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const rendered = subNavLinks().map(a => a.textContent);
    expect(rendered).toContain("CNC加工");
    expect(rendered).not.toContain("成衣");
  });
});

describe("IndustryQuickNav — 連結行為", () => {
  it("每個子產業連結的 href 都是 /factories/:slug（canonical SEO landing page）", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const links = subNavLinks();
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^\/factories\/[a-z0-9-]+$/);
    }
    const cncLink = links.find(a => a.textContent === "CNC加工");
    expect(cncLink?.getAttribute("href")).toBe("/factories/cnc-machining");
    const moldLink = links.find(a => a.textContent === "模具");
    expect(moldLink?.getAttribute("href")).toBe("/factories/mold-making");
  });

  it("完全不會產生舊的 /industry/:parent/:sub 或 /search 連結", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    for (const a of subNavLinks()) {
      const href = a.getAttribute("href") ?? "";
      expect(href.startsWith("/industry/")).toBe(false);
      expect(href.startsWith("/search")).toBe(false);
    }
  });

  it("連結是真正的 <a href> 元素（SEO 可發現，不是 onClick + div），且沒有 nofollow", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const links = subNavLinks();
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.tagName).toBe("A");
      expect(a.getAttribute("rel") ?? "").not.toContain("nofollow");
    }
  });
});

describe("IndustryQuickNav — 顯示文字是 taxonomy displayName，不是 SEO primary keyword", () => {
  it("cnc-machining 顯示「CNC加工」，不是 SEO override 的「CNC 加工廠」", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const links = subNavLinks();
    const cncLink = links.find(a => a.getAttribute("href") === "/factories/cnc-machining");
    expect(cncLink?.textContent).toBe("CNC加工");
    expect(cncLink?.textContent).not.toContain("廠");
  });

  it("metal-materials 顯示「金屬原料」，不是 SEO override 的「金屬材料供應商」", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const links = subNavLinks();
    const link = links.find(a => a.getAttribute("href") === "/factories/metal-materials");
    expect(link?.textContent).toBe("金屬原料");
    expect(link?.textContent).not.toBe("金屬材料供應商");
  });

  it("large-format-printing 顯示「大圖輸出」（displayName 剛好等於 primary keyword 本身，屬正常重疊，非誤用）", () => {
    render(<IndustryQuickNav activeIndustryName="印刷" activeIndustrySlug="printing" />);
    const links = subNavLinks();
    const link = links.find(a => a.getAttribute("href") === "/factories/large-format-printing");
    expect(link?.textContent).toBe("大圖輸出");
  });
});

describe("IndustryQuickNav — 排除「其他」", () => {
  it("任何主產業的子產業列都不包含「其他」", () => {
    for (const [, slug] of [["紡織", "textile"], ["金屬加工", "metal-processing"], ["永續材料", "sustainable-materials"]] as const) {
      const { unmount } = render(<IndustryQuickNav activeIndustryName="" activeIndustrySlug={slug} />);
      const rendered = subNavLinks().map(a => a.textContent);
      expect(rendered).not.toContain("其他");
      unmount();
    }
  });
});

describe("IndustryQuickNav — 結構：單行、不產生第三排", () => {
  it("子產業列容器只有一個（不會同時渲染多排/第三排）", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    expect(screen.getAllByTestId("sub-industry-quick-nav")).toHaveLength(1);
  });

  it("子產業列外層容器有 overflow-x-auto（桌機/手機共用同一個橫向捲動機制，供撐爆單行時使用）", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const outer = screen.getByTestId("sub-industry-quick-nav");
    expect(outer.className).toContain("overflow-x-auto");
  });

  it("子產業列內層是 inline-flex 且沒有 flex-wrap（保證固定單行，不會自動換行產生第三排）", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const outer = screen.getByTestId("sub-industry-quick-nav");
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner.className).toContain("inline-flex");
    expect(inner.className).not.toContain("flex-wrap");
    expect(inner.className).toContain("whitespace-nowrap");
  });

  it("主產業列本身維持 flex-wrap（沒有被本輪改動行為），子產業列跟主產業列是各自獨立的兩個容器", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const mainNav = screen.getByText("金屬加工").closest("span")?.parentElement?.parentElement;
    expect(mainNav?.className).toContain("flex-wrap");
  });
});

describe("IndustryQuickNav — 桌機 anchor margin 只在 md 斷點套用（手機不套用複雜 anchor）", () => {
  it("子產業列內層 className 帶有 md: 前綴的 margin-left（手機版沒有這個前綴會被忽略，退回自然排列）", () => {
    render(<IndustryQuickNav activeIndustryName="金屬加工" activeIndustrySlug="metal-processing" />);
    const outer = screen.getByTestId("sub-industry-quick-nav");
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner.className).toMatch(/md:ml-\[var\(--sub-nav-offset\)\]/);
  });
});
