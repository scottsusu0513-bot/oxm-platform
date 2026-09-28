/**
 * shared/clientRoutes.ts 與 client/src/App.tsx 路由的一致性（Production
 * Hardening Batch 1）。
 *
 * server 端用 CLIENT_ROUTE_PATTERNS 判斷「未知路由 → HTTP 404」。清單一旦
 * 跟 App.tsx 脫鉤，正常網址就會被誤判成 404，所以這裡直接解析 App.tsx 原始碼
 * 的 <Route path="...">，要求兩邊集合完全相同，並逐一驗證每個 pattern 的代表
 * 網址都會被 matchesClientRoute 視為合法。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_ROUTE_PATTERNS, CLIENT_NOT_FOUND_ROUTE, compileClientRoutePattern, matchesClientRoute } from "@shared/clientRoutes";

function appRoutePaths(): string[] {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "..", "client", "src", "App.tsx"), "utf-8");
  return Array.from(source.matchAll(/<Route\s+path="([^"]+)"/g), m => m[1]);
}

/** 把 pattern 轉成一個代表性的真實網址（:param → 範例值，*? → 子路徑）。 */
function samplePath(pattern: string): string {
  return pattern
    .split("/")
    .map(seg => (seg.startsWith(":") ? "sample-1" : seg === "*?" ? "a/b" : seg))
    .join("/") || "/";
}

describe("CLIENT_ROUTE_PATTERNS 與 App.tsx 完全一致", () => {
  it("集合相同（新增／刪除路由時兩邊必須一起改）", () => {
    const fromApp = appRoutePaths();
    expect(fromApp.length).toBeGreaterThan(50);
    expect([...CLIENT_ROUTE_PATTERNS].sort()).toEqual([...new Set(fromApp)].sort());
  });
});

describe("每一個合法 client route pattern 都不會被判定成未知路由", () => {
  const patterns = CLIENT_ROUTE_PATTERNS.filter(p => p !== CLIENT_NOT_FOUND_ROUTE);
  it.each(patterns)("%s", (pattern) => {
    const url = samplePath(pattern);
    expect(matchesClientRoute(url)).toBe(true);
    expect(matchesClientRoute(`${url}/`.replace(/\/\/$/, "/"))).toBe(true); // 結尾斜線
    expect(matchesClientRoute(url.toUpperCase())).toBe(true); // 與 wouter 相同不分大小寫
  });

  it("中文等 percent-encoded 參數仍視為合法", () => {
    expect(matchesClientRoute("/news/%E6%B8%AC%E8%A9%A6")).toBe(true);
    expect(matchesClientRoute("/factories/taipei/%E5%A1%91%E8%86%A0")).toBe(true);
  });

  it("/community/*? 同時涵蓋 /community 本身與任意深度子路徑", () => {
    expect(matchesClientRoute("/community")).toBe(true);
    expect(matchesClientRoute("/community/metal")).toBe(true);
    expect(matchesClientRoute("/community/metal/discussions/12")).toBe(true);
  });
});

describe("未知路由", () => {
  it.each([
    "/this-page-does-not-exist-audit",
    "/factory",            // /factory/:id 需要 id
    "/factory/1/extra",    // 多一段
    "/industry/a/b/c",
    "/chat",
    "/404",
    "/404/",
  ])("%s → 不是合法路由", (url) => {
    expect(matchesClientRoute(url)).toBe(false);
  });
});

describe("compileClientRoutePattern 與 wouter（regexparam）語意一致", () => {
  it(":param 只吃單一路徑段", () => {
    const re = compileClientRoutePattern("/factory/:id");
    expect(re.test("/factory/26")).toBe(true);
    expect(re.test("/factory/")).toBe(false);
    expect(re.test("/factory/26/x")).toBe(false);
  });
  it("靜態段不會被當成正規表示式", () => {
    const re = compileClientRoutePattern("/a.b");
    expect(re.test("/a.b")).toBe(true);
    expect(re.test("/axb")).toBe(false);
  });
});
