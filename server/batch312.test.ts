/**
 * Batch 3.12 回歸測試：analytics 隱私、登入寫入放大、評價自評、AI turn 期限、故障通知、
 * SEO 轉址與 sitemap lastmod、App deep link、前端失敗狀態、localStorage 個資、dev 資源。
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { sanitizeAnalyticsFilters, sanitizeAnalyticsQueryString, sanitizeReferrer } from "./analyticsPrivacy";
import { LAST_SIGNED_IN_REFRESH_MS, shouldRefreshLastSignedIn } from "./_core/sdk";
import { AI_TURN_DEADLINE_MS, AiTurnDeadlineExceededError, aiRequestOptions, runWithAiCallContext } from "./ai/aiCallContext";
import { OPS_ALERT_COOLDOWN_MS, OPS_ALERT_THRESHOLDS, createOpsAlertMonitor, parseClientErrorReport, sanitizeAlertDetail, type OpsAlert } from "./_core/opsAlert";
import { industryPageOverflowRedirect, trailingSlashRedirect } from "./_core/seoRedirects";
import { isAppOAuthCallbackUrl } from "../client/src/lib/appDeepLink";
import { shouldReportClientError } from "../client/src/lib/clientErrorReporter";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8");

describe("1. analytics 隱私：querystring／referrer／filters", () => {
  it("只保留白名單參數，丟棄 token、ticket、code、state、link、aih 等憑證", () => {
    expect(sanitizeAnalyticsQueryString("?q=CNC&page=2&utm_source=fb&token=SECRET&ticket=T&code=C&state=S&link=L&aih=9&email=a@b.c"))
      .toBe("?q=CNC&page=2&utm_source=fb");
    expect(sanitizeAnalyticsQueryString("keyword=cnc&token=x")).toBe("keyword=cnc"); // 保留原本有無 "?" 的格式
    expect(sanitizeAnalyticsQueryString("keyword=cnc&token=x")).toBe("keyword=cnc");
    expect(sanitizeAnalyticsQueryString("?token=only")).toBeNull();
    expect(sanitizeAnalyticsQueryString("")).toBeNull();
    expect(sanitizeAnalyticsQueryString(`?q=${"x".repeat(500)}`)!.length).toBeLessThanOrEqual(1 + "q=".length + 200);
  });
  it("referrer 只留 origin＋pathname；非 http(s)、無效網址丟棄；帳密不落地", () => {
    expect(sanitizeReferrer("https://www.google.com/search?q=secret#frag")).toBe("https://www.google.com/search");
    expect(sanitizeReferrer("https://user:pass@evil.example/p?x=1")).toBe("https://evil.example/p");
    expect(sanitizeReferrer("javascript:alert(1)")).toBeNull();
    expect(sanitizeReferrer("not a url")).toBeNull();
  });
  it("filters 只留少量原始型別值", () => {
    const out = sanitizeAnalyticsFilters({ region: ["台北市", "新北市"], page: 2, ai: true, nested: { a: 1 }, "bad key": "x", long: "y".repeat(500) } as any);
    expect(out).toEqual({ region: ["台北市", "新北市"], page: 2, ai: true, long: "y".repeat(200) });
    expect(sanitizeAnalyticsFilters(null)).toBeNull();
  });
  it("寫入點統一套用（recordAnalyticsEvent）", () => {
    const src = read("analyticsDb.ts");
    expect(src).toMatch(/queryString: sanitizeAnalyticsQueryString\(input\.queryString\)/);
    expect(src).toMatch(/const referrer = sanitizeReferrer\(firstEventContext\.referrer\)/);
    expect(src).toMatch(/filtersJson: sanitizeAnalyticsFilters\(input\.filters\)/);
  });
});

describe("8. 登入請求不再每次寫入 users", () => {
  it("lastSignedIn 只在缺值或超過門檻時更新", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(shouldRefreshLastSignedIn(null, now)).toBe(true);
    expect(shouldRefreshLastSignedIn(new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(shouldRefreshLastSignedIn(new Date(now.getTime() - LAST_SIGNED_IN_REFRESH_MS), now)).toBe(true);
    expect(shouldRefreshLastSignedIn("garbage", now)).toBe(true);
  });
  it("authenticateRequest 只在需要時呼叫 upsertUser", () => {
    const src = read("_core/sdk.ts");
    // 只有 lastSignedIn 過期，或 DB role 與白名單不一致（Batch 3.7 語意）時才寫入
    expect(src).toMatch(/if \(shouldRefreshLastSignedIn\(user\.lastSignedIn, signedInAt\) \|\| user\.role !== whitelistRole\) \{\s*await db\.upsertUser\(/);
  });
});

describe("7. 評價：工廠負責人與共同管理者不能評價自己的工廠", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const users: number[] = [];
  const factories: number[] = [];
  const run = async (q: ReturnType<typeof sql>) => ((await (await db.getDb())!.execute(q)) as unknown as [any, unknown])[0];
  afterAll(async () => {
    for (const f of factories) { await run(sql`DELETE FROM reviews WHERE factoryId = ${f}`); await run(sql`DELETE FROM factoryCoManagers WHERE factoryId = ${f}`); await deleteTestFactory(f); }
    for (const u of users) await deleteTestUser(u);
  }, 60000);
  async function caller(userId: number) {
    const u = (await db.getUserById(userId))!;
    return appRouter.createCaller({ user: { ...u, isAdmin: false } as TrpcContext["user"], req: { protocol: "https", headers: {} } as any, res: { clearCookie() {}, cookie() {} } as any });
  }
  it("owner／共管 → FORBIDDEN；一般會員可以評價", async () => {
    const mk = async (label: string) => { const id = await ensureTestUser(`b312-${label}-${runId}`, `B312 ${label}`); await run(sql`UPDATE users SET primaryEmailVerifiedAt = NOW() WHERE id = ${id}`); users.push(id); return id; };
    const owner = await mk("owner"); const coMgr = await mk("comgr"); const buyer = await mk("buyer");
    const factoryId = await createTestFactory(owner, `B312 ${runId}`); factories.push(factoryId);
    await run(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coMgr}, ${owner})`);
    const self = { code: "FORBIDDEN", message: "不能評價自己管理的工廠" };
    await expect((await caller(owner)).review.create({ factoryId, rating: 5 })).rejects.toMatchObject(self);
    await expect((await caller(coMgr)).review.create({ factoryId, rating: 5 })).rejects.toMatchObject(self);
    await expect((await caller(buyer)).review.create({ factoryId, rating: 4, comment: "ok" })).resolves.toEqual({ success: true });
  }, 60000);
});

describe("12. AI 使用者 turn 的整體期限", () => {
  it("沒有期限（背景流程）維持預設；有期限時 timeout 取剩餘時間且不重試；過期直接失敗", async () => {
    expect(aiRequestOptions(60_000, 1)).toEqual({ timeout: 60_000, maxRetries: 1 });
    const now = 1_000_000;
    await runWithAiCallContext({ turnId: 1, factoryId: null, actorUserId: null, deadlineAt: now + 20_000 }, async () => {
      expect(aiRequestOptions(60_000, 1, now)).toEqual({ timeout: 20_000, maxRetries: 0 });
      expect(() => aiRequestOptions(60_000, 1, now + 19_500)).toThrow(AiTurnDeadlineExceededError);
    });
    expect(AI_TURN_DEADLINE_MS).toBeLessThanOrEqual(120_000);
  });
  it("ai.chat 的 turn 帶 deadlineAt；provider 每次呼叫都經過 aiRequestOptions", () => {
    expect(read("routers.ts")).toMatch(/deadlineAt: Date\.now\(\) \+ AI_TURN_DEADLINE_MS/);
    const provider = read("ai/provider.ts");
    expect(provider.match(/aiRequestOptions\(PROVIDER_TIMEOUT_MS, PROVIDER_MAX_RETRIES\)/g)).toHaveLength(2);
    expect(provider).not.toMatch(/\{ timeout: PROVIDER_TIMEOUT_MS, maxRetries: PROVIDER_MAX_RETRIES \}/);
  });
});

describe("2. 故障主動通知", () => {
  function setup() {
    let t = 0;
    const sent: OpsAlert[] = [];
    const logs: string[] = [];
    const m = createOpsAlertMonitor({ send: async a => { sent.push(a); }, now: () => t, log: l => logs.push(l) });
    return { m, sent, logs, advance: (ms: number) => { t += ms; } };
  }
  it("未達門檻不通知；達門檻通知一次；冷卻期間不重複；冷卻後可再通知", () => {
    const s = setup();
    const { count } = OPS_ALERT_THRESHOLDS.server_5xx;
    for (let i = 0; i < count - 1; i++) expect(s.m.record("server_5xx", "factory.search Error")).toBe(false);
    expect(s.m.record("server_5xx", "factory.search Error")).toBe(true);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ kind: "server_5xx", count, latestDetail: "factory.search Error" });
    for (let i = 0; i < count; i++) s.m.record("server_5xx");
    expect(s.sent).toHaveLength(1);
    s.advance(OPS_ALERT_COOLDOWN_MS + 1);
    for (let i = 0; i < count; i++) s.m.record("server_5xx");
    expect(s.sent).toHaveLength(2);
    expect(s.logs.some(l => l.startsWith("[ops-alert] kind=server_5xx"))).toBe(true);
  });
  it("視窗外的舊事件不累計；process 例外立即通知", () => {
    const s = setup();
    const { count, windowMs } = OPS_ALERT_THRESHOLDS.email_failures;
    for (let i = 0; i < count - 1; i++) s.m.record("email_failures");
    s.advance(windowMs + 1);
    expect(s.m.record("email_failures")).toBe(false);
    expect(s.m.record("process_error", "unhandledRejection TypeError")).toBe(true);
  });
  it("通知內容去識別化：email、IP、querystring 不會出現", () => {
    expect(sanitizeAlertDetail("fail for a.b@c.com from 203.0.113.9 at /x?token=abc\nnext")).toBe("fail for [email] from [ip] at /x next");
    expect(sanitizeAlertDetail("y".repeat(300))!.length).toBe(120);
  });
  it("前端錯誤回報只接受固定欄位，path 不含 query", () => {
    expect(parseClientErrorReport({ kind: "error", message: "TypeError: x is undefined (user a@b.co)", path: "/factory/3?token=1" }))
      .toEqual({ kind: "error", path: "/factory/3", message: "TypeError: x is undefined (user [email])" });
    expect(parseClientErrorReport({ kind: "other", message: "m", path: "/" })).toBeNull();
    expect(parseClientErrorReport("junk")).toBeNull();
    expect(shouldReportClientError("TypeError: boom", "https://www.oxmmatch.com/assets/a.js", "https://www.oxmmatch.com")).toBe(true);
    expect(shouldReportClientError("TypeError: boom", "chrome-extension://abc/x.js", "https://www.oxmmatch.com")).toBe(false);
    expect(shouldReportClientError("ResizeObserver loop limit exceeded", undefined, "https://www.oxmmatch.com")).toBe(false);
  });
  it("事件來源都已接上（process、5xx、readiness、email、OAuth、S3、前端）", () => {
    expect(read("_core/resilience.ts")).toMatch(/recordOpsEvent\("process_error"/);
    expect(read("_core/errorSanitize.ts")).toMatch(/recordOpsEvent\("server_5xx"/);
    expect(read("_core/index.ts")).toMatch(/recordOpsEvent\("readiness_failed"/);
    expect(read("_core/index.ts")).toMatch(/app\.post\("\/api\/client-errors", clientErrorLimiter/);
    expect(read("email.ts")).toMatch(/recordOpsEvent\("email_failures"/);
    expect((read("_core/oauth.ts").match(/recordOpsEvent\("oauth_failures"/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(read("storage.ts")).toMatch(/recordOpsEvent\("storage_failures"/);
    // 通知信本身不走 deliverEmail（失敗不能再觸發 email_failures）
    const email = read("email.ts");
    const fn = email.slice(email.indexOf("export async function sendOpsAlertEmail"), email.indexOf("export async function sendOpsAlertEmail") + 1500);
    expect(fn).toMatch(/sendViaResend\(resend,/);
    expect(fn).not.toMatch(/deliverEmail\(/);
  });
  it("broadcast／announcement 寄信 log 不再出現完整 email", () => {
    const src = read("routers.ts");
    expect(src).not.toMatch(/email=\$\{(r|u)\.email\}/);
    expect(src.match(/email=\$\{maskEmail\((r|u)\.email\)\}/g)).toHaveLength(5);
  });
});

describe("11. SEO：結尾斜線、超出範圍頁碼、sitemap lastmod", () => {
  it("結尾斜線 301 到不帶斜線（保留 query）；根目錄、/api、檔案、// 不處理", () => {
    expect(trailingSlashRedirect("GET", "/news/")).toBe("/news");
    expect(trailingSlashRedirect("GET", "/factory/3/?utm_source=x")).toBe("/factory/3?utm_source=x");
    expect(trailingSlashRedirect("HEAD", "/industry/metal-processing//")).toBe("/industry/metal-processing");
    expect(trailingSlashRedirect("GET", "/")).toBeNull();
    expect(trailingSlashRedirect("GET", "/api/health/")).toBeNull();
    expect(trailingSlashRedirect("GET", "//evil.example/")).toBeNull();
    expect(trailingSlashRedirect("GET", "/news")).toBeNull();
    expect(trailingSlashRedirect("POST", "/news/")).toBeNull();
  });
  it("產業頁頁碼超出總頁數 → 最後一頁；範圍內、未知 slug、DB 失敗都不轉址", async () => {
    const count = (n: number) => async () => n;
    expect(await industryPageOverflowRedirect("/industry/metal-processing", "/industry/metal-processing?page=999", count(40))).toBe("/industry/metal-processing?page=3");
    expect(await industryPageOverflowRedirect("/industry/metal-processing", "/industry/metal-processing?page=2", count(5))).toBe("/industry/metal-processing");
    expect(await industryPageOverflowRedirect("/industry/metal-processing", "/industry/metal-processing?page=3", count(40))).toBeNull();
    expect(await industryPageOverflowRedirect("/industry/metal-processing", "/industry/metal-processing", count(0))).toBeNull();
    expect(await industryPageOverflowRedirect("/industry/no-such-industry", "/industry/no-such-industry?page=5", count(0))).toBeNull();
    expect(await industryPageOverflowRedirect("/industry/metal-processing", "/industry/metal-processing?page=5", async () => { throw new Error("db down"); })).toBeNull();
    const sub = vi.fn(async (_i: string, s?: string) => (s ? 16 : 999));
    expect(await industryPageOverflowRedirect("/industry/metal-processing/cnc-machining", "/industry/metal-processing/cnc-machining?page=9", sub)).toBe("/industry/metal-processing/cnc-machining?page=2");
    expect(sub).toHaveBeenCalledWith("金屬加工", "CNC加工 / 精密加工");
  });
  it("sitemap 不再以今天偽造 lastmod；工廠頁用 publicContentUpdatedAt", () => {
    const idx = read("_core/index.ts");
    const sitemap = idx.slice(idx.indexOf('app.get("/sitemap.xml"'), idx.indexOf("res.send(xml)"));
    expect(sitemap).not.toMatch(/const today\b/);
    expect(sitemap).not.toMatch(/,\s*today\)|: today;/);
    expect(read("db.ts")).toMatch(/updatedAt: factories\.publicContentUpdatedAt \}\)/);
  });
});

describe("5. App deep link", () => {
  it("只接受 oxm://oauth/callback", () => {
    expect(isAppOAuthCallbackUrl(new URL("oxm://oauth/callback?ticket=x"))).toBe(true);
    expect(isAppOAuthCallbackUrl(new URL("oxm://oauth/callbackXYZ?ticket=x"))).toBe(false);
    expect(isAppOAuthCallbackUrl(new URL("oxm://evil/callback?ticket=x"))).toBe(false);
    expect(isAppOAuthCallbackUrl(new URL("https://oauth/callback?ticket=x"))).toBe(false);
    expect(read("../client/src/App.tsx")).toMatch(/if \(appLoginCompletionInFlight\) return;/);
  });
});

describe("4／14. 前端失敗狀態、localStorage 個資、dev 資源", () => {
  it("AdminAnalytics 失敗不再永遠顯示載入中；CertificationCenter 失敗不再顯示「找不到」", () => {
    expect(read("../client/src/pages/AdminAnalytics.tsx")).toMatch(/reportQuery\.isError \? \(\s*<QueryErrorState/);
    expect(read("../client/src/pages/CertificationCenter.tsx")).toMatch(/loadFailed \? \(\s*<QueryErrorState/);
  });
  it("useAuth 不再把會員資料寫進 localStorage", () => {
    for (const f of ["../client/src/_core/hooks/useAuth.ts", "../client/src/hooks/useAuth.ts"]) {
      expect(read(f)).not.toMatch(/localStorage\.setItem\(\s*"manus-runtime-user-info"/);
    }
  });
  it("production build 移除 /__manus__ dev 資源", () => {
    const cfg = read("../vite.config.ts");
    expect(cfg).toMatch(/: \[stripManusDevAssets\(\)\]/);
    expect(cfg).toMatch(/fs\.rmSync\(path\.join\(outDir, "__manus__"\)/);
  });
});
