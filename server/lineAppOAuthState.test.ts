/**
 * iPhone LINE 登入回歸（「使用 LINE 應用程式進行登入」→ Invalid OAuth state）。
 *
 * 實機根因：App 以 SFSafariViewController 開啟 /api/oauth/line?source=app，oauth_state
 * cookie 存在那個瀏覽器環境；選擇用 LINE App 登入後，LINE App 授權完成時在「另一個」
 * 瀏覽器環境（Safari）開啟 callback，cookie 不會跟過去 → Batch 3.7 的 cookie 綁定擋下。
 * 正式站 DB 佐證：兩次 LINE/app state 都沒被消耗、也沒過期（停在 cookie 檢查）。
 *
 * 修正：帶有 App PKCE challenge 的 state 在沒有 cookie 時改以 challenge 綁定——只能以
 * source=app、相同 provider 消耗一次，票券／帳號連結 state 綁定同一個 challenge，只有
 * 持有 verifier 的 App 能兌換。這裡用真的 Express 路由＋本機測試 DB 驗證，callback
 * 一律不帶 cookie（模擬 Safari），LINE API 以 fetch stub 取代。
 */
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const sentOtpEmails: { code: string }[] = [];
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return { ...actual, sendAccountLinkOtpEmail: vi.fn(async (p: { code: string }) => { sentOtpEmails.push(p); }) };
});

import * as db from "./db";
import { registerOAuthRoutes } from "./_core/oauth";
import { appLoginChallengeFromVerifier, resolveOAuthStateBinding } from "./_core/oauthHelpers";
import { verifyAppAccountLinkChallenge, readAppAccountLinkState } from "./_core/accountLink";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import { COOKIE_NAME } from "@shared/const";
import type { Request } from "express";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const alnum = runId.replace(/[^A-Za-z0-9]/g, "");
const createdUserIds: number[] = [];
async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q) as unknown as Promise<[any, unknown]>; }
const mkVerifier = (tag: string) => `${tag}${alnum}`.padEnd(50, "V").slice(0, 50);
const lineSub = (label: string) => `lao-${runId}-${label}`;

