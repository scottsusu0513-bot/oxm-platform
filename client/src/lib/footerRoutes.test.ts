import { describe, expect, it } from "vitest";
import { isFooterExcludedPath } from "./footerRoutes";

describe("isFooterExcludedPath", () => {
  it("排除 /admin 與所有 /admin/* 子路徑", () => {
    expect(isFooterExcludedPath("/admin")).toBe(true);
    expect(isFooterExcludedPath("/admin/factories")).toBe(true);
    expect(isFooterExcludedPath("/admin/conversations/1")).toBe(true);
  });

  it("排除 /admin-message/*", () => {
    expect(isFooterExcludedPath("/admin-message/1")).toBe(true);
  });

  it("排除顧問工作頁", () => {
    expect(isFooterExcludedPath("/consultant-center")).toBe(true);
    expect(isFooterExcludedPath("/certification-consultant/cases")).toBe(true);
    expect(isFooterExcludedPath("/erp-consultant/cases")).toBe(true);
    expect(isFooterExcludedPath("/short-video-consultant/cases")).toBe(true);
    expect(isFooterExcludedPath("/upgrade-consultant/cases")).toBe(true);
    expect(isFooterExcludedPath("/finance-consultant/cases")).toBe(true);
  });

  it("排除會員／工廠內部工具", () => {
    expect(isFooterExcludedPath("/dashboard")).toBe(true);
    expect(isFooterExcludedPath("/member")).toBe(true);
    expect(isFooterExcludedPath("/notifications")).toBe(true);
    expect(isFooterExcludedPath("/orders/123")).toBe(true);
  });

  it("排除 Chat 路徑", () => {
    expect(isFooterExcludedPath("/chat/new")).toBe(true);
    expect(isFooterExcludedPath("/chat/42")).toBe(true);
  });

  it("排除 /verify-email", () => {
    expect(isFooterExcludedPath("/verify-email")).toBe(true);
  });

  it("/manual 不排除（公開使用手冊，即使頁面本身 noNavbar）", () => {
    expect(isFooterExcludedPath("/manual")).toBe(false);
  });

  it("/register-factory 不排除", () => {
    expect(isFooterExcludedPath("/register-factory")).toBe(false);
  });

  it("公開服務 apply route 不因為是表單就被排除", () => {
    expect(isFooterExcludedPath("/certification-center/apply")).toBe(false);
    expect(isFooterExcludedPath("/erp-optimization/apply")).toBe(false);
    expect(isFooterExcludedPath("/short-video-marketing/apply")).toBe(false);
    expect(isFooterExcludedPath("/upgrade-center/apply")).toBe(false);
    expect(isFooterExcludedPath("/finance-optimization/apply")).toBe(false);
  });

  it("一般公開頁面不排除", () => {
    expect(isFooterExcludedPath("/")).toBe(false);
    expect(isFooterExcludedPath("/search")).toBe(false);
    expect(isFooterExcludedPath("/factory/123")).toBe(false);
    expect(isFooterExcludedPath("/industry/electronics")).toBe(false);
    expect(isFooterExcludedPath("/news")).toBe(false);
    expect(isFooterExcludedPath("/news/some-slug")).toBe(false);
    expect(isFooterExcludedPath("/about")).toBe(false);
    expect(isFooterExcludedPath("/faq")).toBe(false);
    expect(isFooterExcludedPath("/resources")).toBe(false);
    expect(isFooterExcludedPath("/talent")).toBe(false);
    expect(isFooterExcludedPath("/brand")).toBe(false);
    expect(isFooterExcludedPath("/privacy")).toBe(false);
    expect(isFooterExcludedPath("/terms")).toBe(false);
    expect(isFooterExcludedPath("/community")).toBe(false);
    expect(isFooterExcludedPath("/announcements")).toBe(false);
    expect(isFooterExcludedPath("/404")).toBe(false);
  });
});
