/**
 * Production Hardening Batch 3.7：Authentication／Authorization 回歸測試。真的走
 * 本機測試資料庫、Express 路由與 tRPC router；外部 OAuth provider 以 fetch
 * stub 取代，不打任何外部服務。
 *
 *   1. OAuth state 綁定瀏覽器（login CSRF）＋ state 原子消耗
 *   2. App 登入票券：只存雜湊、PKCE 式 verifier 綁定、原子消耗、不可重放
 *   3. 管理員身分以白名單為唯一依據（舊 DB role='admin' 不再有效，並會降級）
 *   4. 全部 procedure：未登入 → UNAUTHORIZED；一般使用者 → admin procedure FORBIDDEN；
 *      公開 procedure 清單固定（新增公開 API 必須明確更新這份清單）
 *   5. 商品圖片只能是該工廠上傳的平台物件
 *   6. 社群：管理員隱藏的留言不外洩；需求單審核資訊只給發包者／管理員；未上架
 *      需求的投標數不外洩
 */
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@shared/const", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/const")>();
  return { ...actual, COMMUNITY_FEATURE_STATUS: "live" };
});

import * as db from "./db";
import { appRouter } from "./routers";
import { createContext, type TrpcContext } from "./_core/context";
import { registerOAuthRoutes } from "./_core/oauth";
import { sdk } from "./_core/sdk";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import { COOKIE_NAME } from "@shared/const";
import { appLoginChallengeFromVerifier } from "./_core/oauthHelpers";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const createdUserIds: number[] = [];
const createdFactoryIds: number[] = [];
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q) as unknown as Promise<[any, unknown]>; }
async function mkUser(label: string) { const id = await ensureTestUser(`as37-${label}-${runId}`, `AS37 ${label}`); createdUserIds.push(id); return (await db.getUserById(id))!; }
const anonCtx = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} }, res: { clearCookie() {}, cookie() {} } } as unknown as TrpcContext);
async function userCtx(userId: number, admin = false): Promise<TrpcContext> {
  const u = (await db.getUserById(userId))!;
  return { user: { ...u, role: admin ? "admin" : "user", isAdmin: admin }, req: { protocol: "https", headers: {} }, res: { clearCookie() {}, cookie() {} } } as unknown as TrpcContext;
}
async function mkFactory(ownerId: number, label: string) {
  const [r] = await exec(sql`INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, address, status, operationStatus, certified, subIndustry, businessType)
    VALUES (${ownerId}, ${`AS37 ${label} ${runId}`}, '["金屬加工"]', '["OEM"]', '台北市', '描述', '<1000萬', '地址', 'approved', 'normal', FALSE, '[]', 'factory')`);
  createdFactoryIds.push(r.insertId);
  return r.insertId as number;
}

