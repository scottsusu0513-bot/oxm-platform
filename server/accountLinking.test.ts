/**
 * Verified Account Linking（Production Hardening Batch 2.7）— 整合測試，真的
 * 走本機測試資料庫。
 *
 * 流程：新的 LINE identity 的 email 撞到既有帳號「已驗證」的 primaryEmail →
 * 不自動合併、不建立第二個帳號 → 寄驗證信到既有帳號的可信 primaryEmail →
 * 使用者在同一個瀏覽器（pending cookie）點連結 → 才把 LINE identity 綁到
 * 既有帳號。之後 LINE／Google 都登入同一個 OXM user。
 *
 * 瀏覽器以 cookie jar 模擬：每個 jar 就是一個獨立的瀏覽器。寄信函式被
 * mock，以取得信中的 token（等同使用者收信）。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const sentLinkEmails = vi.hoisted(() => [] as { toEmail: string; verifyUrl: string; providerLabel: string; expiresInMinutes?: number }[]);
const sentVerifyEmails = vi.hoisted(() => [] as { toEmail: string; verifyUrl: string }[]);
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendAccountLinkVerificationEmail: vi.fn(async (p: { toEmail: string; verifyUrl: string; providerLabel: string; expiresInMinutes?: number }) => { sentLinkEmails.push(p); }),
    sendEmailVerificationEmail: vi.fn(async (p: { toEmail: string; verifyUrl: string }) => { sentVerifyEmails.push(p); }),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  resolveProviderLoginAction, startPendingAccountLink, completePendingAccountLink,
  cancelPendingAccountLink, resendPendingAccountLink, describePendingAccountLink,
  PENDING_ACCOUNT_LINK_COOKIE, maskEmail,
} from "./_core/accountLink";
import { handleOAuthCallback, isLineEmailVerified } from "./_core/oauthHelpers";
import { isAdminUser } from "./_core/admin";
import { COOKIE_NAME } from "@shared/const";
import { ensureTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdOpenIds: string[] = [];

afterAll(async () => {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM userAuthAccounts WHERE providerAccountId LIKE ${`al-${runId}-%`}`);
  for (const openId of createdOpenIds) await conn.execute(sql`DELETE FROM users WHERE openId = ${openId}`);
  for (const id of createdUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

beforeEach(() => { sentLinkEmails.length = 0; });

// ── 模擬瀏覽器 ──────────────────────────────────────────────────────────
type Browser = Map<string, string>;
const newBrowser = (): Browser => new Map();
function req(browser: Browser): any {
  return {
    protocol: "https",
    headers: { cookie: Array.from(browser, ([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") },
  };
}
function res(browser: Browser): any {
  return {
    cookie: (name: string, value: string) => { browser.set(name, value); },
    clearCookie: (name: string) => { browser.delete(name); },
    setHeader: () => {},
  };
}
function tokenFromLastEmail(): string {
  const last = sentLinkEmails.at(-1);
  if (!last) throw new Error("no link email sent");
  return new URL(last.verifyUrl).searchParams.get("token")!;
}

// ── 測試資料 ────────────────────────────────────────────────────────────
async function mkVerifiedUser(label: string, opts: { role?: "user" | "admin" } = {}) {
  const id = await ensureTestUser(`al-${label}-${runId}`, `既有帳號 ${label}`);
  createdUserIds.push(id);
  const email = `al-${label}-${runId}@example.test`;
  await db.setPrimaryEmailVerified(id, email);
  if (opts.role === "admin") {
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE users SET role = 'admin' WHERE id = ${id}`);
  }
  return { user: (await db.getUserById(id))!, email };
}
async function linkGoogle(userId: number, label: string) {
  await db.upsertUserAuthAccount({ userId, provider: "google", providerAccountId: `al-${runId}-g-${label}`, providerEmailVerified: true });
}
const lineSub = (label: string) => `al-${runId}-line-${label}`;
/** drizzle 的 timestamp 欄位以 UTC 字串讀寫；測試直接改時間戳記時用同一個格式。 */
const utcSql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** 模擬 LINE callback：依 resolveProviderLoginAction 決定登入或進入連結流程。 */
async function lineCallback(browser: Browser, sub: string, email: string | null) {
  const action = await resolveProviderLoginAction({ provider: "line", providerAccountId: sub, providerEmail: email });
  if (action.kind === "link_required") {
    await startPendingAccountLink({ req: req(browser), res: res(browser), target: action.target, provider: "line", providerAccountId: sub, displayName: "LINE 使用者" });
    return { kind: "link_required" as const, targetId: action.target.id };
  }
  createdOpenIds.push(`line_${sub}`);
  const r = await handleOAuthCallback({ provider: "line", providerAccountId: sub, providerEmail: email, providerEmailVerified: isLineEmailVerified(), displayName: "LINE 使用者" });
  return { kind: "login" as const, user: (await db.getUserByOpenId(r.openId))! };
}

