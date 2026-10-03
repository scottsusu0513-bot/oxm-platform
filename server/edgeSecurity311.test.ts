/**
 * Batch 3.11：proxy／client IP 信任邊界、rate limit 身分、安全 headers／CSP、JWT session、
 * 啟動密鑰檢查、OAuth base URL。
 *
 * X-Forwarded-For 的形狀取自正式站實測（temporary diagnostic，只回傳位址類別）：
 *   socket = Render 內部 proxy（私有）、XFF = [client（= CF-Connecting-IP）, Cloudflare edge]；
 *   client 自帶 XFF 時 Cloudflare 原樣保留在前面。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import rateLimit from "express-rate-limit";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIp, isCloudflareIp, normalizeIp, pinCloudflareWorkerForwardedFor, resolveClientIp, trustProxyHop } from "./_core/clientIp";
import { getClientIp, hashIp } from "./_core/requestMeta";
import { weakProductionSecrets } from "./_core/resilience";

const RENDER = "10.204.3.17";
const CF_EDGE = "162.158.88.20";
const CF_EDGE_V6 = "2606:4700:10::ac43:1";
const CLIENT = "203.0.113.50";
const CLIENT_B = "198.51.100.77";
const CLIENT_V6 = "2001:db8:1234:5678::9";

afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("./_core/env"); vi.resetModules(); });

describe("clientIp：逐跳信任（Render 私有位址 → Cloudflare 位址段 → 第一個不可信即 client）", () => {
  it("位址分類與正規化", () => {
    expect(classifyIp(RENDER)).toBe("private");
    expect(classifyIp(CF_EDGE)).toBe("cloudflare");
    expect(classifyIp(CF_EDGE_V6)).toBe("cloudflare");
    expect(classifyIp(CLIENT)).toBe("public");
    expect(classifyIp("not-an-ip")).toBe("invalid");
    expect(normalizeIp("::ffff:10.204.3.17")).toBe(RENDER);
    expect(isCloudflareIp("104.16.0.1")).toBe(true);
    expect(isCloudflareIp("104.15.255.255")).toBe(false);
  });

  it.each([
    ["經 Cloudflare（正式站實測形狀）", RENDER, `${CLIENT}, ${CF_EDGE}`, CLIENT],
    ["client 偽造 XFF（含假的 Cloudflare 位址）", RENDER, `1.2.3.4, 162.158.1.1, ${CLIENT}, ${CF_EDGE}`, CLIENT],
    ["IPv6 client 經 IPv6 Cloudflare edge", RENDER, `${CLIENT_V6}, ${CF_EDGE_V6}`, CLIENT_V6],
    ["IPv4-mapped 的 Render socket", `::ffff:${RENDER}`, `${CLIENT}, ${CF_EDGE}`, CLIENT],
    ["直接連到 Render、沒有 Cloudflare", RENDER, `9.9.9.9, ${CLIENT}`, CLIENT],
    ["沒有任何 proxy（公網 socket）時忽略所有 XFF", CLIENT, `1.2.3.4, ${CF_EDGE}`, CLIENT],
    ["沒有 XFF", RENDER, undefined, RENDER],
  ])("%s", (_l, socket, xff, expected) => {
    expect(resolveClientIp(socket, xff)).toBe(expected);
  });

  it("trustProxyHop：第 0 跳只信任私有位址，之後只信任 Cloudflare", () => {
    expect(trustProxyHop(RENDER, 0)).toBe(true);
    expect(trustProxyHop(CF_EDGE, 0)).toBe(false);
    expect(trustProxyHop(CF_EDGE, 1)).toBe(true);
    expect(trustProxyHop(RENDER, 1)).toBe(false);
    expect(trustProxyHop(CLIENT, 1)).toBe(false);
  });
});

async function withApp(setup: (app: express.Express) => void, run: (base: string) => Promise<void>) {
  const app = express();
  app.set("trust proxy", trustProxyHop);
  setup(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe("Express 整合：req.ip 與 rate limit 身分（socket 為 loopback，等同 Render 內部 proxy）", () => {
  it("req.ip 是真實 client；偽造的 XFF、CF-Connecting-IP 都無法改變它", async () => {
    await withApp(app => {
      app.use(pinCloudflareWorkerForwardedFor);
      app.get("/ip", (req, res) => res.json({ ip: req.ip, meta: getClientIp(req) }));
    }, async base => {
      const get = (headers: Record<string, string>) => fetch(`${base}/ip`, { headers }).then(r => r.json());
      expect(await get({ "x-forwarded-for": `${CLIENT}, ${CF_EDGE}` })).toEqual({ ip: CLIENT, meta: CLIENT });
      expect(await get({ "x-forwarded-for": `6.6.6.6, 162.158.1.1, ${CLIENT}, ${CF_EDGE}`, "cf-connecting-ip": "6.6.6.6" })).toEqual({ ip: CLIENT, meta: CLIENT });
      // Cloudflare Worker 子請求：只信任 Cloudflare 那一跳，Worker 自帶的 XFF 無效
      expect(await get({ "x-forwarded-for": `6.6.6.6, ${CF_EDGE}`, "cf-worker": "evil.example" })).toEqual({ ip: CF_EDGE, meta: CF_EDGE });
    });
  });

  it("rate limit：不同 client 各自計數（原本全部共用 Cloudflare edge 位址）；偽造 XFF 前綴無法換到新的額度", async () => {
    await withApp(app => {
      app.use(rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false }));
      app.get("/x", (_req, res) => res.send("ok"));
    }, async base => {
      const hit = (xff: string) => fetch(`${base}/x`, { headers: { "x-forwarded-for": xff } }).then(r => r.status);
      expect(await hit(`${CLIENT}, ${CF_EDGE}`)).toBe(200);
      expect(await hit(`${CLIENT}, ${CF_EDGE}`)).toBe(429);
      expect(await hit(`7.7.7.7, ${CLIENT}, ${CF_EDGE}`)).toBe(429); // 偽造前綴無效
      expect(await hit(`${CLIENT_B}, ${CF_EDGE}`)).toBe(200); // 另一個使用者不受影響（即使同一個 Cloudflare edge）
      expect(await hit(`${CLIENT_V6}, ${CF_EDGE_V6}`)).toBe(200);
      expect(await hit(`2001:db8:1234:56ff::1, ${CF_EDGE_V6}`)).toBe(429); // 同一個 IPv6 /56 視為同一來源
    });
  });

  it("requestMeta.getClientIp 不再採信 CF-Connecting-IP header", () => {
    const req = { headers: { "cf-connecting-ip": "6.6.6.6" }, ip: CLIENT, socket: {} } as any;
    expect(getClientIp(req)).toBe(CLIENT);
  });

  it("analytics IP 雜湊鹽不直接重用 JWT_SECRET", () => {
    if (process.env.ANALYTICS_IP_SALT) return;
    const raw = createHash("sha256").update(`${process.env.JWT_SECRET ?? ""}:${CLIENT}`).digest("hex");
    expect(hashIp(CLIENT)).not.toBe(raw);
  });
});

async function securityApp(isProduction: boolean, env: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  vi.doMock("./_core/env", () => ({ ENV: { isProduction } }));
  return import("./_core/security");
}

describe("安全 headers 與 CSP", () => {
  it("production：script-src 只有 'self'；connect-src 只有同源＋私有 bucket；frame-ancestors 'none'；X-XSS-Protection 0；Permissions-Policy；API no-store", async () => {
    const sec = await securityApp(true, { AWS_PRIVATE_FILES_BUCKET: "oxm-private-files-prod-2026", AWS_PRIVATE_FILES_REGION: "ap-southeast-2" });
    await withApp(app => {
      sec.setupApiNoStore(app);
      sec.setupSecurityHeaders(app);
      app.get("/", (_req, res) => res.send("<html></html>"));
      app.get("/api/x", (_req, res) => res.json({ ok: true }));
    }, async base => {
      const r = await fetch(`${base}/`);
      const csp = r.headers.get("content-security-policy")!;
      const directive = (name: string) => csp.split(";").find(d => d.trim().startsWith(name + " "))?.trim() ?? "";
      expect(directive("script-src")).toBe("script-src 'self'");
      expect(directive("style-src")).toBe("style-src 'self' 'unsafe-inline' fonts.googleapis.com");
      expect(directive("connect-src")).toBe("connect-src 'self' https://oxm-private-files-prod-2026.s3.ap-southeast-2.amazonaws.com");
      expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(directive("object-src")).toBe("object-src 'none'");
      expect(csp).not.toMatch(/jsdelivr|tailwindcss/);
      expect(r.headers.get("x-xss-protection")).toBe("0");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
      expect(r.headers.get("x-powered-by")).toBeNull();
      expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
      expect(r.headers.get("permissions-policy")).toMatch(/camera=\(\).*geolocation=\(\).*clipboard-write=\(self\).*web-share=\(self\)/);
      expect((await fetch(`${base}/api/x`)).headers.get("cache-control")).toBe("no-store");
    });
  });

  it("非 production：維持 Vite 開發需要的 'unsafe-inline' 與寬鬆 connect-src，不送 HSTS", async () => {
    const sec = await securityApp(false);
    await withApp(app => { sec.setupSecurityHeaders(app); app.get("/", (_req, res) => res.send("x")); }, async base => {
      const r = await fetch(`${base}/`);
      expect(r.headers.get("content-security-policy")).toMatch(/script-src 'self' 'unsafe-inline'/);
      expect(r.headers.get("strict-transport-security")).toBeNull();
    });
  });

  it("私有 bucket 設定格式不符時不加入 connect-src", async () => {
    const sec = await securityApp(true);
    expect(sec.privateBucketConnectSources({ AWS_PRIVATE_FILES_BUCKET: "bad bucket;", AWS_PRIVATE_FILES_REGION: "ap-southeast-2" } as any)).toEqual([]);
    expect(sec.privateBucketConnectSources({} as any)).toEqual([]);
  });

  it("index.html 沒有任何 inline 可執行 script；bootstrap 在同源 /oxm-boot.js", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../client/index.html"), "utf-8");
    const inline = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)).filter(m => !/\bsrc=/.test(m[1]) && !/application\/ld\+json/.test(m[1]));
    expect(inline).toHaveLength(0);
    expect(html).toMatch(/<script src="\/oxm-boot\.js"><\/script>\s*<script type="module" src="\/src\/main\.tsx"><\/script>/);
    const boot = fs.readFileSync(path.resolve(__dirname, "../client/public/oxm-boot.js"), "utf-8");
    expect(boot).toMatch(/window\.__showOxmApp = function/);
    expect(boot).toMatch(/window\.setTimeout\(function \(\) \{\s*window\.__showOxmApp && window\.__showOxmApp\(\);\s*\}, 5000\);/);
  });
});

describe("JWT session 驗證", () => {
  const key = () => new TextEncoder().encode(process.env.JWT_SECRET || "test-secret-for-batch-3-11-0123456789");
  async function sdkWith() {
    vi.stubEnv("JWT_SECRET", process.env.JWT_SECRET || "test-secret-for-batch-3-11-0123456789");
    vi.resetModules();
    return (await import("./_core/sdk")).sdk;
  }
  const sign = (claims: Record<string, unknown>, alg = "HS256", exp = Math.floor(Date.now() / 1000) + 3600) =>
    new SignJWT(claims).setProtectedHeader({ alg, typ: "JWT" }).setExpirationTime(exp).sign(key());

  it("一般 session 通過；其他用途（帶 typ）的 token、非 HS256、alg=none、過期都拒絕", async () => {
    const sdk = await sdkWith();
    expect(await sdk.verifySession(await sign({ openId: "u1", appId: "a", name: "n" }))).toMatchObject({ openId: "u1" });
    expect(await sdk.verifySession(await sign({ openId: "u1", typ: "pending_account_link" }))).toBeNull();
    expect(await sdk.verifySession(await sign({ openId: "u1", typ: "app_account_link" }))).toBeNull();
    expect(await sdk.verifySession(await sign({ openId: "u1" }, "HS512"))).toBeNull();
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ openId: "u1" })).toString("base64url")}.`;
    expect(await sdk.verifySession(none)).toBeNull();
    expect(await sdk.verifySession(await sign({ openId: "u1" }, "HS256", Math.floor(Date.now() / 1000) - 10))).toBeNull();
  });
});

describe("production 啟動密鑰檢查", () => {
  it("缺少 JWT_SECRET → missingRequiredProductionEnv 回報（啟動失敗）", async () => {
    const { missingRequiredProductionEnv } = await import("./_core/resilience");
    expect(missingRequiredProductionEnv({ DATABASE_URL: "mysql://x" } as any)).toEqual(["JWT_SECRET"]);
    expect(missingRequiredProductionEnv({ DATABASE_URL: "mysql://x", JWT_SECRET: "   " } as any)).toEqual(["JWT_SECRET"]);
  });
  it("JWT_SECRET 少於 32 字元視為不安全（啟動失敗）；32 字元以上接受", () => {
    expect(weakProductionSecrets({ JWT_SECRET: "short-secret" } as any)).toEqual(["JWT_SECRET"]);
    expect(weakProductionSecrets({ JWT_SECRET: "x".repeat(32) } as any)).toEqual([]);
    expect(weakProductionSecrets({} as any)).toEqual([]);
    const src = fs.readFileSync(path.resolve(__dirname, "_core/index.ts"), "utf-8");
    expect(src).toMatch(/weakProductionSecrets\(\)/);
    // 缺少與過短都必須讓 production 啟動失敗（process.exit(1)），而且只印名稱
    const boot = src.slice(src.indexOf('if (process.env.NODE_ENV === "production")'), src.indexOf("const app = express()"));
    expect(boot).toMatch(/const missing = missingRequiredProductionEnv\(\);\s*if \(missing\.length > 0\) \{[\s\S]*?process\.exit\(1\);\s*\}/);
    expect(boot).toMatch(/const weak = weakProductionSecrets\(\);\s*if \(weak\.length > 0\) \{[\s\S]*?process\.exit\(1\);\s*\}/);
    expect(boot).not.toMatch(/JWT_SECRET\s*[}\])]|process\.env\.JWT_SECRET/);
    expect(src).toMatch(/app\.set\("trust proxy", trustProxyHop\)/);
    expect(src).not.toMatch(/__ipdiag/);
  });
});

describe("OAuth redirect base", () => {
  const req = (host: string) => ({ protocol: "https", get: (h: string) => (h === "host" ? host : undefined) }) as any;
  it("production 未設定 OAUTH_SERVER_URL 時用正式網域，不受 Host header 影響；有設定時用設定值；本機依 request", async () => {
    vi.stubEnv("OAUTH_SERVER_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    let { oauthBaseUrl } = await import("./_core/oauth");
    expect(oauthBaseUrl(req("evil.example"))).toBe("https://www.oxmmatch.com");
    vi.stubEnv("OAUTH_SERVER_URL", "https://auth.example.test");
    expect(oauthBaseUrl(req("evil.example"))).toBe("https://auth.example.test");
    vi.stubEnv("OAUTH_SERVER_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(oauthBaseUrl(req("localhost:3000"))).toBe("https://localhost:3000");
  });
});