afterAll(async () => {
  for (const f of createdFactoryIds) {
    await exec(sql`DELETE FROM products WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
  await exec(sql`DELETE FROM communityComments WHERE content LIKE ${`%as37-${runId}%`}`);
  await exec(sql`DELETE FROM communityPosts WHERE title LIKE ${`%as37-${runId}%`}`);
  await exec(sql`DELETE FROM communityBids WHERE title LIKE ${`%as37-${runId}%`}`);
  await exec(sql`DELETE FROM userAuthAccounts WHERE providerAccountId LIKE ${`as37-${runId}%`}`);
  const [oauthUsers] = await exec(sql`SELECT id FROM users WHERE openId LIKE ${`google_as37-${runId}%`}`);
  for (const u of oauthUsers as { id: number }[]) createdUserIds.push(u.id);
  for (const id of createdUserIds) await deleteTestUser(id);
}, 120000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── 1／2. OAuth 路由 ────────────────────────────────────────────────────
describe("OAuth：state 綁定瀏覽器、App 票券 PKCE 綁定", () => {
  let server: import("node:http").Server;
  let base = "";
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app);
    server = app.listen(0);
    await new Promise(r => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  const call = (path: string, init: RequestInit = {}) => realFetch(`${base}${path}`, { redirect: "manual", ...init });
  async function startLogin(query = ""): Promise<{ state: string; cookie: string }> {
    const r = await call(`/api/oauth/google${query}`);
    expect(r.status).toBe(302);
    const state = new URL(r.headers.get("location")!).searchParams.get("state")!;
    const setCookie = r.headers.get("set-cookie")!;
    const cookie = setCookie.split(";")[0];
    expect(cookie).toBe(`oauth_state=${state}`);
    return { state, cookie };
  }
  async function stateRow(state: string) {
    const [rows] = await exec(sql`SELECT usedAt FROM oauthStates WHERE state = ${state}`);
    return (rows as { usedAt: Date | null }[])[0];
  }
  function stubGoogle(accountId: string) {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "test-access" }));
      if (String(url).startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ id: accountId, email: `${accountId}@example.test`, verified_email: true, name: "AS37 OAuth" }));
      }
      return realFetch(url, init);
    });
  }

  it("callback 沒有（或不同的）oauth_state cookie → 400，而且不消耗 DB 的 state（login CSRF 防護）", async () => {
    const { state } = await startLogin();
    for (const cookie of [undefined, "oauth_state=deadbeef", `oauth_state=${state}x`]) {
      const r = await call(`/api/oauth/callback?code=c&state=${state}`, { headers: cookie ? { cookie } : {} });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "Invalid OAuth state" });
    }
    expect((await stateRow(state))!.usedAt).toBeNull();
  });

  it("cookie 相符 → 通過 state 驗證（進到 token 交換）；同一個 state 不能再用第二次", async () => {
    const { state, cookie } = await startLogin();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({})));
    const r = await call(`/api/oauth/callback?code=c&state=${state}`, { headers: { cookie } });
    expect(await r.json()).toEqual({ error: "Failed to get access token" });
    expect((await stateRow(state))!.usedAt).not.toBeNull();
    const again = await call(`/api/oauth/callback?code=c&state=${state}`, { headers: { cookie } });
    expect(await again.json()).toEqual({ error: "Invalid OAuth state" });
  });

  it("consumeOauthState 是原子的：同一個 state 併發兩次，只有一次有效", async () => {
    const state = `as37state${runId}`.replace(/[^a-z0-9]/gi, "").padEnd(64, "0").slice(0, 64);
    await db.createOauthState({ state, source: "web", provider: "google" });
    const results = await Promise.all([db.consumeOauthState(state), db.consumeOauthState(state), db.consumeOauthState(state)]);
    expect(results.filter(r => r.valid)).toHaveLength(1);
  });

  it("App：challenge 放進 state；票券帶 challenge、DB 只存雜湊；沒有／錯誤的 verifier 不能換 session，也不消耗票券；正確 verifier 成功一次，不可重放", async () => {
    const verifier = "v".repeat(20) + runId.replace(/[^A-Za-z0-9]/g, "").padEnd(30, "Q");
    const challenge = appLoginChallengeFromVerifier(verifier);
    const { state, cookie } = await startLogin(`?source=app&app_challenge=${challenge}`);
    expect(state).toMatch(new RegExp(`^[0-9a-f]{64}\\.${challenge}$`));

    stubGoogle(`as37-${runId}-app`);
    const cb = await call(`/api/oauth/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie } });
    expect(cb.status).toBe(302);
    const location = cb.headers.get("location")!;
    expect(location.startsWith("oxm://oauth/callback?ticket=")).toBe(true);
    const ticket = decodeURIComponent(location.split("ticket=")[1]);
    expect(ticket).toMatch(new RegExp(`^[0-9a-f]{64}\\.${challenge}$`));

    const [plain] = await exec(sql`SELECT COUNT(*) n FROM appLoginTickets WHERE ticket = ${ticket}`);
    const [hashed] = await exec(sql`SELECT COUNT(*) n, MAX(usedAt IS NULL) unused FROM appLoginTickets WHERE ticket = ${sha256Hex(ticket)}`);
    expect(Number((plain as any)[0].n)).toBe(0);
    expect(Number((hashed as any)[0].n)).toBe(1);

    vi.unstubAllGlobals();
    const complete = (body: unknown) => call("/api/oauth/app-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await complete({ ticket })).status).toBe(400);                                   // 攔截者只有票券
    expect((await complete({ ticket, verifier: "w".repeat(50) })).status).toBe(400);        // 錯誤 verifier
    const tamperedChallenge = `${ticket.split(".")[0]}.${appLoginChallengeFromVerifier("x".repeat(50))}`;
    expect((await complete({ ticket: tamperedChallenge, verifier: "x".repeat(50) })).status).toBe(400); // 換掉 challenge
    const [still] = await exec(sql`SELECT usedAt FROM appLoginTickets WHERE ticket = ${sha256Hex(ticket)}`);
    expect((still as any)[0].usedAt).toBeNull();

    const ok = await complete({ ticket, verifier });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
    expect((await complete({ ticket, verifier })).status).toBe(400);                        // 不可重放
  });

  it("不合法的 app_challenge 被忽略（state 為一般 64 hex）；web 登入的 state 不含 challenge", async () => {
    expect((await startLogin("?source=app&app_challenge=short")).state).toMatch(/^[0-9a-f]{64}$/);
    expect((await startLogin(`?app_challenge=${appLoginChallengeFromVerifier("y".repeat(50))}`)).state).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consumeAppLoginTicket 是原子的：同一張票券併發三次只成功一次", async () => {
    const user = await mkUser("ticket-race");
    const ticketHash = sha256Hex(`race-${runId}`);
    await db.createAppLoginTicket({ ticketHash, userId: user.id });
    const results = await Promise.all([db.consumeAppLoginTicket(ticketHash), db.consumeAppLoginTicket(ticketHash), db.consumeAppLoginTicket(ticketHash)]);
    expect(results.filter(r => r.valid)).toEqual([{ valid: true, userId: user.id }]);
  });
});

