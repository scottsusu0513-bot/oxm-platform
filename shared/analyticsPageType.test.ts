import { describe, expect, it } from "vitest";
import { classifyPathname } from "./analyticsPageType";

describe("classifyPathname", () => {
  it("首頁", () => {
    expect(classifyPathname("/")).toEqual({ pageType: "home", factoryId: null });
  });
  it("搜尋頁", () => {
    expect(classifyPathname("/search")).toEqual({ pageType: "search", factoryId: null });
  });
  it("工廠詳情頁，正確解析 factoryId", () => {
    expect(classifyPathname("/factory/123")).toEqual({ pageType: "factory", factoryId: 123 });
  });
  it("工廠詳情頁尾端有斜線也能解析", () => {
    expect(classifyPathname("/factory/456/")).toEqual({ pageType: "factory", factoryId: 456 });
  });
  it("/factories/:slug（單一 subIndustry SEO 頁）→ industry", () => {
    expect(classifyPathname("/factories/injection-molding")).toEqual({ pageType: "industry", factoryId: null });
  });
  it("/factories/:region/:industry（地區×產業組合頁）→ city_industry", () => {
    expect(classifyPathname("/factories/taipei/metal-processing")).toEqual({ pageType: "city_industry", factoryId: null });
  });
  it("/industry/:slug → industry", () => {
    expect(classifyPathname("/industry/metal-processing")).toEqual({ pageType: "industry", factoryId: null });
  });
  it("/industry/:slug/:sub → industry", () => {
    expect(classifyPathname("/industry/metal-processing/cnc")).toEqual({ pageType: "industry", factoryId: null });
  });
  it("/library 系列 → library", () => {
    expect(classifyPathname("/library")).toEqual({ pageType: "library", factoryId: null });
    expect(classifyPathname("/library/some-article")).toEqual({ pageType: "library", factoryId: null });
  });
  it("/news 系列 → news", () => {
    expect(classifyPathname("/news")).toEqual({ pageType: "news", factoryId: null });
    expect(classifyPathname("/news/123")).toEqual({ pageType: "news", factoryId: null });
  });
  it("/resources → resource", () => {
    expect(classifyPathname("/resources")).toEqual({ pageType: "resource", factoryId: null });
  });
  it("/talent → talent", () => {
    expect(classifyPathname("/talent")).toEqual({ pageType: "talent", factoryId: null });
  });
  it("/about → about", () => {
    expect(classifyPathname("/about")).toEqual({ pageType: "about", factoryId: null });
  });
  it("完全不認得的路徑 → other", () => {
    expect(classifyPathname("/some-random-admin-page")).toEqual({ pageType: "other", factoryId: null });
  });
  it("空字串安全 fallback 成首頁", () => {
    expect(classifyPathname("")).toEqual({ pageType: "home", factoryId: null });
  });
  it("非數字的 /factory/xxx 不會誤判成 factory pageType（避免把 /factory/register 這類頁面誤判）", () => {
    const result = classifyPathname("/factory/register");
    expect(result.pageType).not.toBe("factory");
  });
});
