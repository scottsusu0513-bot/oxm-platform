/**
 * App LINE Account Linking（Production Hardening Batch 2.8）— 整合測試，真的
 * 走本機測試資料庫（accountLinkChallenges）。
 *
 * App 的 OAuth 在系統瀏覽器進行，無法滿足 Web 的「同一瀏覽器 cookie」綁定，
 * 所以改用寄到既有帳號可信 primaryEmail 的 6 位數驗證碼：
 *   LINE callback（source=app）偵測撞到可信帳號 → 建立 challenge、寄 OTP →
 *   App 只拿到簽章過、只含 challengeId 的不透明 state → 使用者輸入 OTP →
 *   DB 原子性檢查（有效期限、錯誤次數、單次使用）→ 共用 finalizeProviderLink。
 *
 * 寄信函式被 mock，以取得信中的 OTP（等同使用者收信）；crypto.randomInt 被
 * 包一層，只有在測試明確指定時才回傳固定值（用來驗證前導 0 的驗證碼）。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "crypto";
import { sql } from "drizzle-orm";

const sentOtpEmails = vi.hoisted(() => [] as { toEmail: string; code: string; providerLabel: string; expiresInMinutes: number; userName: string | null }[]);
const forcedRandomInt = vi.hoisted(() => ({ value: null as number | null }));

vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendAccountLinkOtpEmail: vi.fn(async (p: (typeof sentOtpEmails)[number]) => { sentOtpEmails.push(p); }),
    sendAccountLinkVerificationEmail: vi.fn(async () => {}),
  };
});
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  const randomInt = ((...args: Parameters<typeof actual.randomInt>) =>
    forcedRandomInt.value !== null ? forcedRandomInt.value : (actual.randomInt as (...a: unknown[]) => number)(...args)) as typeof actual.randomInt;
  return { ...actual, default: { ...actual, randomInt }, randomInt };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  resolveProviderLoginAction, startAppAccountLinkChallenge, verifyAppAccountLinkChallenge,
  resendAppAccountLinkChallenge, cancelAppAccountLinkChallenge, describeAppAccountLink,
  readAppAccountLinkState, generateAccountLinkOtp, hashAccountLinkOtp,
} from "./_core/accountLink";
import { ENV } from "./_core/env";
import { COOKIE_NAME } from "@shared/const";
import { ensureTestUser } from "./_core/financeTestFixtures";
import { SignJWT, decodeJwt } from "jose";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const MIN = 60 * 1000;

afterAll(async () => {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM userAuthAccounts WHERE providerAccountId LIKE ${`aal-${runId}-%`}`);
  // accountLinkChallenges.targetUserId 是 ON DELETE CASCADE
  for (const id of createdUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

beforeEach(() => { sentOtpEmails.length = 0; forcedRandomInt.value = null; });
afterEach(() => { forcedRandomInt.value = null; });

// ── 模擬 App WebView（cookie jar）────────────────────────────────────────
type Jar = Map<string, string>;
function ctxFor(jar: Jar): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: { cookie: "" } },
    res: {
      cookie: (name: string, value: string) => { jar.set(name, value); },
      clearCookie: (name: string) => { jar.delete(name); },
      setHeader: () => {},
    },
  } as unknown as TrpcContext;
}

// ── 測試資料 ────────────────────────────────────────────────────────────
async function mkVerifiedUser(label: string, opts: { role?: "user" | "admin" } = {}) {
  const id = await ensureTestUser(`aal-${label}-${runId}`, `既有帳號 ${label}`);
  createdUserIds.push(id);
  const email = `aal-${label}-${runId}@example.test`;
  await db.setPrimaryEmailVerified(id, email);
  if (opts.role === "admin") {
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE users SET role = 'admin' WHERE id = ${id}`);
  }
  return { user: (await db.getUserById(id))!, email };
}
const lineSub = (label: string) => `aal-${runId}-line-${label}`;
function lastOtp(): string {
  const last = sentOtpEmails.at(-1);
  if (!last) throw new Error("no OTP email sent");
  return last.code;
}
const wrongOf = (otp: string) => (otp === "999999" ? "999998" : "999999");

/** 模擬 App 的 LINE callback：撞到可信帳號 → 建立 OTP challenge，回傳 App 拿到的 state。 */
async function appLineCallback(sub: string, email: string | null, now?: Date) {
  const action = await resolveProviderLoginAction({ provider: "line", providerAccountId: sub, providerEmail: email });
  if (action.kind !== "link_required") return { kind: "login" as const };
  const started = await startAppAccountLinkChallenge({ target: action.target, provider: "line", providerAccountId: sub, displayName: "LINE 使用者", now });
  if (started.kind === "cooldown") return { kind: "cooldown" as const };
  return { kind: "link" as const, state: started.state, targetId: action.target.id, emailSent: started.emailSent };
}
async function startFor(label: string, opts: { role?: "user" | "admin"; now?: Date } = {}) {
  const { user, email } = await mkVerifiedUser(label, opts);
  const r = await appLineCallback(lineSub(label), email, opts.now);
  if (r.kind !== "link") throw new Error(`expected link flow, got ${r.kind}`);
  return { user, email, state: r.state, otp: lastOtp(), sub: lineSub(label) };
}
async function challengeRow(state: string) {
  const cid = await readAppAccountLinkState(state);
  return cid ? db.getAccountLinkChallenge(cid) : undefined;
}
async function userCount(): Promise<number> {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT COUNT(*) AS n FROM users`)) as unknown as [{ n: number }[], unknown];
  return Number(rows[0].n);
}
const linkedUserId = async (sub: string) => (await db.getUserByAuthAccount("line", sub))?.id;

// ─────────────────────────────────────────────────────────────────────────
describe("起始：只有撞到可信既有帳號才進入 OTP 流程", () => {
  it("A：App 新的 LINE sub、email 沒撞到任何帳號 → 照常登入流程，不建立 challenge、不寄 OTP", async () => {
    const r = await appLineCallback(lineSub("a"), `aal-nobody-${runId}@example.test`);
    expect(r.kind).toBe("login");
    const r2 = await appLineCallback(lineSub("a2"), null);
    expect(r2.kind).toBe("login");
    expect(sentOtpEmails).toHaveLength(0);
  });

  it("B：OTP 只寄到目標帳號的可信 primaryEmail（即使 LINE email 大小寫不同）；不建立 user、不連結", async () => {
    const { user, email } = await mkVerifiedUser("b");
    const before = await userCount();
    const r = await appLineCallback(lineSub("b"), email.toUpperCase());
    expect(r.kind).toBe("link");
    expect(sentOtpEmails).toHaveLength(1);
    expect(sentOtpEmails[0].toEmail).toBe(user.primaryEmail);
    expect(sentOtpEmails[0].expiresInMinutes).toBe(15);
    expect(await userCount()).toBe(before);
    expect(await linkedUserId(lineSub("b"))).toBeUndefined();
  });
});

describe("App 不能指定目標帳號／信箱", () => {
  it("C／D：state 只含 challengeId；appVerify 夾帶 targetUserId／email 會被忽略，只連結到伺服器端記錄的目標", async () => {
    const { user, state, otp, sub } = await startFor("cd");
    const other = await mkVerifiedUser("cd-other");
    const payload = decodeJwt(state);
    expect(Object.keys(payload).sort()).toEqual(["cid", "exp", "typ"]);
    expect(JSON.stringify(payload)).not.toContain(String(user.id));
    expect(JSON.stringify(payload)).not.toContain(user.primaryEmail!);
    expect(JSON.stringify(payload)).not.toContain(sub);

    const res = await appRouter.createCaller(ctxFor(new Map())).accountLink.appVerify(
      { state, code: otp, targetUserId: other.user.id, email: other.email, targetEmail: other.email } as any,
    );
    expect(res).toEqual({ success: true });
    expect(await linkedUserId(sub)).toBe(user.id);
  });

  it("C：偽造 state（別的 secret 簽章／改 typ）→ 失敗", async () => {
    const { state, otp, sub } = await startFor("c-forge");
    const cid = decodeJwt(state).cid as string;
    const forged = await new SignJWT({ typ: "app_account_link", cid })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime("15m")
      .sign(new TextEncoder().encode("not-the-server-secret-" + runId));
    expect((await verifyAppAccountLinkChallenge(forged, otp)).ok).toBe(false);
    const wrongTyp = await new SignJWT({ typ: "pending_account_link", cid })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime("15m")
      .sign(new TextEncoder().encode(ENV.cookieSecret));
    expect((await verifyAppAccountLinkChallenge(wrongTyp, otp)).ok).toBe(false);
    expect(await linkedUserId(sub)).toBeUndefined();
  });
});

describe("OTP 產生與儲存", () => {
  it("E：OTP 一律恰好 6 位數字", async () => {
    for (let i = 0; i < 200; i++) expect(generateAccountLinkOtp()).toMatch(/^\d{6}$/);
    const { otp } = await startFor("e");
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("F：前導 0 的 OTP（000123）可以正常驗證", async () => {
    forcedRandomInt.value = 123;
    const { state, otp, user, sub } = await startFor("f");
    forcedRandomInt.value = null;
    expect(otp).toBe("000123");
    expect((await verifyAppAccountLinkChallenge(state, "123")).ok).toBe(false); // 去掉前導 0 不算正確
    const r = await verifyAppAccountLinkChallenge(state, "000123");
    expect(r.ok).toBe(true);
    expect(await linkedUserId(sub)).toBe(user.id);
  });

  it("G：DB 不存 plaintext OTP，也不存 SHA256(OTP)；存的是綁定 context、需要伺服器 secret 的 HMAC", async () => {
    const { state, otp, user, sub } = await startFor("g");
    const row = (await challengeRow(state))!;
    const conn = (await db.getDb())!;
    const [raw] = (await conn.execute(sql`SELECT * FROM accountLinkChallenges WHERE id = ${row.id}`)) as unknown as [Record<string, unknown>[], unknown];
    const serialized = JSON.stringify(raw[0]);
    expect(serialized).not.toContain(otp);
    expect(row.secretHash).not.toBe(createHash("sha256").update(otp).digest("hex"));
    expect(row.secretHash).toBe(hashAccountLinkOtp({ challengeId: row.challengeId, targetUserId: user.id, provider: "line", providerAccountId: sub }, otp));
    // 沒有伺服器 secret（或 context 不同）就算不出同一個值
    const noSecret = createHmac("sha256", "guess").update(`oxm-account-link-otp:v1|${row.challengeId}|${user.id}|line|${sub}|${otp}`).digest("hex");
    expect(row.secretHash).not.toBe(noSecret);
    expect(row.secretHash).not.toBe(hashAccountLinkOtp({ challengeId: row.challengeId, targetUserId: user.id + 1, provider: "line", providerAccountId: sub }, otp));
    expect(row.secretHash).not.toBe(hashAccountLinkOtp({ challengeId: row.challengeId, targetUserId: user.id, provider: "line", providerAccountId: sub + "x" }, otp));
    expect(row.channel).toBe("app_otp");
    expect(row.maxAttempts).toBe(5);
    expect(row.failedAttempts).toBe(0);
  });

  it("H：整個流程（開始、錯誤、重寄、正確、replay）的 console 輸出都不含 OTP／state", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(level =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); }),
    );
    try {
      const t0 = new Date();
      const { state, otp } = await startFor("h", { now: t0 });
      await verifyAppAccountLinkChallenge(state, wrongOf(otp), t0);
      const resent = await resendAppAccountLinkChallenge(state, new Date(t0.getTime() + 5 * MIN + 1000));
      expect(resent.kind).toBe("sent");
      const newState = resent.kind === "sent" ? resent.state : "";
      const newOtp = lastOtp();
      await appRouter.createCaller(ctxFor(new Map())).accountLink.appVerify({ state: newState, code: newOtp });
      await appRouter.createCaller(ctxFor(new Map())).accountLink.appVerify({ state: newState, code: newOtp });
      const all = logged.join("\n");
      for (const secret of [otp, newOtp, state, newState]) expect(all).not.toContain(secret);
    } finally {
      spies.forEach(s => s.mockRestore());
    }
  });
});

describe("成功連結", () => {
  it("I／J／K：正確 OTP → LINE 綁到既有 User、建立正常 session；之後 LINE 與 Google 都登入同一個 User", async () => {
    const { user, email, state, otp, sub } = await startFor("ijk");
    await db.upsertUserAuthAccount({ userId: user.id, provider: "google", providerAccountId: `aal-${runId}-g-ijk`, providerEmailVerified: true });
    const before = await userCount();
    const jar: Jar = new Map();
    const res = await appRouter.createCaller(ctxFor(jar)).accountLink.appVerify({ state, code: otp });
    expect(res).toEqual({ success: true });
    expect(jar.has(COOKIE_NAME)).toBe(true);
    expect(await linkedUserId(sub)).toBe(user.id);
    expect(await userCount()).toBe(before);
    // J：之後 LINE 登入（有無 email）直接是 login，不再要求連結
    for (const e of [email, null]) {
      const again = await resolveProviderLoginAction({ provider: "line", providerAccountId: sub, providerEmail: e });
      expect(again.kind).toBe("login");
    }
    // K：Google identity 仍屬於同一個 User
    expect((await db.getUserByAuthAccount("google", `aal-${runId}-g-ijk`))?.id).toBe(user.id);
    expect(await describeAppAccountLink(state)).toBeNull(); // 已使用的 challenge 不再提供資訊
  });
});

describe("錯誤次數（DB 原子性累加）", () => {
  it("L／M：錯誤 OTP → 失敗、剩餘次數遞減，DB failedAttempts 同步累加；之後正確 OTP 仍可完成", async () => {
    const { state, otp, user, sub } = await startFor("lm");
    const r1 = await verifyAppAccountLinkChallenge(state, wrongOf(otp));
    expect(r1).toMatchObject({ ok: false, reason: "wrong", remainingAttempts: 4 });
    expect((await challengeRow(state))!.failedAttempts).toBe(1);
    const r2 = await verifyAppAccountLinkChallenge(state, "abc");
    expect(r2).toMatchObject({ ok: false, reason: "wrong", remainingAttempts: 3 });
    expect((await challengeRow(state))!.failedAttempts).toBe(2);
    expect(await linkedUserId(sub)).toBeUndefined();
    expect((await verifyAppAccountLinkChallenge(state, otp)).ok).toBe(true);
    expect(await linkedUserId(sub)).toBe(user.id);
  });

  it("N／O：連續 5 次錯誤 → challenge 作廢；第 6 次即使輸入正確 OTP 也失敗", async () => {
    const { state, otp, sub } = await startFor("no");
    for (let i = 1; i <= 4; i++) {
      expect(await verifyAppAccountLinkChallenge(state, wrongOf(otp))).toMatchObject({ reason: "wrong", remainingAttempts: 5 - i });
    }
    expect(await verifyAppAccountLinkChallenge(state, wrongOf(otp))).toMatchObject({ ok: false, reason: "exhausted", remainingAttempts: 0 });
    const row = (await challengeRow(state))!;
    expect(row.failedAttempts).toBe(5);
    expect(row.invalidatedAt).not.toBeNull();
    expect(await verifyAppAccountLinkChallenge(state, otp)).toMatchObject({ ok: false, reason: "exhausted" });
    expect(await verifyAppAccountLinkChallenge(state, wrongOf(otp))).toMatchObject({ ok: false, reason: "exhausted" });
    expect((await challengeRow(state))!.failedAttempts).toBe(5); // 作廢後不再累加
    expect(await linkedUserId(sub)).toBeUndefined();
    expect((await describeAppAccountLink(state))?.active).toBe(false);
  });

  it("併發：10 個錯誤 OTP 同時送達 → failedAttempts 恰好停在 5，之後正確 OTP 失敗", async () => {
    const { state, otp, sub } = await startFor("burst");
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyAppAccountLinkChallenge(state, wrongOf(otp))));
    expect(results.every(r => !r.ok)).toBe(true);
    expect((await challengeRow(state))!.failedAttempts).toBe(5);
    expect((await verifyAppAccountLinkChallenge(state, otp)).ok).toBe(false);
    expect(await linkedUserId(sub)).toBeUndefined();
  });

  it("併發：第 5 次錯誤與正確 OTP 幾乎同時送達 → 只可能其中一種結果，不會在錯誤滿 5 次後仍成功", async () => {
    for (let round = 0; round < 6; round++) {
      const { state, otp, user, sub } = await startFor(`race5-${round}`);
      for (let i = 0; i < 4; i++) await verifyAppAccountLinkChallenge(state, wrongOf(otp));
      const [wrong, right] = await Promise.all([
        verifyAppAccountLinkChallenge(state, wrongOf(otp)),
        verifyAppAccountLinkChallenge(state, otp),
      ]);
      const row = (await challengeRow(state))!;
      if (right.ok) {
        // 正確的先拿到列鎖：已消耗，錯誤的不再累加
        expect(row.consumedAt).not.toBeNull();
        expect(row.failedAttempts).toBe(4);
        expect(wrong.ok).toBe(false);
        expect(await linkedUserId(sub)).toBe(user.id);
      } else {
        // 錯誤的先到：錯誤滿 5 次，正確的也失敗
        expect(row.failedAttempts).toBe(5);
        expect(row.consumedAt).toBeNull();
        expect(await linkedUserId(sub)).toBeUndefined();
      }
    }
  });
});

describe("重新寄送", () => {
  it("P／Q：5 分鐘內重寄 → cooldown；之後重寄 → 舊 OTP／舊 state 立即失效，只有新 OTP 有效", async () => {
    const t0 = new Date();
    const { state: oldState, otp: oldOtp, user, sub } = await startFor("pq", { now: t0 });
    expect(await resendAppAccountLinkChallenge(oldState, new Date(t0.getTime() + 4 * MIN))).toEqual({ kind: "cooldown" });
    await expect(appRouter.createCaller(ctxFor(new Map())).accountLink.appResend({ state: oldState })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sentOtpEmails).toHaveLength(1);

    const t1 = new Date(t0.getTime() + 5 * MIN + 1000);
    const resent = await resendAppAccountLinkChallenge(oldState, t1);
    expect(resent.kind).toBe("sent");
    if (resent.kind !== "sent") return;
    const newOtp = lastOtp();
    expect(sentOtpEmails).toHaveLength(2);
    expect(sentOtpEmails[1].toEmail).toBe(user.primaryEmail);

    const oldRow = (await challengeRow(oldState))!;
    expect(oldRow.invalidatedAt).not.toBeNull();
    expect((await verifyAppAccountLinkChallenge(oldState, oldOtp, t1)).ok).toBe(false);
    if (newOtp !== oldOtp) expect(await verifyAppAccountLinkChallenge(resent.state, oldOtp, t1)).toMatchObject({ ok: false, reason: "wrong" });
    expect((await verifyAppAccountLinkChallenge(resent.state, newOtp, t1)).ok).toBe(true);
    expect(await linkedUserId(sub)).toBe(user.id);
  });

  it("冷卻時間內再次以同一個 LINE 登入 → 沿用同一個 challenge、不重複寄信；其他 LINE identity 撞同一帳號 → cooldown", async () => {
    const t0 = new Date();
    const { email, state } = await startFor("reuse", { now: t0 });
    const again = await appLineCallback(lineSub("reuse"), email, new Date(t0.getTime() + MIN));
    expect(again.kind).toBe("link");
    if (again.kind === "link") {
      expect(again.emailSent).toBe(false);
      expect(await readAppAccountLinkState(again.state)).toBe(await readAppAccountLinkState(state));
    }
    expect(await appLineCallback(lineSub("reuse-other"), email, new Date(t0.getTime() + MIN))).toEqual({ kind: "cooldown" });
    expect(sentOtpEmails).toHaveLength(1);
  });
});

describe("有效期限 15 分鐘", () => {
  it("R：14 分 59 秒時正確 OTP 仍有效", async () => {
    const t0 = new Date();
    const { state, otp, user, sub } = await startFor("r", { now: t0 });
    const row = (await challengeRow(state))!;
    expect(row.expiresAt.getTime() - t0.getTime()).toBeLessThanOrEqual(15 * MIN);
    expect(row.expiresAt.getTime() - t0.getTime()).toBeGreaterThan(15 * MIN - 1000);
    expect((await verifyAppAccountLinkChallenge(state, otp, new Date(t0.getTime() + 14 * MIN + 59 * 1000))).ok).toBe(true);
    expect(await linkedUserId(sub)).toBe(user.id);
  });

  it("S：15 分 01 秒後正確 OTP 被拒（expired），不連結、不累加錯誤次數", async () => {
    const t0 = new Date();
    const { state, otp, sub } = await startFor("s", { now: t0 });
    const late = new Date(t0.getTime() + 15 * MIN + 1000);
    expect(await verifyAppAccountLinkChallenge(state, otp, late)).toMatchObject({ ok: false, reason: "expired" });
    expect(await verifyAppAccountLinkChallenge(state, wrongOf(otp), late)).toMatchObject({ ok: false, reason: "expired" });
    expect((await challengeRow(state))!.failedAttempts).toBe(0);
    expect(await linkedUserId(sub)).toBeUndefined();
  });
});

describe("單次使用與 replay", () => {
  it("T／U：成功後同一個 state＋OTP 再送一次 → 失敗（已使用）；併發重複送出只會成功一次", async () => {
    const { state, otp, user, sub } = await startFor("tu");
    const results = await Promise.all([
      verifyAppAccountLinkChallenge(state, otp),
      verifyAppAccountLinkChallenge(state, otp),
      verifyAppAccountLinkChallenge(state, otp),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await linkedUserId(sub)).toBe(user.id);
    const replay = await appRouter.createCaller(ctxFor(new Map())).accountLink.appVerify({ state, code: otp });
    expect(replay).toMatchObject({ success: false, reason: "invalid" });
  });
});

describe("失敗情境：不連結、不修改既有帳號", () => {
  it("V：LINE sub 在流程中被連結到其他帳號 → taken，不改變任何綁定", async () => {
    const { state, otp, sub } = await startFor("v");
    const other = await mkVerifiedUser("v-other");
    await db.linkProviderIdentityToUser({ userId: other.user.id, provider: "line", providerAccountId: sub });
    expect(await verifyAppAccountLinkChallenge(state, otp)).toMatchObject({ ok: false, reason: "taken" });
    expect(await linkedUserId(sub)).toBe(other.user.id);
  });

  it("W：流程中目標帳號 primaryEmail 被改掉 → 失敗，不連結", async () => {
    const { user, state, otp, sub } = await startFor("w");
    await db.setPrimaryEmailVerified(user.id, `aal-w-new-${runId}@example.test`);
    expect(await verifyAppAccountLinkChallenge(state, otp)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await linkedUserId(sub)).toBeUndefined();
  });

  it("X：流程中目標帳號 email 變成未驗證 → 失敗，不連結", async () => {
    const { user, state, otp, sub } = await startFor("x");
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE users SET primaryEmailVerifiedAt = NULL WHERE id = ${user.id}`);
    expect((await verifyAppAccountLinkChallenge(state, otp)).ok).toBe(false);
    expect(await linkedUserId(sub)).toBeUndefined();
  });

  it("Y：流程中目標帳號被刪除 → 失敗，不連結；重寄也失敗", async () => {
    const { user, state, otp, sub } = await startFor("y");
    await db.softDeleteUser(user.id);
    expect((await verifyAppAccountLinkChallenge(state, otp)).ok).toBe(false);
    expect(await resendAppAccountLinkChallenge(state, new Date(Date.now() + 6 * MIN))).toEqual({ kind: "invalid" });
    expect(await linkedUserId(sub)).toBeUndefined();
  });

  it("Z：取消 → challenge 作廢，之後正確 OTP 也失敗；既有帳號沒有任何變更", async () => {
    const { user, state, otp, sub } = await startFor("z");
    const before = await db.getUserById(user.id);
    await appRouter.createCaller(ctxFor(new Map())).accountLink.appCancel({ state });
    expect((await challengeRow(state))!.invalidatedAt).not.toBeNull();
    expect((await verifyAppAccountLinkChallenge(state, otp)).ok).toBe(false);
    expect(await linkedUserId(sub)).toBeUndefined();
    const after = await db.getUserById(user.id);
    expect(after?.primaryEmail).toBe(before?.primaryEmail);
    expect(after?.role).toBe(before?.role);
    expect(after?.deletedAt).toBeNull();
  });

  it("AA：App 重啟／state 遺失或損毀 → 安全失敗（pending 回 null、verify 失敗），不洩漏任何帳號資訊", async () => {
    const caller = appRouter.createCaller(ctxFor(new Map()));
    expect(await caller.accountLink.appPending({ state: "garbage" })).toBeNull();
    expect(await caller.accountLink.appVerify({ state: "garbage", code: "123456" })).toMatchObject({ success: false, reason: "invalid" });
    await expect(caller.accountLink.appResend({ state: "garbage" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.accountLink.appCancel({ state: "garbage" })).resolves.toEqual({ success: true });
    // 前端 state 只放記憶體，不寫任何 Web Storage
    const fs = await import("node:fs");
    const path = await import("node:path");
    const clientDir = path.resolve(import.meta.dirname, "..", "client", "src");
    for (const file of ["lib/appAccountLink.ts", "pages/AccountLinkAppPage.tsx"]) {
      const src = fs.readFileSync(path.join(clientDir, file), "utf-8");
      expect(src).not.toMatch(/localStorage\.|sessionStorage\.|indexedDB/);
    }
  });

  it("AA：有效 state 的 appPending 只回遮罩後 email 與剩餘次數", async () => {
    const { user, state } = await startFor("aa-desc");
    const info = await appRouter.createCaller(ctxFor(new Map())).accountLink.appPending({ state });
    expect(info).toMatchObject({ providerLabel: "LINE", remainingAttempts: 5, active: true });
    expect(info!.maskedEmail).not.toBe(user.primaryEmail);
    expect(JSON.stringify(info)).not.toContain(String(user.id));
  });

  it("AB：同一個 LINE sub 同時對兩個不同帳號完成驗證 → 只有一個成功（uq_provider_account），另一個 taken", async () => {
    const sub = lineSub("ab");
    const a = await mkVerifiedUser("ab-a");
    const b = await mkVerifiedUser("ab-b");
    const sa = await startAppAccountLinkChallenge({ target: a.user, provider: "line", providerAccountId: sub, displayName: null });
    const otpA = lastOtp();
    const sb = await startAppAccountLinkChallenge({ target: b.user, provider: "line", providerAccountId: sub, displayName: null });
    const otpB = lastOtp();
    if (sa.kind !== "started" || sb.kind !== "started") throw new Error("expected started");
    const [ra, rb] = await Promise.all([verifyAppAccountLinkChallenge(sa.state, otpA), verifyAppAccountLinkChallenge(sb.state, otpB)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    expect(loser).toMatchObject({ ok: false, reason: "taken" });
    const owner = await linkedUserId(sub);
    expect([a.user.id, b.user.id]).toContain(owner);
    const conn = (await db.getDb())!;
    const [rows] = (await conn.execute(sql`SELECT COUNT(*) AS n FROM userAuthAccounts WHERE provider = 'line' AND providerAccountId = ${sub}`)) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0].n)).toBe(1);
  });
});

