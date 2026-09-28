/**
 * Production serveStatic 的 HTTP 狀態碼迴歸測試（Production Hardening Batch 1）。
 *
 * 正式站 audit 實測：
 *   - GET /assets/does-not-exist-audit.js → 200 text/html（SPA shell），部署後
 *     舊 chunk 動態 import 失敗、整頁變成 ErrorBoundary 錯誤畫面。
 *   - GET /this-page-does-not-exist-audit → 200（soft 404）。
 *
 * 這裡用真正的 serveStatic（指向暫存 build 目錄）起一個 Express server，用
 * 真實 HTTP 請求驗證狀態碼與 Content-Type。只測不查 DB 的分支；工廠／消息等
 * DB-backed 路由在 SPA fallback 之前就已經由各自分支處理（見 vite.ts）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { serveStatic } from "./_core/vite";
import { setupApiNoIndexHeader } from "./_core/robots";

let server: Server;
let baseUrl = "";
let distDir = "";

const INDEX_HTML = `<!doctype html><html><head><title>OXM</title></head><body><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>`;

beforeAll(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), "oxm-spa-fallback-"));
  fs.mkdirSync(path.join(distDir, "assets"));
  fs.writeFileSync(path.join(distDir, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(distDir, "assets", "index-abc123.js"), "console.log('ok');");
  fs.writeFileSync(path.join(distDir, "favicon.png"), "png");

  const app = express();
  setupApiNoIndexHeader(app);
  app.get("/api/trpc/probe", (_req, res) => { res.json({ ok: true }); });
  serveStatic(app, distDir);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(distDir, { recursive: true, force: true });
});

const random = () => Math.random().toString(36).slice(2, 10);

describe("靜態資源找不到 → 真 404，絕不回 SPA shell", () => {
  it.each([
    `/assets/nonexistent-${random()}.js`,
    `/assets/nonexistent-${random()}.css`,
    `/assets/nonexistent-${random()}.js.map`,
    `/assets/nonexistent-${random()}.woff2`,
    `/assets/${random()}`,
    `/images/nonexistent-${random()}.png`,
    `/nonexistent-${random()}.svg`,
  ])("GET %s → 404，Content-Type 不是 text/html", async (url) => {
    const res = await fetch(baseUrl + url);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    expect(await res.text()).not.toContain('<div id="root">');
  });

  it("存在的 asset 仍正常 200", async () => {
    const res = await fetch(`${baseUrl}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/javascript/);
  });

  it("存在的 public 檔案仍正常 200", async () => {
    const res = await fetch(`${baseUrl}/favicon.png`);
    expect(res.status).toBe(200);
  });
});

describe("未知路由 → HTTP 404 + noindex,follow（SPA shell 照常送出，React 渲染 NotFound）", () => {
  it.each(["/this-page-does-not-exist-audit", `/nope/${random()}/deeper`, "/404", "/factoryx/1", "/api/not-a-real-endpoint"])(
    "GET %s → 404 + noindex",
    async (url) => {
      const res = await fetch(baseUrl + url);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain('<meta name="robots" content="noindex,follow"');
      expect(body).toContain('<div id="root">');
    },
  );

  // 只列 SPA fallback 會處理、不查 DB 的合法頁面（工廠／消息／產業／地區等
  // 動態路由在 fallback 之前就由各自分支回應，不經過這段判斷）。
  it.each([
    "/", "/search", "/about", "/faq", "/resources", "/talent", "/brand", "/privacy", "/terms",
    "/register-factory", "/dashboard", "/messages", "/favorites", "/member", "/notifications",
    "/chat/new", "/chat/123", "/orders/45", "/admin", "/admin/conversations/9", "/admin-message/3",
    "/community", "/community/metal/discussions/12", "/upgrade-center/apply", "/consultant-center",
    "/short-video-marketing", "/finance-optimization/apply", "/verify-email", "/manual",
  ])("合法路由 GET %s → 200，沒有 noindex 404 標記", async (url) => {
    const res = await fetch(baseUrl + url);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('data-oxm-not-found="true"');
  });
});

describe("/api 回應帶 X-Robots-Tag: noindex", () => {
  it("tRPC 回應可正常取得（200），但帶 noindex", async () => {
    const res = await fetch(`${baseUrl}/api/trpc/probe`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("一般頁面不帶 API 的 noindex header", async () => {
    const res = await fetch(`${baseUrl}/search`);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });
});
