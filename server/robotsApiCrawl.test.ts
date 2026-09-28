/**
 * robots.txt：Googlebot 渲染公開頁需要的 tRPC 請求不得被 Disallow
 * （Production Hardening Batch 1）。
 *
 * 修正前 `Disallow: /api`＋`Disallow: /api/trpc` 讓 Googlebot 渲染工廠頁時抓
 * 不到資料，正文變成「找不到此工廠」。這裡用 Google 的比對規則（最長路徑
 * 優先，長度相同時 Allow 優先）直接評估 ROBOTS_TXT，而不是比對字串片段。
 */
import { describe, expect, it } from "vitest";
import { ROBOTS_TXT } from "./_core/robots";

type Rule = { allow: boolean; path: string };

function parseRules(robots: string): Rule[] {
  return robots
    .split("\n")
    .map(line => line.trim())
    .map(line => /^(Allow|Disallow):\s*(\S*)$/i.exec(line))
    .filter((m): m is RegExpExecArray => !!m && m[2] !== "")
    .map(m => ({ allow: m[1].toLowerCase() === "allow", path: m[2] }));
}

/** Google robots.txt 比對：取最長的符合前綴；長度相同時 Allow 勝出。 */
function isAllowed(robots: string, urlPath: string): boolean {
  const matches = parseRules(robots).filter(r => urlPath.startsWith(r.path));
  if (matches.length === 0) return true;
  matches.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0].allow;
}

describe("ROBOTS_TXT：公開頁渲染所需的 tRPC 請求可被抓取", () => {
  it.each([
    "/api/trpc/factory.getById?input=%7B%22json%22%3A%7B%22id%22%3A26%7D%7D",
    "/api/trpc/factory.getById,product.getByFactory,factory.getPhotos?batch=1&input=%7B%7D",
    "/api/trpc/factory.search?input=%7B%7D",
    "/api/trpc/news.getBySlug?input=%7B%7D",
  ])("允許 %s", (url) => {
    expect(isAllowed(ROBOTS_TXT, url)).toBe(true);
  });

  it("只有 User-agent: * 一個群組（不會另外針對 Googlebot 覆寫規則）", () => {
    expect(ROBOTS_TXT.match(/^User-agent:/gim)).toHaveLength(1);
    expect(ROBOTS_TXT).toMatch(/^User-agent: \*$/m);
  });
});

describe("ROBOTS_TXT：其他 /api 與私人頁面維持禁止", () => {
  it.each([
    "/api/oauth/callback?code=x",
    "/api/cron/order-overdue-email-check",
    "/api/logout",
    "/api/health",
    "/admin",
    "/admin/factories",
    "/dashboard",
    "/messages",
    "/chat/12",
  ])("禁止 %s", (url) => {
    expect(isAllowed(ROBOTS_TXT, url)).toBe(false);
  });

  it("公開頁面允許", () => {
    for (const url of ["/", "/factory/26", "/search?keyword=cnc", "/industry/metal", "/factories/taipei/metal"]) {
      expect(isAllowed(ROBOTS_TXT, url)).toBe(true);
    }
  });

  it("仍宣告 sitemap", () => {
    expect(ROBOTS_TXT).toContain("Sitemap: https://www.oxmmatch.com/sitemap.xml");
  });
});