let server: import("node:http").Server;
let base = "";
const realFetch = globalThis.fetch;
const call = (path: string, init: RequestInit = {}) => realFetch(`${base}${path}`, { redirect: "manual", ...init });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  await exec(sql`DELETE FROM accountLinkChallenges WHERE providerAccountId LIKE ${`lao-${runId}%`}`);
  await exec(sql`DELETE FROM userAuthAccounts WHERE providerAccountId LIKE ${`lao-${runId}%`}`);
  const [oauthUsers] = await exec(sql`SELECT id FROM users WHERE openId LIKE ${`line_lao-${runId}%`}`);
  for (const u of oauthUsers as { id: number }[]) createdUserIds.push(u.id);
  for (const id of createdUserIds) await deleteTestUser(id);
}, 120000);
beforeEach(() => { sentOtpEmails.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

function stubLine(sub: string, email: string | null = null) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.line.me/oauth2/v2.1/token")) return new Response(JSON.stringify({ access_token: "test-access", id_token: "test-id-token" }));
    if (u.startsWith("https://api.line.me/oauth2/v2.1/verify")) return new Response(JSON.stringify({ sub, email, name: "LINE 測試" }));
    return realFetch(url, init);
  });
}
/** 從 App（SFSafariViewController）發起登入：回傳 state 與它拿到的 cookie（後續 callback 刻意不帶）。 */
async function startAppLogin(provider: "line" | "google", verifier: string) {
  const challenge = appLoginChallengeFromVerifier(verifier);
  const r = await call(`/api/oauth/${provider}?source=app&app_challenge=${challenge}`);
  expect(r.status).toBe(302);
  const state = new URL(r.headers.get("location")!).searchParams.get("state")!;
  expect(state.endsWith(`.${challenge}`)).toBe(true);
  return { state, challenge, cookie: r.headers.get("set-cookie")!.split(";")[0] };
}
async function stateRow(state: string) {
  const [rows] = await exec(sql`SELECT usedAt FROM oauthStates WHERE state = ${state}`);
  return (rows as { usedAt: Date | null }[])[0];
}
async function appComplete(ticket: string, verifier?: string) {
  return call("/api/oauth/app-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, verifier }) });
}
const fakeReq = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

describe("LINE App 登入：LINE App 交接後 callback 在沒有 cookie 的瀏覽器環境", () => {
  it("沒有 cookie 的合法 App callback → 票券回到 App；錯誤／缺少 verifier 換不到 session；正確 verifier 成功一次", async () => {
    const verifier = mkVerifier("ok");
    const { state, challenge } = await startAppLogin("line", verifier);
    stubLine(lineSub("ok"));
    const r = await call(`/api/oauth/line/callback?code=c&state=${state}`); // 不帶 cookie（Safari）
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(`${loc.protocol}//${loc.host}${loc.pathname}`).toBe("oxm://oauth/callback");
    const ticket = loc.searchParams.get("ticket")!;
    expect(ticket.endsWith(`.${challenge}`)).toBe(true);
    expect((await stateRow(state))!.usedAt).not.toBeNull();
    vi.unstubAllGlobals();

    expect((await appComplete(ticket)).status).toBe(400);
    expect((await appComplete(ticket, mkVerifier("attacker"))).status).toBe(400);
    const ok = await appComplete(ticket, verifier);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie") ?? "").toContain(`${COOKIE_NAME}=`);
    // 重複的 App callback（票券已用過）→ 安全失敗，不會發第二個 session
    expect((await appComplete(ticket, verifier)).status).toBe(400);
  });

  it("重放同一個 callback（state 已消耗）→ 400", async () => {
    const verifier = mkVerifier("replay");
    const { state } = await startAppLogin("line", verifier);
    stubLine(lineSub("replay"));
    expect((await call(`/api/oauth/line/callback?code=c&state=${state}`)).status).toBe(302);
    const again = await call(`/api/oauth/line/callback?code=c&state=${state}`);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "Invalid OAuth state" });
  });

  it("偽造的 state（格式正確但伺服器沒發過）→ 400", async () => {
    const forged = `${"a".repeat(64)}.${appLoginChallengeFromVerifier(mkVerifier("forged"))}`;
    const r = await call(`/api/oauth/line/callback?code=c&state=${forged}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Invalid OAuth state" });
  });

  it("缺少 state／code → 400", async () => {
    expect((await call(`/api/oauth/line/callback?code=c`)).status).toBe(400);
    const { state } = await startAppLogin("line", mkVerifier("nocode"));
    expect((await call(`/api/oauth/line/callback?state=${state}`)).status).toBe(400);
    expect((await stateRow(state))!.usedAt).toBeNull();
  });

  it("格式錯誤的 state → 400（不查 DB）", async () => {
    for (const bad of ["abc", `${"a".repeat(64)}.short`, `${"A".repeat(64)}`, `${"a".repeat(64)}.${"x".repeat(43)}.extra`]) {
      const r = await call(`/api/oauth/line/callback?code=c&state=${encodeURIComponent(bad)}`);
      expect(r.status).toBe(400);
    }
    expect(resolveOAuthStateBinding(fakeReq(), "abc")).toEqual({ ok: false, reason: "malformed" });
  });

  it("過期的 App state → 400，且不被消耗", async () => {
    const { state } = await startAppLogin("line", mkVerifier("expired"));
    // 與 drizzle 寫入 timestamp 的方式相同，用 UTC 字串（raw mysql2 的 Date 會依本機時區轉換）
    const past = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
    await exec(sql`UPDATE oauthStates SET expiresAt = ${past} WHERE state = ${state}`);
    const r = await call(`/api/oauth/line/callback?code=c&state=${state}`);
    expect(r.status).toBe(400);
    expect((await stateRow(state))!.usedAt).toBeNull();
    expect(await db.consumeOauthState(state, { provider: "line", source: "app" })).toMatchObject({ valid: false, reason: "expired" });
  });

  it("provider 綁定：Google 發出的 App state 不能用在 LINE callback（有沒有 cookie 都一樣），也不會被消耗", async () => {
    const { state, cookie } = await startAppLogin("google", mkVerifier("wrongprov"));
    expect((await call(`/api/oauth/line/callback?code=c&state=${state}`)).status).toBe(400);
    expect((await call(`/api/oauth/line/callback?code=c&state=${state}`, { headers: { cookie } })).status).toBe(400);
    expect((await stateRow(state))!.usedAt).toBeNull();
    expect(await db.consumeOauthState(state, { provider: "line" })).toMatchObject({ valid: false, reason: "provider_mismatch" });
  });

  it("用途綁定：沒有 cookie 時只接受 source=app 的 state；Web state 一律需要 cookie", async () => {
    // Web 的 LINE state（不帶 challenge）沒有 cookie → cookie_missing
    const web = await call(`/api/oauth/line`);
    const webState = new URL(web.headers.get("location")!).searchParams.get("state")!;
    expect((await call(`/api/oauth/line/callback?code=c&state=${webState}`)).status).toBe(400);
    expect(resolveOAuthStateBinding(fakeReq(), webState)).toEqual({ ok: false, reason: "cookie_missing" });
    expect(resolveOAuthStateBinding(fakeReq("oauth_state=other"), webState)).toEqual({ ok: false, reason: "cookie_mismatch" });
    expect((await stateRow(webState))!.usedAt).toBeNull();

    // DB 中 source=web、但字串帶 challenge 的 state（非 initOAuthState 產生）→ 無 cookie 模式拒絕
    const odd = `${"b".repeat(48)}${alnum}`.slice(0, 64).replace(/[^0-9a-f]/g, "c") + `.${appLoginChallengeFromVerifier(mkVerifier("odd"))}`;
    await db.createOauthState({ state: odd, source: "web", provider: "line" });
    expect((await call(`/api/oauth/line/callback?code=c&state=${odd}`)).status).toBe(400);
    expect((await stateRow(odd))!.usedAt).toBeNull();
    expect(await db.consumeOauthState(odd, { provider: "line", source: "app" })).toMatchObject({ valid: false, reason: "purpose_mismatch" });
  });

  it("LINE Web 登入維持原本行為：cookie 相符 → session cookie＋導回首頁", async () => {
    const web = await call(`/api/oauth/line`);
    const webState = new URL(web.headers.get("location")!).searchParams.get("state")!;
    const cookie = web.headers.get("set-cookie")!.split(";")[0];
    stubLine(lineSub("web"));
    const r = await call(`/api/oauth/line/callback?code=c&state=${webState}`, { headers: { cookie } });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    expect(r.headers.get("set-cookie") ?? "").toContain(`${COOKIE_NAME}=`);
  });

  it("App state 在原本的瀏覽器（有 cookie）也照常成功（Google App 走的路徑）", async () => {
    const verifier = mkVerifier("withcookie");
    const { state, cookie } = await startAppLogin("line", verifier);
    expect(resolveOAuthStateBinding(fakeReq(cookie), state)).toMatchObject({ ok: true, mode: "browser_cookie" });
    stubLine(lineSub("withcookie"));
    const r = await call(`/api/oauth/line/callback?code=c&state=${state}`, { headers: { cookie } });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")!.startsWith("oxm://oauth/callback?ticket=")).toBe(true);
  });
});

describe("帳號連結（App OTP）：無 cookie 模式下仍綁定發起登入的 App", () => {
  it("LINE email 撞到可信帳號 → link state 綁定 challenge；沒有／錯誤 verifier 即使 OTP 正確也無法連結、不扣次數；正確 verifier 才成功", async () => {
    const id = await ensureTestUser(`lao-link-${runId}`, "既有帳號");
    createdUserIds.push(id);
    const email = `lao-link-${runId}@example.test`;
    await db.setPrimaryEmailVerified(id, email);

    const verifier = mkVerifier("link");
    const { state } = await startAppLogin("line", verifier);
    stubLine(lineSub("link"), email);
    const r = await call(`/api/oauth/line/callback?code=c&state=${state}`); // 沒有 cookie
    expect(r.status).toBe(302);
    const linkState = new URL(r.headers.get("location")!).searchParams.get("link")!;
    expect(linkState).toBeTruthy();
    vi.unstubAllGlobals();
    const otp = sentOtpEmails.at(-1)!.code;

    expect(await verifyAppAccountLinkChallenge(linkState, otp)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await verifyAppAccountLinkChallenge(linkState, otp, new Date(), mkVerifier("attacker"))).toMatchObject({ ok: false, reason: "invalid" });
    const cid = await readAppAccountLinkState(linkState);
    expect((await db.getAccountLinkChallenge(cid!))!.failedAttempts).toBe(0);

    const ok = await verifyAppAccountLinkChallenge(linkState, otp, new Date(), verifier);
    expect(ok.ok).toBe(true);
    expect((await db.getUserByAuthAccount("line", lineSub("link")))?.id).toBe(id);
  });
});

describe("client：重複送達的 link callback 不會清掉 verifier", () => {
  it("setAppAccountLinkState(state, undefined) 保留第一次的 verifier；clear 一併清除", async () => {
    const m = await import("../client/src/lib/appAccountLink");
    m.setAppAccountLinkState("s1", "verifier-1");
    m.setAppAccountLinkState("s1", undefined);
    expect(m.getAppAccountLinkVerifier()).toBe("verifier-1");
    m.clearAppAccountLinkState();
    expect(m.getAppAccountLinkVerifier()).toBeUndefined();
    expect(m.getAppAccountLinkState()).toBeNull();
  });
});