async function userCount(): Promise<number> {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT COUNT(*) AS n FROM users`)) as unknown as [{ n: number }[], unknown];
  return Number(rows[0].n);
}

function trpcCtx(browser: Browser): TrpcContext {
  return { user: null, req: req(browser), res: res(browser) } as unknown as TrpcContext;
}

// ── 既有 LINE identity ───────────────────────────────────────────────────
describe("既有 LINE identity：以 provider subject 為準，不走 email 連結", () => {
  it("A／B／C：已綁 User → 有 email、沒 email、email 改變都登入同一個 User，不重新連結", async () => {
    const { user } = await mkVerifiedUser("abc");
    await db.linkProviderIdentityToUser({ userId: user.id, provider: "line", providerAccountId: lineSub("abc") });
    const other = await mkVerifiedUser("abc-other");
    for (const email of [`al-abc-${runId}@example.test`, null, other.email]) {
      const b = newBrowser();
      const r = await lineCallback(b, lineSub("abc"), email);
      expect(r.kind).toBe("login");
      if (r.kind === "login") expect(r.user.id).toBe(user.id);
      expect(b.has(PENDING_ACCOUNT_LINK_COOKIE)).toBe(false);
    }
    expect(sentLinkEmails).toHaveLength(0);
  });
});

// ── 沒有撞到 ─────────────────────────────────────────────────────────────
describe("沒有撞到既有帳號：照 Batch 2.6 正常建立 LINE 帳號", () => {
  it("D：沒有 email → 建立 LINE 帳號", async () => {
    const r = await lineCallback(newBrowser(), lineSub("d"), null);
    expect(r.kind).toBe("login");
  });
  it("E／F／G：email 沒撞到任何可信帳號 → 建立 LINE 帳號；email 不成為可信 primaryEmail、不給 admin", async () => {
    const r = await lineCallback(newBrowser(), lineSub("e"), `al-nobody-${runId}@example.test`);
    expect(r.kind).toBe("login");
    if (r.kind === "login") {
      expect(r.user.primaryEmail ?? null).toBeNull();
      expect(r.user.primaryEmailVerifiedAt ?? null).toBeNull();
      expect(r.user.email ?? null).toBeNull();
      expect(r.user.role).not.toBe("admin");
      expect(isAdminUser(r.user)).toBe(false);
    }
    expect(sentLinkEmails).toHaveLength(0);
  });
  it("未驗證的 primaryEmail 不算可信帳號 → 不觸發連結", async () => {
    const id = await ensureTestUser(`al-unverified-${runId}`, "未驗證信箱帳號");
    createdUserIds.push(id);
    await db.setPrimaryEmail(id, `al-unverified-${runId}@example.test`);
    const r = await lineCallback(newBrowser(), lineSub("unverified"), `al-unverified-${runId}@example.test`);
    expect(r.kind).toBe("login");
  });
});

// ── 撞到既有帳號 ─────────────────────────────────────────────────────────
describe("撞到既有可信帳號 → 驗證後連結", () => {
  it("H：不自動合併、不建立第二個永久 User、進入 pending；I：驗證信寄到目標帳號的 primaryEmail", async () => {
    const { user, email } = await mkVerifiedUser("h");
    const before = await userCount();
    const b = newBrowser();
    const r = await lineCallback(b, lineSub("h"), email.toUpperCase().toLowerCase());
    expect(r).toEqual({ kind: "link_required", targetId: user.id });
    expect(await userCount()).toBe(before);                               // 沒有建立任何 user
    expect(await db.getUserByAuthAccount("line", lineSub("h"))).toBeUndefined(); // 尚未綁定
    expect(b.has(PENDING_ACCOUNT_LINK_COOKIE)).toBe(true);
    expect(sentLinkEmails).toHaveLength(1);
    expect(sentLinkEmails[0].toEmail).toBe(user.primaryEmail);          // 從目標帳號讀取
    expect(sentLinkEmails[0].providerLabel).toBe("LINE");
    const described = await describePendingAccountLink(req(b));
    expect(described).toEqual({ provider: "line", providerLabel: "LINE", maskedEmail: maskEmail(email) });
    expect(described!.maskedEmail).not.toContain(email.split("@")[0]);  // 不完整暴露 email
  });

  it("J／K：verify 只接受 token，沒有 targetUserId／email 參數；cookie 被竄改就無效", async () => {
    const { email } = await mkVerifiedUser("jk");
    const b = newBrowser();
    await lineCallback(b, lineSub("jk"), email);
    const token = tokenFromLastEmail();
    // 多送的欄位會被 zod 丟棄，無法指定目標帳號或 email
    const caller = appRouter.createCaller(trpcCtx(b));
    const tampered = new Map(b);
    tampered.set(PENDING_ACCOUNT_LINK_COOKIE, `${b.get(PENDING_ACCOUNT_LINK_COOKIE)!.slice(0, -4)}AAAA`);
    await expect(appRouter.createCaller(trpcCtx(tampered)).accountLink.verify({ token })).rejects.toThrow(/驗證失敗或已過期/);
    await expect(caller.accountLink.verify({ token, targetUserId: 1, email: "attacker@example.test" } as any)).resolves.toEqual({ success: true });
  });

  it("L／M／N／O：正確驗證 → LINE 綁到既有 User；之後 LINE（有無 email）與 Google 都登入同一個 User；建立正常 session", async () => {
    const { user, email } = await mkVerifiedUser("lmno");
    await linkGoogle(user.id, "lmno");
    const b = newBrowser();
    await lineCallback(b, lineSub("lmno"), email);
    const caller = appRouter.createCaller(trpcCtx(b));
    await caller.accountLink.verify({ token: tokenFromLastEmail() });

    expect((await db.getUserByAuthAccount("line", lineSub("lmno")))?.id).toBe(user.id);
    expect(b.has(PENDING_ACCOUNT_LINK_COOKIE)).toBe(false);   // pending 狀態清除
    expect(b.has(COOKIE_NAME)).toBe(true);                    // 正常登入 session
    for (const e of [email, null]) {
      const again = await lineCallback(newBrowser(), lineSub("lmno"), e);
      expect(again.kind).toBe("login");
      if (again.kind === "login") expect(again.user.id).toBe(user.id);
    }
    expect((await db.getUserByAuthAccount("google", `al-${runId}-g-lmno`))?.id).toBe(user.id);
  });
});

describe("失敗情境：不連結、不修改既有帳號", () => {
  it("P：錯誤的 token → 失敗，沒有綁定，pending 仍可用正確 token 完成", async () => {
    const { user, email } = await mkVerifiedUser("p");
    const b = newBrowser();
    await lineCallback(b, lineSub("p"), email);
    const r = await completePendingAccountLink(req(b), res(b), "0".repeat(64));
    expect(r).toEqual({ ok: false, reason: "invalid", message: "驗證失敗或已過期，請重新驗證。" });
    expect(await db.getUserByAuthAccount("line", lineSub("p"))).toBeUndefined();
    expect((await completePendingAccountLink(req(b), res(b), tokenFromLastEmail())).ok).toBe(true);
    expect((await db.getUserByAuthAccount("line", lineSub("p")))?.id).toBe(user.id);
  });

  it("Q：token 過期 → 失敗、沒有綁定", async () => {
    const { email } = await mkVerifiedUser("q");
    const b = newBrowser();
    await lineCallback(b, lineSub("q"), email);
    const token = tokenFromLastEmail();
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE emailVerificationTokens SET expiresAt = ${utcSql(Date.now() - 60 * 1000)} WHERE email = ${email}`);
    expect((await completePendingAccountLink(req(b), res(b), token)).ok).toBe(false);
    expect(await db.getUserByAuthAccount("line", lineSub("q"))).toBeUndefined();
  });

  describe("Batch 2.8：Web 帳號連結期限 15 分鐘（fake time，不 sleep）", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("信件文案為 15 分鐘；14 分 59 秒時點連結仍有效", async () => {
      const { user, email } = await mkVerifiedUser("web1459");
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(t0);
      const b = newBrowser();
      await lineCallback(b, lineSub("web1459"), email);
      expect(sentLinkEmails.at(-1)?.expiresInMinutes).toBe(15);
      vi.setSystemTime(t0 + 14 * 60 * 1000 + 59 * 1000);
      expect((await completePendingAccountLink(req(b), res(b), tokenFromLastEmail())).ok).toBe(true);
      expect((await db.getUserByAuthAccount("line", lineSub("web1459")))?.id).toBe(user.id);
    });

    it("15 分 01 秒後點連結 → 過期失敗、沒有綁定", async () => {
      const { email } = await mkVerifiedUser("web1501");
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(t0);
      const b = newBrowser();
      await lineCallback(b, lineSub("web1501"), email);
      vi.setSystemTime(t0 + 15 * 60 * 1000 + 1000);
      expect((await completePendingAccountLink(req(b), res(b), tokenFromLastEmail())).ok).toBe(false);
      expect(await db.getUserByAuthAccount("line", lineSub("web1501"))).toBeUndefined();
    });

    it("一般 Email 驗證仍是 24 小時：23 小時 59 分有效、24 小時 01 分過期（兩個 policy 分開）", async () => {
      const mk = async (label: string) => {
        const id = await ensureTestUser(`al-${label}-${runId}`, `一般驗證 ${label}`);
        createdUserIds.push(id);
        await db.setPrimaryEmail(id, `al-${label}-${runId}@example.test`);
        return (await db.getUserById(id))!;
      };
      const t0 = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      for (const [label, offset, ok] of [["ev2359", 23 * 3600e3 + 59 * 60e3, true], ["ev2401", 24 * 3600e3 + 60e3, false]] as const) {
        vi.setSystemTime(t0);
        const u = await mk(label);
        const caller = appRouter.createCaller({ user: u, req: req(newBrowser()), res: res(newBrowser()) } as unknown as TrpcContext);
        await caller.auth.sendVerificationEmail();
        const token = new URL(sentVerifyEmails.at(-1)!.verifyUrl).searchParams.get("token")!;
        vi.setSystemTime(t0 + offset);
        if (ok) {
          await expect(caller.auth.verifyEmail({ token })).resolves.toMatchObject({ success: true });
          expect((await db.getUserById(u.id))?.primaryEmailVerifiedAt).not.toBeNull();
        } else {
          await expect(caller.auth.verifyEmail({ token })).rejects.toMatchObject({ message: "TOKEN_INVALID_OR_EXPIRED" });
          expect((await db.getUserById(u.id))?.primaryEmailVerifiedAt).toBeNull();
        }
      }
    });
  });

  it("R：同一個 token 第二次使用 → 失敗（單次使用），併發兩次只會有一次成功", async () => {
    const { email } = await mkVerifiedUser("r");
    const b = newBrowser();
    await lineCallback(b, lineSub("r"), email);
    const token = tokenFromLastEmail();
    const b2 = new Map(b); // 同一個瀏覽器狀態的兩個併發請求
    const results = await Promise.all([
      completePendingAccountLink(req(b), res(b), token),
      completePendingAccountLink(req(b2), res(b2), token),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const again = new Map(b2);
    expect((await completePendingAccountLink(req(again), res(again), token)).ok).toBe(false);
  });

  it("S：取消 → 不連結，token 作廢，cookie 清除，既有帳號不變", async () => {
    const { user, email } = await mkVerifiedUser("s");
    const b = newBrowser();
    await lineCallback(b, lineSub("s"), email);
    const token = tokenFromLastEmail();
    const snapshot = new Map(b);
    await cancelPendingAccountLink(req(b), res(b));
    expect(b.has(PENDING_ACCOUNT_LINK_COOKIE)).toBe(false);
    // 即使保留了取消前的 cookie，token 也已作廢
    expect((await completePendingAccountLink(req(snapshot), res(snapshot), token)).ok).toBe(false);
    expect(await db.getUserByAuthAccount("line", lineSub("s"))).toBeUndefined();
    expect((await db.getUserById(user.id))?.primaryEmail).toBe(email);
  });

  it("T：不同瀏覽器（沒有 pending cookie）拿到正確 token → 失敗，而且不會消耗掉 token", async () => {
    const { user, email } = await mkVerifiedUser("t");
    const origin = newBrowser();
    await lineCallback(origin, lineSub("t"), email);
    const token = tokenFromLastEmail();
    const other = newBrowser();
    expect((await completePendingAccountLink(req(other), res(other), token)).ok).toBe(false);
    expect(await db.getUserByAuthAccount("line", lineSub("t"))).toBeUndefined();
    // 原本的瀏覽器仍可完成（token 沒被另一個瀏覽器／信件掃描器消耗）
    expect((await completePendingAccountLink(req(origin), res(origin), token)).ok).toBe(true);
    expect((await db.getUserByAuthAccount("line", lineSub("t")))?.id).toBe(user.id);
  });

  it("U：同一個 LINE identity 兩個瀏覽器分別嘗試綁到不同帳號 → 只有一個成功，另一個被拒", async () => {
    const a = await mkVerifiedUser("u-a");
    const bUser = await mkVerifiedUser("u-b");
    const browserA = newBrowser();
    const browserB = newBrowser();
    await lineCallback(browserA, lineSub("u"), a.email);
    const tokenA = tokenFromLastEmail();
    await lineCallback(browserB, lineSub("u"), bUser.email);
    const tokenB = tokenFromLastEmail();
    const [ra, rb] = await Promise.all([
      completePendingAccountLink(req(browserA), res(browserA), tokenA),
      completePendingAccountLink(req(browserB), res(browserB), tokenB),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.message).toMatch(/已連結其他 OXM 帳號/);
    const owner = await db.getUserByAuthAccount("line", lineSub("u"));
    expect([a.user.id, bUser.user.id]).toContain(owner?.id);
  });

  it("V：目標帳號在驗證前被刪除 → 失敗", async () => {
    const { user, email } = await mkVerifiedUser("v");
    const b = newBrowser();
    await lineCallback(b, lineSub("v"), email);
    const token = tokenFromLastEmail();
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE users SET deletedAt = NOW() WHERE id = ${user.id}`);
    expect((await completePendingAccountLink(req(b), res(b), token)).ok).toBe(false);
    expect(await db.getUserByAuthAccount("line", lineSub("v"))).toBeUndefined();
  });

  it("V'：目標帳號在驗證前更換了 primaryEmail → 失敗", async () => {
    const { user, email } = await mkVerifiedUser("v2");
    const b = newBrowser();
    await lineCallback(b, lineSub("v2"), email);
    const token = tokenFromLastEmail();
    await db.setPrimaryEmailVerified(user.id, `al-v2-changed-${runId}@example.test`);
    expect((await completePendingAccountLink(req(b), res(b), token)).ok).toBe(false);
  });
});

describe("重寄：只寄到伺服器決定的目標信箱，沿用冷卻時間", () => {
  it("冷卻時間內 → cooldown；沒有 pending → invalid；重試 LINE 登入不重複寄信", async () => {
    const { email } = await mkVerifiedUser("resend");
    const b = newBrowser();
    await lineCallback(b, lineSub("resend"), email);
    expect(sentLinkEmails).toHaveLength(1);
    expect(await resendPendingAccountLink(req(b), res(b))).toBe("cooldown");
    expect(await resendPendingAccountLink(req(newBrowser()), res(newBrowser()))).toBe("invalid");
    await lineCallback(b, lineSub("resend"), email); // 使用者重試 LINE 登入
    expect(sentLinkEmails).toHaveLength(1);
    // 冷卻時間過後 → 重寄，新的 token 可以完成連結，舊的 token 不再對應 pending
    const oldToken = tokenFromLastEmail();
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE emailVerificationTokens SET createdAt = ${utcSql(Date.now() - 10 * 60 * 1000)} WHERE email = ${email}`);
    expect(await resendPendingAccountLink(req(b), res(b))).toBe("sent");
    expect(sentLinkEmails).toHaveLength(2);
    expect(sentLinkEmails[1].toEmail).toBe(email);
    expect((await completePendingAccountLink(req(new Map(b)), res(new Map(b)), oldToken)).ok).toBe(false);
    expect((await completePendingAccountLink(req(b), res(b), tokenFromLastEmail())).ok).toBe(true);
  });

  it("沒有 pending cookie 時 accountLink.pending 回 null（不存在查帳號的公開入口）", async () => {
    expect(await appRouter.createCaller(trpcCtx(newBrowser())).accountLink.pending()).toBeNull();
  });
});

