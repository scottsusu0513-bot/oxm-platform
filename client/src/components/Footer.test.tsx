// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

afterEach(() => {
  cleanup();
});

describe("Footer", () => {
  it("(1) 品牌區內容存在：Logo、標語", () => {
    render(<Footer />);
    const logo = screen.getByAltText("OXM") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("/logo-oxm.png");
    expect(screen.getByText("台灣傳統產業資源媒合平台")).toBeTruthy();
  });

  it("(2) 六大平台服務 link 正確", () => {
    render(<Footer />);
    expect((screen.getByText("找工廠") as HTMLAnchorElement).getAttribute("href")).toBe("/search");
    expect((screen.getByText("找資源") as HTMLAnchorElement).getAttribute("href")).toBe("/resources");
    expect((screen.getByText("找人才") as HTMLAnchorElement).getAttribute("href")).toBe("/talent");
    expect((screen.getByText("找形象") as HTMLAnchorElement).getAttribute("href")).toBe("/brand");
    expect((screen.getByText("找消息") as HTMLAnchorElement).getAttribute("href")).toBe("/news");
    expect((screen.getByText("找討論") as HTMLAnchorElement).getAttribute("href")).toBe("/community");
  });

  it("(3) 關於 OXM／FAQ link 正確", () => {
    render(<Footer />);
    // "關於 OXM" 同時是這個區塊的 <h3> 標題與連結文字，用 role=link 精準鎖定連結本身。
    expect(screen.getByRole("link", { name: "關於 OXM" }).getAttribute("href")).toBe("/about");
    expect(screen.getByRole("link", { name: "FAQ" }).getAttribute("href")).toBe("/faq");
  });

  it("不再顯示「使用手冊」入口（/manual 目前僅限 admin，公開 Footer 不應提供一般訪客的入口）", () => {
    render(<Footer />);
    expect(screen.queryByRole("link", { name: "使用手冊" })).toBeNull();
    expect(screen.queryByText("使用手冊")).toBeNull();
  });

  it("(4) 服務條款／隱私權政策 link 正確", () => {
    render(<Footer />);
    expect((screen.getByText("服務條款") as HTMLAnchorElement).getAttribute("href")).toBe("/terms");
    expect((screen.getByText("隱私權政策") as HTMLAnchorElement).getAttribute("href")).toBe("/privacy");
  });

  it("(5) 客服 Email／LINE 存在", () => {
    render(<Footer />);
    const email = screen.getByText("scottsusu@oxmmatch.com") as HTMLAnchorElement;
    expect(email.getAttribute("href")).toBe("mailto:scottsusu@oxmmatch.com");
    const line = screen.getByLabelText("LINE") as HTMLAnchorElement;
    expect(line.getAttribute("href")).toBe("https://line.me/ti/p/@785bsmsr");
    expect(line.getAttribute("target")).toBe("_blank");
    expect(line.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("(6) 社群 link 正確（Instagram／Threads／Facebook），含 target/rel/aria-label", () => {
    render(<Footer />);
    const ig = screen.getByLabelText("Instagram") as HTMLAnchorElement;
    expect(ig.getAttribute("href")).toBe("https://www.instagram.com/oxmmatch_tw/?hl=zh-tw");
    expect(ig.getAttribute("target")).toBe("_blank");
    expect(ig.getAttribute("rel")).toBe("noopener noreferrer");

    const threads = screen.getByLabelText("Threads") as HTMLAnchorElement;
    expect(threads.getAttribute("href")).toBe("https://www.threads.com/@oxmmatch_tw");

    const fb = screen.getByLabelText("Facebook") as HTMLAnchorElement;
    expect(fb.getAttribute("href")).toBe("https://www.facebook.com/profile.php?id=61564590907055");
  });

  it("(7) copyright 年份正常（使用當年，非寫死字串）", () => {
    render(<Footer />);
    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`${year} OXM`))).toBeTruthy();
  });

  it("使用 semantic <footer> 與單一 <nav aria-label=\"頁尾導覽\">", () => {
    const { container } = render(<Footer />);
    expect(container.querySelector("footer")).toBeTruthy();
    const navs = container.querySelectorAll('nav[aria-label="頁尾導覽"]');
    expect(navs.length).toBe(1);
  });
});
