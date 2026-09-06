/**
 * 原「找代工指南」Blog（/blog 與所有 /blog/* 舊文章路徑）已主動、永久移除，
 * 且沒有等價替代頁面——伺服器端在所有 SPA fallback 之前攔截，回 HTTP 410
 * Gone + noindex，不 redirect、不回 200、不重建 Blog route。
 *
 * 這裡驗證：
 *  1. isGonePath 的比對範圍（/blog 與 /blog/* 命中；其他路徑一律不命中）
 *  2. 410 HTML 本身帶 <meta name="robots" content="noindex, nofollow">，且不是 redirect
 *  3. setupGoneRoutes middleware 對 GET/HEAD 的 /blog* 回 410、其餘一律 next()
 *  4. server/_core/index.ts 有在 setupVite／serveStatic 之前接上 setupGoneRoutes
 *  5. sitemap.xml 產生邏輯不再輸出任何 /blog
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isGonePath, GONE_HTML, setupGoneRoutes } from "./_core/goneRoutes";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("isGonePath：只涵蓋 /blog 與 /blog/* 舊路徑", () => {
  it("命中 /blog 列表頁與所有 /blog/* 文章路徑（含已不存在的舊 slug）", () => {
    expect(isGonePath("/blog")).toBe(true);
    expect(isGonePath("/blog/")).toBe(true);
    expect(isGonePath("/blog/oem-vs-odm")).toBe(true);
    expect(isGonePath("/blog/what-is-moq")).toBe(true);
    expect(isGonePath("/blog/first-time-factory-guide")).toBe(true);
    expect(isGonePath("/blog/test-old-url")).toBe(true);
    expect(isGonePath("/blog/2024/some/deep/legacy/path")).toBe(true);
  });

  it("不誤傷其他路由（前綴相近或完全無關）", () => {
    expect(isGonePath("/")).toBe(false);
    expect(isGonePath("/search")).toBe(false);
    expect(isGonePath("/news")).toBe(false);
    expect(isGonePath("/news/some-slug")).toBe(false);
    expect(isGonePath("/blogging")).toBe(false);
    expect(isGonePath("/blogs")).toBe(false);
    expect(isGonePath("/xblog")).toBe(false);
    expect(isGonePath("/about")).toBe(false);
  });
});

describe("GONE_HTML：410 頁面內容", () => {
  it("帶可被爬蟲辨識的 noindex（不執行 JS 也看得到）", () => {
    expect(GONE_HTML).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("不是 redirect：沒有 meta refresh、沒有 window.location 導頁", () => {
    expect(GONE_HTML).not.toMatch(/http-equiv=["']refresh["']/i);
    expect(GONE_HTML).not.toMatch(/location\.(href|replace|assign)/i);
  });

  it("不把使用者導去 /search 或首頁（連結可以有，但不是自動跳轉）", () => {
    // <a href="/search"> 這種給人點的連結是允許的，這裡只確認沒有自動導頁腳本
    expect(GONE_HTML).not.toMatch(/<script[\s>]/i);
  });
});

describe("setupGoneRoutes middleware", () => {
  function run(method: string, reqPath: string) {
    const handlers: Array<(req: any, res: any, next: any) => void> = [];
    const app = { use: (fn: any) => handlers.push(fn) } as any;
    setupGoneRoutes(app);

    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: undefined as string | undefined,
      _type: undefined as string | undefined,
      status(code: number) { this.statusCode = code; return this; },
      setHeader(k: string, v: string) { this.headers[k] = v; },
      type(t: string) { this._type = t; return this; },
      send(payload: string) { this.body = payload; return this; },
    };
    const next = vi.fn();
    handlers[0]({ method, path: reqPath }, res, next);
    return { res, next };
  }

  it("GET /blog → 410 + X-Robots-Tag noindex + HTML body，不呼叫 next()", () => {
    const { res, next } = run("GET", "/blog");
    expect(res.statusCode).toBe(410);
    expect(res.headers["X-Robots-Tag"]).toMatch(/noindex/);
    expect(res._type).toBe("html");
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(next).not.toHaveBeenCalled();
  });

  it("GET /blog/oem-vs-odm 與任意舊 slug → 410", () => {
    expect(run("GET", "/blog/oem-vs-odm").res.statusCode).toBe(410);
    expect(run("GET", "/blog/test-old-url").res.statusCode).toBe(410);
  });

  it("HEAD /blog → 410（爬蟲用 HEAD 探測也要拿到 410）", () => {
    expect(run("HEAD", "/blog").res.statusCode).toBe(410);
  });

  it("非 GET/HEAD（POST）→ next()，不攔截", () => {
    const { res, next } = run("POST", "/blog");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("非 /blog 路徑 → next()，維持既有 SPA fallback 行為", () => {
    for (const p of ["/", "/search", "/news", "/news/x", "/blogging"]) {
      const { res, next } = run("GET", p);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("server/_core/index.ts：在 SPA fallback 之前接上 setupGoneRoutes", () => {
  const source = readSource("server", "_core", "index.ts");

  it("有 import 並呼叫 setupGoneRoutes", () => {
    expect(source).toMatch(/import \{ setupGoneRoutes \} from "\.\/goneRoutes"/);
    expect(source).toMatch(/setupGoneRoutes\(app\)/);
  });

  it("setupGoneRoutes(app) 出現在 setupVite／serveStatic 之前", () => {
    const goneIdx = source.indexOf("setupGoneRoutes(app)");
    const viteIdx = source.indexOf("await setupVite(app, server)");
    const staticIdx = source.indexOf("serveStatic(app)");
    expect(goneIdx).toBeGreaterThan(-1);
    expect(goneIdx).toBeLessThan(viteIdx);
    expect(goneIdx).toBeLessThan(staticIdx);
  });
});

describe("sitemap.xml 不再包含任何 /blog", () => {
  it("server/_core/index.ts 的 sitemap route 本體沒有 /blog", () => {
    const source = readSource("server", "_core", "index.ts");
    const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
    expect(sitemapMatch).toBeTruthy();
    expect(sitemapMatch![0]).not.toMatch(/\/blog/);
  });
});