describe("LINE callback 接線", () => {
  it("oauth.ts 的 LINE callback 在 handleOAuthCallback（會建立 user）之前先判斷是否需要連結；App 來源改走 OTP（Batch 2.8，見 appAccountLinking.test.ts）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "_core", "oauth.ts"), "utf-8");
    const lineCallbackSrc = source.slice(source.indexOf('"/api/oauth/line/callback"'), source.indexOf("// ── Apple: Initiate"));
    const decideAt = lineCallbackSrc.indexOf("resolveProviderLoginAction(");
    const startAt = lineCallbackSrc.indexOf("startPendingAccountLink(");
    const handleAt = lineCallbackSrc.indexOf("handleOAuthCallback(");
    expect(decideAt).toBeGreaterThan(0);
    expect(startAt).toBeGreaterThan(decideAt);
    expect(handleAt).toBeGreaterThan(startAt);
    expect(lineCallbackSrc).toContain('res.redirect(302, "/account-link")');
    expect(lineCallbackSrc).toContain("startAppAccountLinkChallenge(");
  });
});

describe("Admin 安全", () => {
  it("W：LINE email 等於 admin 帳號的可信信箱，但尚未驗證 → 不連結、不取得 admin、不建立帳號", async () => {
    const { user, email } = await mkVerifiedUser("w-admin", { role: "admin" });
    const before = await userCount();
    const b = newBrowser();
    const r = await lineCallback(b, lineSub("w"), email);
    expect(r).toEqual({ kind: "link_required", targetId: user.id });
    expect(await userCount()).toBe(before);
    expect(await db.getUserByAuthAccount("line", lineSub("w"))).toBeUndefined();
    // 還沒驗證就再用同一個 LINE 登入：仍然要求驗證，不會登入 admin
    const retry = await lineCallback(newBrowser(), lineSub("w"), email);
    expect(retry.kind).toBe("link_required");
  });

  it("X：完成可信信箱驗證 → LINE 可以連結到既有 admin 帳號（證明控制該帳號，不是 LINE email 授予 admin）", async () => {
    const { user, email } = await mkVerifiedUser("x-admin", { role: "admin" });
    const b = newBrowser();
    await lineCallback(b, lineSub("x"), email);
    await appRouter.createCaller(trpcCtx(b)).accountLink.verify({ token: tokenFromLastEmail() });
    const r = await lineCallback(newBrowser(), lineSub("x"), null);
    expect(r.kind).toBe("login");
    if (r.kind === "login") {
      expect(r.user.id).toBe(user.id);
      expect(r.user.role).toBe("admin");
    }
  });
});