// ── 3. 管理員身分 ───────────────────────────────────────────────────────
describe("管理員身分以白名單為唯一依據", () => {
  async function ctxFromSession(openId: string) {
    const token = await sdk.createSessionToken(openId, { name: "x", expiresInMs: 60_000 });
    return createContext({ req: { headers: { cookie: `${COOKIE_NAME}=${token}` } }, res: {} } as any);
  }

  it("DB role='admin' 但不在白名單 → ctx.user.role='user'、isAdmin=false，role 判斷的 admin 功能被拒；DB 也降回 user", async () => {
    const stale = await mkUser("stale-admin");
    await exec(sql`UPDATE users SET role = 'admin' WHERE id = ${stale.id}`);
    const ctx = await ctxFromSession(stale.openId);
    expect(ctx.user).toMatchObject({ id: stale.id, role: "user", isAdmin: false });
    const factoryOwner = await mkUser("evidence-owner");
    const factoryId = await mkFactory(factoryOwner.id, "evidence");
    await expect(appRouter.createCaller(ctx).factory.getCertificationEvidenceViewUrls({ factoryId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.getUserById(stale.id))!.role).toBe("user");
  });

  it("在白名單內（openId）→ role='admin'、isAdmin=true", async () => {
    const admin = await mkUser("wl-admin");
    vi.stubEnv("ADMIN_WHITELIST_OPEN_IDS", JSON.stringify([admin.openId]));
    const ctx = await ctxFromSession(admin.openId);
    expect(ctx.user).toMatchObject({ role: "admin", isAdmin: true });
    expect((await db.getUserById(admin.id))!.role).toBe("admin");
  });
});

// ── 4. 全部 procedure 的身分檢查 ─────────────────────────────────────────
const EXPECTED_PUBLIC_PROCEDURES = [
  "accountLink.appCancel", "accountLink.appPending", "accountLink.appResend", "accountLink.appVerify",
  "accountLink.cancel", "accountLink.pending", "accountLink.resend", "accountLink.verify",
  "ad.getActive", "ai.chat", "ai.entitlementStatus", "ai.releaseMode", "ai.status",
  "analytics.record", "analyticsV2.trackEvent", "announcement.list",
  "auth.logout", "auth.me", "auth.verifyEmail",
  "category.getByFactory", "certificationCenter.listCategories", "certificationCenter.listServices",
  "community.getPost", "community.getSpaces", "community.listPosts", "community.reactionSummary",
  "factory.getById", "factory.getPhotos", "factory.getSimilar", "factory.search",
  "loginPopup.toShow",
  "news.getBoardSubscriptionState", "news.getBySlug", "news.getNewCategorySummary", "news.list",
  "product.getByFactory", "product.getById", "review.getByFactory",
  "system.health", "upgradeCenter.publicStats", "upgradePrograms.listPublic",
];
function classify() {
  const procs = (appRouter as any)._def.procedures as Record<string, { _def: { middlewares: unknown[] } }>;
  const out = { public: [] as string[], user: [] as string[], admin: [] as string[] };
  for (const [path, p] of Object.entries(procs)) {
    const src = p._def.middlewares.map(String).join("\n");
    if (src.includes("isAdminUser")) out.admin.push(path);
    else if (src.includes("UNAUTHED_ERR_MSG")) out.user.push(path);
    else out.public.push(path);
  }
  return out;
}
function callPath(ctx: TrpcContext, path: string) {
  let target: any = appRouter.createCaller(ctx);
  for (const part of path.split(".")) target = target[part];
  return (target as (input: unknown) => Promise<unknown>)({});
}

describe("全部 procedure 的身分邊界", () => {
  const groups = classify();

  it("公開 procedure 清單固定（新增公開 API 必須明確檢視並更新這份清單）", () => {
    expect([...groups.public].sort()).toEqual([...EXPECTED_PUBLIC_PROCEDURES].sort());
    expect(groups.user.length + groups.admin.length).toBeGreaterThan(300);
  });

  it("未登入：所有需要登入的 procedure 回 UNAUTHORIZED、所有 admin procedure 回 UNAUTHORIZED／FORBIDDEN（在任何輸入驗證或商業邏輯之前）", async () => {
    for (const path of groups.user) {
      await expect(callPath(anonCtx(), path), path).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    for (const path of groups.admin) {
      const err = await callPath(anonCtx(), path).then(() => null, e => e);
      expect(["UNAUTHORIZED", "FORBIDDEN"], path).toContain(err?.code);
    }
  }, 60000);

  it("一般登入使用者：所有 admin procedure 都回 FORBIDDEN", async () => {
    const normal = await mkUser("normal");
    const ctx = await userCtx(normal.id);
    for (const path of groups.admin) {
      await expect(callPath(ctx, path), path).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  }, 60000);
});

// ── 5. 商品圖片 ─────────────────────────────────────────────────────────
describe("商品圖片只能是該工廠上傳的平台物件", () => {
  it("外部網址、data: URL、其他工廠的圖片 → FORBIDDEN；自己工廠的上傳 → OK（create 與 update）", async () => {
    vi.stubEnv("AWS_S3_BUCKET", "oxm-test-bucket");
    vi.stubEnv("AWS_REGION", "ap-southeast-2");
    delete process.env.AWS_S3_PUBLIC_BASE_URL;
    const owner = await mkUser("prod-owner");
    const factoryId = await mkFactory(owner.id, "prod");
    const other = await mkUser("prod-other");
    const otherFactoryId = await mkFactory(other.id, "prod-other");
    const base = "https://oxm-test-bucket.s3.ap-southeast-2.amazonaws.com";
    const caller = appRouter.createCaller(await userCtx(owner.id));
    const bad = [
      "https://tracker.example/pixel.gif",
      "data:image/png;base64,iVBORw0KGgo=",
      "javascript:alert(1)",
      `${base}/product-images/${otherFactoryId}/abc.jpg`,
      `${base}/product-images/${factoryId}/../${otherFactoryId}/abc.jpg`,
      `${base}/factory-avatars/${factoryId}/abc.jpg`,
    ];
    for (const url of bad) {
      await expect(caller.product.create({ factoryId, name: "p", images: [url] }), url).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const own = `${base}/product-images/${factoryId}/AbCdEfGhIjKlMnOpQrStU.jpg`;
    const { id } = await caller.product.create({ factoryId, name: "p", images: [own] });
    await expect(caller.product.update({ id, factoryId, images: [bad[0]] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.product.update({ id, factoryId, images: [own] })).resolves.toEqual({ success: true });
    await expect(caller.product.update({ id, factoryId, name: "renamed" })).resolves.toEqual({ success: true });
  });
});

// ── 6. 社群 ─────────────────────────────────────────────────────────────
describe("社群：隱藏留言與需求單審核資訊（模擬社群正式上線狀態）", () => {
  it("一般讀者看不到管理員隱藏的留言內容與作者；管理員仍看得到", async () => {
    const author = await mkUser("post-author");
    const commenter = await mkUser("commenter");
    const [p] = await exec(sql`INSERT INTO communityPosts (spaceCode, authorUserId, authorNameSnapshot, title, content)
      VALUES ('cross-industry', ${author.id}, 'a', ${`標題 as37-${runId}`}, ${`內文 as37-${runId}`})`);
    const postId = p.insertId;
    await exec(sql`INSERT INTO communityComments (postId, authorUserId, authorNameSnapshot, content, isHidden)
      VALUES (${postId}, ${commenter.id}, '留言者', ${`被隱藏的違規內容 as37-${runId}`}, TRUE),
             (${postId}, ${commenter.id}, '留言者', ${`正常留言 as37-${runId}`}, FALSE)`);
    const viewer = await mkUser("viewer");
    for (const ctx of [anonCtx(), await userCtx(viewer.id)]) {
      const r = await appRouter.createCaller(ctx).community.getPost({ postId });
      const text = JSON.stringify(r.comments);
      expect(text).not.toContain("被隱藏的違規內容");
      expect(text).toContain("正常留言");
      const hidden = (r.comments as any[]).find(c => c.isHidden);
      expect(hidden).toMatchObject({ content: "", authorName: null, authorUserId: null });
    }
    const adminView = await appRouter.createCaller(await userCtx(viewer.id, true)).community.getPost({ postId });
    expect(JSON.stringify(adminView.comments)).toContain("被隱藏的違規內容");
  });

  it("需求單：退回原因／審核者 id／審核時間只給發包者與管理員；未上架需求的投標數只給發包者與管理員", async () => {
    const author = await mkUser("bid-author");
    const reviewer = await mkUser("bid-reviewer");
    const stranger = await mkUser("bid-stranger");
    const [a] = await exec(sql`INSERT INTO communityBids (spaceCode, authorUserId, authorNameSnapshot, title, description, durationHours, status, rejectionReason, reviewedByUserId, reviewedAt)
      VALUES ('cross-industry', ${author.id}, 'a', ${`上架 as37-${runId}`}, 'd', 72, 'active', '先前退回：內部備註', ${reviewer.id}, NOW())`);
    const [pending] = await exec(sql`INSERT INTO communityBids (spaceCode, authorUserId, authorNameSnapshot, title, description, durationHours, status)
      VALUES ('cross-industry', ${author.id}, 'a', ${`審核中 as37-${runId}`}, 'd', 72, 'pending_review')`);
    const strangerCaller = appRouter.createCaller(await userCtx(stranger.id));
    const seen = await strangerCaller.community.getBid({ bidId: a.insertId });
    expect(seen.bid).toMatchObject({ rejectionReason: null, reviewedByUserId: null, reviewedAt: null });
    const own = await appRouter.createCaller(await userCtx(author.id)).community.getBid({ bidId: a.insertId });
    expect(own.bid).toMatchObject({ rejectionReason: "先前退回：內部備註", reviewedByUserId: reviewer.id });

    await expect(strangerCaller.community.getBidOfferCount({ bidId: pending.insertId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appRouter.createCaller(await userCtx(author.id)).community.getBidOfferCount({ bidId: pending.insertId })).resolves.toEqual({ count: 0 });
    await expect(strangerCaller.community.getBidOfferCount({ bidId: a.insertId })).resolves.toEqual({ count: 0 });
  });
});
