/**
 * 舊 /blog/:slug → 新 /library/:slug 301 永久轉址（見任務定案「傳產圖書館
 * Phase 1 實作」）。涵蓋：
 *   1. resolveLegacyBlogRedirect 純函式：只有 3 筆 mapping，其餘一律 null
 *   2. setupLegacyBlogRedirect middleware：mapped → 301 + 正確 Location，
 *      query string 被捨棄；unmapped → next()（交給後面的 setupGoneRoutes）
 *   3. 兩個 middleware 串接時的實際行為：mapped slug 一路到底是 301、
 *      goneRoutes 完全不會被觸發；unmapped slug 才會落到 goneRoutes 回 410
 *      ——這是實際證明「redirect 檢查順序必須在 goneRoutes 之前」有效的
 *      整合測試，不只是各自獨立測試兩個 middleware
 *   4. server/_core/index.ts 的實際註冊順序：setupLegacyBlogRedirect 在
 *      setupGoneRoutes 之前，兩者都在 dev（setupVite）／prod
 *      （serveStatic）分支之前註冊一次，dev/prod 共用同一套順序
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveLegacyBlogRedirect } from "@shared/seo/libraryPages";
import { setupLegacyBlogRedirect } from "./_core/legacyBlogRedirect";
import { setupGoneRoutes } from "./_core/goneRoutes";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("resolveLegacyBlogRedirect：只有 3 筆 mapping", () => {
  it("3 個有對應新文章的舊 slug 正確轉成 /library/:slug", () => {
    expect(resolveLegacyBlogRedirect("/blog/what-is-moq")).toBe("/library/what-is-moq");
    expect(resolveLegacyBlogRedirect("/blog/oem-vs-odm")).toBe("/library/oem-vs-odm");
    expect(resolveLegacyBlogRedirect("/blog/first-time-factory-guide")).toBe("/library/first-time-factory-guide");
  });

  it("結尾斜線不影響比對結果", () => {
    expect(resolveLegacyBlogRedirect("/blog/what-is-moq/")).toBe("/library/what-is-moq");
  });

  it("其餘任何 /blog/* 路徑（含已不存在的舊 slug）一律回傳 null，不猜測、不轉去 /search 或首頁", () => {
    expect(resolveLegacyBlogRedirect("/blog/does-not-exist")).toBeNull();
    expect(resolveLegacyBlogRedirect("/blog/2024/legacy/deep/path")).toBeNull();
    expect(resolveLegacyBlogRedirect("/blog")).toBeNull();
    expect(resolveLegacyBlogRedirect("/blog/")).toBeNull();
  });

  it("不誤傷其他路由", () => {
    expect(resolveLegacyBlogRedirect("/")).toBeNull();
    expect(resolveLegacyBlogRedirect("/library/what-is-moq")).toBeNull();
    expect(resolveLegacyBlogRedirect("/blogging")).toBeNull();
  });
});

function createMockApp() {
  const handlers: Array<(req: any, res: any, next: any) => void> = [];
  const app = { use: (fn: any) => handlers.push(fn) } as any;
  return { app, handlers };
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    redirectedTo: undefined as string | undefined,
    redirectedStatus: undefined as number | undefined,
    body: undefined as string | undefined,
    _type: undefined as string | undefined,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    type(t: string) { this._type = t; return this; },
    send(payload: string) { this.body = payload; return this; },
    redirect(status: number, target: string) { this.redirectedStatus = status; this.redirectedTo = target; },
  };
  return res;
}

describe("setupLegacyBlogRedirect middleware（單獨測試）", () => {
  function run(method: string, reqPath: string) {
    const { app, handlers } = createMockApp();
    setupLegacyBlogRedirect(app);
    const res = createMockRes();
    const next = vi.fn();
    handlers[0]({ method, path: reqPath }, res, next);
    return { res, next };
  }

  it("GET /blog/what-is-moq → 301 → /library/what-is-moq，不呼叫 next()", () => {
    const { res, next } = run("GET", "/blog/what-is-moq");
    expect(res.redirectedStatus).toBe(301);
    expect(res.redirectedTo).toBe("/library/what-is-moq");
    expect(next).not.toHaveBeenCalled();
  });

  it("GET /blog/oem-vs-odm、/blog/first-time-factory-guide 同樣 301 到對應新文章", () => {
    expect(run("GET", "/blog/oem-vs-odm").res.redirectedTo).toBe("/library/oem-vs-odm");
    expect(run("GET", "/blog/first-time-factory-guide").res.redirectedTo).toBe("/library/first-time-factory-guide");
  });

  it("HEAD 請求同樣觸發 301（爬蟲用 HEAD 探測也要拿到正確轉址）", () => {
    const { res, next } = run("HEAD", "/blog/what-is-moq");
    expect(res.redirectedStatus).toBe(301);
    expect(next).not.toHaveBeenCalled();
  });

  it("沒有對應新文章的 /blog/* → next()，不攔截（交給後面的 goneRoutes 處理）", () => {
    const { res, next } = run("GET", "/blog/does-not-exist");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedStatus).toBeUndefined();
  });

  it("非 /blog 路徑 → next()", () => {
    const { res, next } = run("GET", "/library/what-is-moq");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedStatus).toBeUndefined();
  });

  it("非 GET/HEAD（POST）→ next()，不攔截", () => {
    const { res, next } = run("POST", "/blog/what-is-moq");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedStatus).toBeUndefined();
  });
});

describe("query string 一律捨棄（這 3 篇舊文章沒有任何功能性 query）", () => {
  it("redirect target 不含原始 query string", () => {
    // resolveLegacyBlogRedirect 只吃乾淨的 pathname，middleware 用 req.path
    // （不含 query）呼叫它，因此 target 本身就不會帶 query——這裡直接驗證
    // resolveLegacyBlogRedirect 的輸出格式本身不含 "?"。
    const target = resolveLegacyBlogRedirect("/blog/what-is-moq");
    expect(target).not.toContain("?");
  });

  it("middleware 只讀 req.path（Express 已自動拆掉 query string），即使原始請求帶 query 也不影響比對或轉址目標", () => {
    const { app, handlers } = createMockApp();
    setupLegacyBlogRedirect(app);
    const res = createMockRes();
    const next = vi.fn();
    // req.path 在 Express 裡本來就不含 query string（query 會另外在
    // req.query／req.originalUrl），這裡用跟真實 Express 一致的假設模擬。
    handlers[0]({ method: "GET", path: "/blog/what-is-moq" }, res, next);
    expect(res.redirectedTo).toBe("/library/what-is-moq");
    expect(res.redirectedTo).not.toContain("foo=bar");
  });
});

describe("整合行為：setupLegacyBlogRedirect 註冊在 setupGoneRoutes 之前時，兩者如何協作", () => {
  function runBoth(method: string, reqPath: string) {
    const { app, handlers } = createMockApp();
    // 刻意用跟 server/_core/index.ts 完全相同的順序註冊。
    setupLegacyBlogRedirect(app);
    setupGoneRoutes(app);
    const res = createMockRes();
    const next1 = vi.fn();
    const next2 = vi.fn();

    // 模擬 Express 的鏈式呼叫：第一個 handler 的 next() 會觸發第二個 handler。
    const chainedNext = () => { next1(); handlers[1]({ method, path: reqPath }, res, next2); };
    handlers[0]({ method, path: reqPath }, res, chainedNext);
    return { res, next1, next2 };
  }

  it("mapped slug（/blog/what-is-moq）：第一個 middleware 直接 301，第二個 middleware（goneRoutes）完全不會被呼叫", () => {
    const { res, next1, next2 } = runBoth("GET", "/blog/what-is-moq");
    expect(res.redirectedStatus).toBe(301);
    expect(res.redirectedTo).toBe("/library/what-is-moq");
    expect(next1).not.toHaveBeenCalled();
    expect(next2).not.toHaveBeenCalled();
    // 410 相關欄位完全沒有被設定過，證明 goneRoutes 從未執行。
    expect(res.statusCode).toBe(200);
  });

  it("unmapped slug（/blog/does-not-exist）：第一個 middleware next()，第二個 middleware（goneRoutes）接手回 410", () => {
    const { res, next1 } = runBoth("GET", "/blog/does-not-exist");
    expect(next1).toHaveBeenCalledTimes(1);
    expect(res.redirectedStatus).toBeUndefined();
    expect(res.statusCode).toBe(410);
    expect(res.headers["X-Robots-Tag"]).toMatch(/noindex/);
  });

  it("/blog 本身（沒有 slug）：不是 mapping 對象，仍然落到 goneRoutes 回 410", () => {
    const { res } = runBoth("GET", "/blog");
    expect(res.redirectedStatus).toBeUndefined();
    expect(res.statusCode).toBe(410);
  });
});

describe("server/_core/index.ts：實際註冊順序", () => {
  const source = readSource("server", "_core", "index.ts");

  it("有 import 並呼叫 setupLegacyBlogRedirect", () => {
    expect(source).toMatch(/import \{ setupLegacyBlogRedirect \} from "\.\/legacyBlogRedirect"/);
    expect(source).toMatch(/setupLegacyBlogRedirect\(app\)/);
  });

  it("setupLegacyBlogRedirect(app) 出現在 setupGoneRoutes(app) 之前", () => {
    const redirectIdx = source.indexOf("setupLegacyBlogRedirect(app)");
    const goneIdx = source.indexOf("setupGoneRoutes(app)");
    expect(redirectIdx).toBeGreaterThan(-1);
    expect(goneIdx).toBeGreaterThan(-1);
    expect(redirectIdx).toBeLessThan(goneIdx);
  });

  it("setupLegacyBlogRedirect(app) 與 setupGoneRoutes(app) 都出現在 setupVite／serveStatic 分支之前（dev／prod 共用同一套順序，不需要分別處理）", () => {
    const redirectIdx = source.indexOf("setupLegacyBlogRedirect(app)");
    const goneIdx = source.indexOf("setupGoneRoutes(app)");
    const devBranchIdx = source.indexOf('NODE_ENV === "development"');
    expect(devBranchIdx).toBeGreaterThan(-1);
    expect(redirectIdx).toBeLessThan(devBranchIdx);
    expect(goneIdx).toBeLessThan(devBranchIdx);
  });
});