describe("Admin 安全", () => {
  it("AC：LINE email 等於 admin 的可信信箱 → 只寄 OTP，不登入、不給 admin、不建立帳號；錯誤 OTP 不會連結", async () => {
    const before = await userCount();
    const { user, state, otp, sub } = await startFor("ac-admin", { role: "admin" });
    expect(user.role).toBe("admin");
    expect(await userCount()).toBe(before + 1); // 只有測試自己建立的 admin
    expect(await linkedUserId(sub)).toBeUndefined();
    await verifyAppAccountLinkChallenge(state, wrongOf(otp));
    expect(await linkedUserId(sub)).toBeUndefined();
    const retry = await resolveProviderLoginAction({ provider: "line", providerAccountId: sub, providerEmail: user.primaryEmail });
    expect(retry.kind).toBe("link_required");
  });

  it("AD：輸入寄到 admin 可信信箱的正確 OTP → LINE 連結到既有 admin 帳號（證明控制信箱，不是 LINE email 授予 admin）", async () => {
    const { user, state, otp, sub } = await startFor("ad-admin", { role: "admin" });
    const jar: Jar = new Map();
    expect(await appRouter.createCaller(ctxFor(jar)).accountLink.appVerify({ state, code: otp })).toEqual({ success: true });
    expect(await linkedUserId(sub)).toBe(user.id);
    expect((await db.getUserById(user.id))?.role).toBe("admin");
    expect(jar.has(COOKIE_NAME)).toBe(true);
  });
});

describe("LINE callback 接線（App）", () => {
  it("oauth.ts：App 來源撞到可信帳號 → startAppAccountLinkChallenge，只把簽章 state 交給 App；不在 handleOAuthCallback 之後", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "_core", "oauth.ts"), "utf-8");
    const lineCallbackSrc = source.slice(source.indexOf('"/api/oauth/line/callback"'), source.indexOf("// ── Apple: Initiate"));
    const appAt = lineCallbackSrc.indexOf("startAppAccountLinkChallenge(");
    const handleAt = lineCallbackSrc.indexOf("handleOAuthCallback(");
    expect(appAt).toBeGreaterThan(0);
    expect(handleAt).toBeGreaterThan(appAt);
    expect(lineCallbackSrc).toContain("oxm://oauth/callback?link=${encodeURIComponent(started.state)}");
    expect(lineCallbackSrc).toContain('"oxm://oauth/callback?error=account_link_cooldown"');
    expect(lineCallbackSrc).not.toContain("account_link_required");
  });
});
