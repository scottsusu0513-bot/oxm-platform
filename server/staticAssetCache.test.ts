/**
 * 靜態檔快取政策（Production Hardening Batch 3.1）。
 *
 * 正式站 audit：/assets/index-<hash>.js 等 content-hash 檔名的 build 產物回
 * `Cache-Control: public, max-age=0`，每次換頁／回訪都要重新驗證。這裡用真正的
 * serveStatic（指向暫存 build 目錄）起 Express server，以真實 HTTP 驗證：
 *   M. 存在的 hashed asset → 200 + immutable 一年
 *   N. 不存在的 hashed asset → 404（Batch 1 行為不得 regression），不 immutable
 *   O. index.html／SPA document → no-cache，絕不 immutable
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { serveStatic } from "./_core/vite";
import { staticCacheControlFor, IMMUTABLE_ASSET_CACHE_CONTROL, DOCUMENT_CACHE_CONTROL } from "./_core/spaFallback";

let server: Server;
let baseUrl = "";
let distDir = "";

const INDEX_HTML = `<!doctype html><html><head><title>OXM</title></head><body><div id="root"></div><script type="module" src="/assets/index-Ab3dE_9z.js"></script></body></html>`;

beforeAll(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), "oxm-static-cache-"));
  fs.mkdirSync(path.join(distDir, "assets"));
  fs.writeFileSync(path.join(distDir, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(distDir, "assets", "index-Ab3dE_9z.js"), "console.log('ok');");
  fs.writeFileSync(path.join(distDir, "assets", "index-vxhQpOdQ.css"), "body{}");
  fs.writeFileSync(path.join(distDir, "assets", "inter-latin-400-normal-BOOGhInR.woff2"), "font");
  fs.writeFileSync(path.join(distDir, "logo-oxm.png"), "png");

  const app = express();
  serveStatic(app, distDir);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(distDir, { recursive: true, force: true });
});

describe("staticCacheControlFor（純函式）", () => {
  it("只有 assets/ 底下 <name>-<8 碼 hash>.<ext> 才 immutable", () => {
    expect(staticCacheControlFor("assets/index-BG9hmc6E.js")).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(staticCacheControlFor("assets/emacs-lisp-C9XAeP06.js")).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(staticCacheControlFor("assets\\index-vxhQpOdQ.css")).toBe(IMMUTABLE_ASSET_CACHE_CONTROL); // Windows path.relative
    expect(staticCacheControlFor("assets/inter-latin-400-normal-BOOGhInR.woff2")).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(staticCacheControlFor("index.html")).toBe(DOCUMENT_CACHE_CONTROL);
    for (const p of ["logo-oxm.png", "favicon.png", "og-image.png", "robots.txt", "images/hero.png", "__manus__/version.json", "assets/nohash.js", "assets/sub/index-BG9hmc6E.js"]) {
      expect(staticCacheControlFor(p)).toBeUndefined();
    }
  });
});

describe("HTTP：serveStatic 快取標頭", () => {
  it.each(["/assets/index-Ab3dE_9z.js", "/assets/index-vxhQpOdQ.css", "/assets/inter-latin-400-normal-BOOGhInR.woff2"])(
    "M：存在的 hashed asset %s → 200 + public, max-age=31536000, immutable",
    async (url) => {
      const res = await fetch(baseUrl + url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    },
  );

  it("N：不存在的 hashed asset → 404 + no-store，不是 SPA shell、不 immutable", async () => {
    const res = await fetch(`${baseUrl}/assets/index-DOESNOTX.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
  });

  it("O：/ 與 /index.html → no-cache，不 immutable", async () => {
    for (const url of ["/", "/index.html"]) {
      const res = await fetch(baseUrl + url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("cache-control")).not.toMatch(/immutable|max-age=31536000/);
    }
  });

  it("O：未知 client route → 404 + noindex SPA shell，no-cache", async () => {
    const res = await fetch(`${baseUrl}/this-page-does-not-exist-${Date.now()}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("noindex");
  });

  it("固定檔名的 public 檔案不 immutable（維持 express 預設 max-age=0）", async () => {
    const res = await fetch(`${baseUrl}/logo-oxm.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
  });
});
