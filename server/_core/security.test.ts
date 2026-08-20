import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

/**
 * Phase 7.3（見對話中「LAN Development Security」）：驗證
 * setupSecurityHeaders() 依環境正確切換 CSP 的 upgrade-insecure-requests
 * 與 Strict-Transport-Security（HSTS）——只在 ENV.isProduction 為 true 時
 * 維持原本正式站設定，非正式環境明確關閉，讓本機 plain http 開發（含 LAN
 * IP 真機測試）的子資源請求不會被瀏覽器改寫成不存在的 https。
 *
 * 這裡刻意不依賴目前電腦的 LAN IP（見對話中「不要依賴目前電腦 LAN IP」）：
 * 用 Node 內建 http 模組對一個綁在 127.0.0.1、OS 隨機配置埠號的暫時測試
 * server 發真實請求，只驗證回應 header 本身，不牽涉任何實際網路介面。
 *
 * NODE_ENV 是 env.ts 的 ENV.isProduction 在「模組載入當下」算出來的值，
 * 不是每次讀取都重算，所以每個案例都用 vi.resetModules() + 動態 import
 * 讓 env.ts／security.ts 用當時設定的 NODE_ENV 重新求值一次，避免測試互相
 * 汙染或讀到其他測試檔案已經快取好的舊值。
 */

function startTestServer(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind test server"));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on("error", reject);
  });
}

function fetchHeaders(port: number): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.headers));
      })
      .on("error", reject);
  });
}

async function fetchHeadersForEnv(nodeEnv: string): Promise<http.IncomingHttpHeaders> {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  try {
    const { setupSecurityHeaders } = await import("./security");
    const app = express();
    setupSecurityHeaders(app);
    app.get("/", (_req, res) => res.send("ok"));
    const { port, close } = await startTestServer(app);
    try {
      return await fetchHeaders(port);
    } finally {
      await close();
    }
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  }
}

describe("setupSecurityHeaders (Phase 7.3：LAN Development Security)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("development：CSP 不包含 upgrade-insecure-requests", async () => {
    const headers = await fetchHeadersForEnv("development");
    const csp = headers["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("development：不送出 Strict-Transport-Security", async () => {
    const headers = await fetchHeadersForEnv("development");
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("production：CSP 仍包含 upgrade-insecure-requests", async () => {
    const headers = await fetchHeadersForEnv("production");
    const csp = headers["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("production：Strict-Transport-Security 仍存在且設定不變", async () => {
    const headers = await fetchHeadersForEnv("production");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("production／development 的其他 CSP 指令（script-src／connect-src 等）維持一致，不因環境改變", async () => {
    const devCsp = String((await fetchHeadersForEnv("development"))["content-security-policy"]);
    const prodCsp = String((await fetchHeadersForEnv("production"))["content-security-policy"]);
    const stripUpgradeDirective = (csp: string) =>
      csp
        .split(";")
        .map(d => d.trim())
        .filter(d => d && d !== "upgrade-insecure-requests")
        .sort()
        .join(";");
    expect(stripUpgradeDirective(devCsp)).toBe(stripUpgradeDirective(prodCsp));
  });
});
