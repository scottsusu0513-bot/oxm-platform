/**
 * Verified Account Linking（Production Hardening Batch 2.7／2.8）。
 *
 * 情境：新的 provider identity（本輪只開 LINE）第一次登入，provider 回傳的
 * email 剛好等於某個既有 OXM 帳號「已驗證」的 primaryEmail。email 字串相同
 * 不能證明是同一個人（LINE 沒有可驗證的 email_verified），所以不自動合併，
 * 也不先建立第二個 OXM user；必須先證明控制既有帳號的可信信箱，才把 provider
 * identity 綁到既有帳號。
 *
 * 「證明控制信箱」有兩種方式，最後都呼叫同一個 finalizeProviderLink（同一套
 * 最終驗證＋同一個 linkProviderIdentityToUser，不是兩套綁定邏輯）：
 *
 * Web（Batch 2.7）：magic link ＋ 同一瀏覽器 cookie
 *   - 伺服器端：emailVerificationTokens 一列（userId＝目標帳號、email＝目標帳號
 *     當下的 primaryEmail、只存 SHA-256、單次使用），有效 15 分鐘。
 *   - 瀏覽器端：HttpOnly cookie（JWT_SECRET 簽章），記錄 provider、subject、
 *     目標 user、token hash，把這次 pending link 綁在發起 OAuth 的瀏覽器。
 *
 * App（Batch 2.8）：6 位數 OTP
 *   - Capacitor App 的 OAuth 在系統瀏覽器進行，信中連結會在另一個瀏覽器開啟，
 *     無法滿足 cookie 綁定，改用寄到目標帳號可信 primaryEmail 的驗證碼。
 *   - 伺服器端：accountLinkChallenges 一列（migration 0102）保存目標帳號、
 *     provider identity、HMAC-SHA256(JWT_SECRET, 驗證碼＋完整 context)、
 *     15 分鐘到期、錯誤次數（上限 5）、單次使用／作廢——全部以 DB 原子性條件
 *     寫入保證，不依賴 process 記憶體。
 *   - App 只持有 JWT_SECRET 簽章的不透明 state（只含 challengeId），無法藉此
 *     指定目標帳號、email 或 provider identity。
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { AccountLinkChallenge, User } from "../../drizzle/schema";
import * as db from "../db";
import { sendAccountLinkOtpEmail, sendAccountLinkVerificationEmail } from "../email";
import {
  ACCOUNT_LINK_VERIFICATION_TTL_MS,
  ACCOUNT_LINK_OTP_MAX_ATTEMPTS,
  ACCOUNT_LINK_OTP_DIGITS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  emailVerificationBaseUrl,
} from "../emailVerificationPolicy";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { generateRawToken, sha256Hex } from "./oauthHelpers";

export const PENDING_ACCOUNT_LINK_COOKIE = "oxm_pending_account_link";
export const ACCOUNT_LINK_FAILED_MESSAGE = "驗證失敗或已過期，請重新驗證。";
export const ACCOUNT_LINK_PROVIDER_TAKEN_MESSAGE = "此登入方式已連結其他 OXM 帳號，無法完成連結。";
export const ACCOUNT_LINK_TARGET_HAS_PROVIDER_MESSAGE = "您的 OXM 帳號已連結另一個相同類型的登入方式，無法完成連結。";
export const ACCOUNT_LINK_OTP_WRONG_MESSAGE = "驗證碼錯誤。";
export const ACCOUNT_LINK_OTP_EXPIRED_MESSAGE = "驗證碼已過期，請重新取得。";
export const ACCOUNT_LINK_OTP_EXHAUSTED_MESSAGE = "錯誤次數過多，請重新取得驗證碼。";
export const ACCOUNT_LINK_OTP_CHANNEL = "app_otp";

export type LinkableProvider = "line";
export const ACCOUNT_LINK_PROVIDER_LABEL: Record<LinkableProvider, string> = { line: "LINE" };
const ACCOUNT_LINK_TTL_MINUTES = ACCOUNT_LINK_VERIFICATION_TTL_MS / 60_000;

function secretKey() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

/** a***@example.com：只保留第一個字元與網域。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

function isTrustedTarget(user: User | undefined | null): user is User {
  return !!user && !user.deletedAt && !!user.primaryEmail && !!user.primaryEmailVerifiedAt;
}

/**
 * provider email 是否撞到「可信」的既有帳號：primaryEmail 必須已驗證
 * （getUserByPrimaryEmail 只回傳 primaryEmailVerifiedAt 有值的帳號）且帳號
 * 未刪除。只在 OAuth callback 成功之後由伺服器呼叫，不存在任何「輸入 email
 * 查帳號」的公開 API。
 */
export async function findAccountLinkTarget(providerEmail: string | null): Promise<User | null> {
  if (!providerEmail) return null;
  const target = await db.getUserByPrimaryEmail(providerEmail);
  return isTrustedTarget(target) ? target : null;
}

/**
 * LINE callback 取得 provider subject（及可能的 email）之後的決策：
 *   - 這個 provider identity 已綁定任何 OXM user（userAuthAccounts，或舊版
 *     以 openId=line_<sub> 建立、尚未有綁定紀錄的帳號）→ 正常登入，完全不看
 *     email，也不重新走連結流程。
 *   - 尚未綁定、email 撞到可信既有帳號 → 需要驗證後連結（不建立 user）。
 *   - 其他（沒有 email、或沒撞到）→ 正常建立 LINE 帳號（Batch 2.6 規則）。
 */
export async function resolveProviderLoginAction(params: {
  provider: LinkableProvider;
  providerAccountId: string;
  providerEmail: string | null;
}): Promise<{ kind: "login" } | { kind: "link_required"; target: User }> {
  const { provider, providerAccountId, providerEmail } = params;
  if (await db.getUserByAuthAccount(provider, providerAccountId)) return { kind: "login" };
  if (await db.getUserByOpenId(`${provider}_${providerAccountId}`)) return { kind: "login" };
  const target = await findAccountLinkTarget(providerEmail);
  return target ? { kind: "link_required", target } : { kind: "login" };
}

// ─────────────────────────────────────────────────────────────────────────
// 共用最終驗證＋綁定（Web magic link 與 App OTP 都呼叫這裡）
// ─────────────────────────────────────────────────────────────────────────

export type CompleteAccountLinkResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "expired" | "wrong" | "exhausted" | "taken" | "target_conflict"; message: string; remainingAttempts?: number };

const FAIL_INVALID = { ok: false as const, reason: "invalid" as const, message: ACCOUNT_LINK_FAILED_MESSAGE };

/**
 * 呼叫前，呼叫端已經完成「證明控制信箱」並原子性消耗了該次驗證（token 或
 * OTP 挑戰）。這裡重新確認：
 *   1. 目標帳號仍存在、未刪除、primaryEmail 仍已驗證且等於寄信當下的信箱
 *   2. provider 是允許的 provider（本輪只有 line）
 *   3. 這個 provider identity 尚未屬於其他帳號、目標帳號也沒有另一個同類 identity
 *   4. INSERT 綁定（userAuthAccounts.uq_provider_account 保證併發下只會有一個帳號成功）
 */
export async function finalizeProviderLink(params: {
  targetUserId: number;
  expectedEmail: string;
  provider: string;
  providerAccountId: string;
  displayName: string | null;
}): Promise<CompleteAccountLinkResult> {
  const target = await db.getUserById(params.targetUserId);
  if (!isTrustedTarget(target) || target.primaryEmail !== params.expectedEmail) return FAIL_INVALID;
  if (params.provider !== "line") return FAIL_INVALID;

  const existingOwner = await db.getUserByAuthAccount(params.provider, params.providerAccountId);
  if (existingOwner && existingOwner.id !== target.id) {
    return { ok: false, reason: "taken", message: ACCOUNT_LINK_PROVIDER_TAKEN_MESSAGE };
  }
  if (!existingOwner) {
    const sameTypeIdentity = await db.getAuthAccountByProviderForUser(target.id, params.provider);
    if (sameTypeIdentity) {
      return { ok: false, reason: "target_conflict", message: ACCOUNT_LINK_TARGET_HAS_PROVIDER_MESSAGE };
    }
    const linked = await db.linkProviderIdentityToUser({
      userId: target.id,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      displayName: params.displayName,
    });
    if (linked === "taken") return { ok: false, reason: "taken", message: ACCOUNT_LINK_PROVIDER_TAKEN_MESSAGE };
  }
  return { ok: true, user: target };
}

// ─────────────────────────────────────────────────────────────────────────
// Web：magic link ＋ 同一瀏覽器 cookie
// ─────────────────────────────────────────────────────────────────────────

type PendingAccountLinkPayload = {
  typ: "pending_account_link";
  tuid: number;
  prov: LinkableProvider;
  sub: string;
  th: string;
  dn: string | null;
};

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function setPendingCookie(req: Request, res: Response, payload: PendingAccountLinkPayload, expiresAt: Date) {
  const jwt = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
  res.cookie(PENDING_ACCOUNT_LINK_COOKIE, jwt, {
    ...getSessionCookieOptions(req),
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

export function clearPendingAccountLinkCookie(req: Request, res: Response) {
  res.clearCookie(PENDING_ACCOUNT_LINK_COOKIE, getSessionCookieOptions(req));
}

export async function readPendingAccountLink(req: Request): Promise<PendingAccountLinkPayload | null> {
  const raw = readCookie(req, PENDING_ACCOUNT_LINK_COOKIE);
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secretKey(), { algorithms: ["HS256"] });
    const p = payload as Partial<PendingAccountLinkPayload>;
    if (p.typ !== "pending_account_link" || p.prov !== "line" || typeof p.tuid !== "number"
      || typeof p.sub !== "string" || !p.sub || typeof p.th !== "string" || !p.th) return null;
    return { typ: p.typ, tuid: p.tuid, prov: p.prov, sub: p.sub, th: p.th, dn: typeof p.dn === "string" ? p.dn : null };
  } catch {
    return null;
  }
}

/**
 * 帳號連結期限：15 分鐘，無條件捨去到整秒。MySQL TIMESTAMP 不存毫秒且會
 * 四捨五入，捨去後寫入的期限永遠不會超過 15 分鐘。
 */
function accountLinkExpiry(fromMs: number): Date {
  return new Date(Math.floor((fromMs + ACCOUNT_LINK_VERIFICATION_TTL_MS) / 1000) * 1000);
}

async function issueMagicLinkAndEmail(target: User, provider: LinkableProvider): Promise<{ tokenHash: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = accountLinkExpiry(Date.now());
  // 寄件目標一律從目標帳號重新讀取的可信 primaryEmail，不是 provider 回傳的 email。
  const toEmail = target.primaryEmail!;
  await db.createEmailVerificationToken({ userId: target.id, tokenHash, email: toEmail, expiresAt });
  await sendAccountLinkVerificationEmail({
    toEmail,
    userName: target.name,
    providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[provider],
    verifyUrl: `${emailVerificationBaseUrl()}/account-link/verify?token=${rawToken}`,
    expiresInMinutes: ACCOUNT_LINK_TTL_MINUTES,
  });
  return { tokenHash, expiresAt };
}

/**
 * Web OAuth callback 偵測到 email 撞到可信既有帳號時呼叫：建立（或在寄信冷卻
 * 時間內沿用）pending link，寄驗證信，把 pending 狀態綁到這個瀏覽器。不登入、
 * 不建立任何 user、不修改既有帳號。
 */
export async function startPendingAccountLink(params: {
  req: Request;
  res: Response;
  target: User;
  provider: LinkableProvider;
  providerAccountId: string;
  displayName: string | null;
}): Promise<{ emailSent: boolean }> {
  const { req, res, target, provider, providerAccountId, displayName } = params;
  const recent = await db.getLatestEmailVerificationToken(target.id, target.primaryEmail!);
  const now = Date.now();
  let tokenHash: string;
  let expiresAt: Date;
  let emailSent = false;
  if (recent && recent.createdAt.getTime() > now - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS && recent.expiresAt.getTime() > now) {
    // 冷卻時間內（例如使用者重試 LINE 登入）：沿用最近一封信，不重複寄信。
    tokenHash = recent.tokenHash;
    expiresAt = recent.expiresAt;
  } else {
    ({ tokenHash, expiresAt } = await issueMagicLinkAndEmail(target, provider));
    emailSent = true;
  }
  await setPendingCookie(req, res, { typ: "pending_account_link", tuid: target.id, prov: provider, sub: providerAccountId, th: tokenHash, dn: displayName }, expiresAt);
  return { emailSent };
}

/** 目前瀏覽器的 pending link 摘要（只給遮罩後 email），沒有 pending 時回 null。 */
export async function describePendingAccountLink(req: Request): Promise<{ provider: LinkableProvider; providerLabel: string; maskedEmail: string } | null> {
  const pending = await readPendingAccountLink(req);
  if (!pending) return null;
  const target = await db.getUserById(pending.tuid);
  if (!isTrustedTarget(target)) return null;
  return { provider: pending.prov, providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[pending.prov], maskedEmail: maskEmail(target.primaryEmail!) };
}

/** 重新寄送：目標與 email 一律由 pending cookie＋資料庫決定，沿用寄信冷卻時間。 */
export async function resendPendingAccountLink(req: Request, res: Response): Promise<"sent" | "cooldown" | "invalid"> {
  const pending = await readPendingAccountLink(req);
  if (!pending) return "invalid";
  const target = await db.getUserById(pending.tuid);
  if (!isTrustedTarget(target)) return "invalid";
  const recent = await db.getLatestEmailVerificationToken(target.id, target.primaryEmail!);
  if (recent && recent.createdAt.getTime() > Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) return "cooldown";
  const { tokenHash, expiresAt } = await issueMagicLinkAndEmail(target, pending.prov);
  await setPendingCookie(req, res, { ...pending, th: tokenHash }, expiresAt);
  return "sent";
}

/** 取消：作廢這次 pending 的 token（單次使用機制）並清除 cookie，不修改任何帳號。 */
export async function cancelPendingAccountLink(req: Request, res: Response): Promise<void> {
  const pending = await readPendingAccountLink(req);
  if (pending) await db.consumeEmailVerificationToken(pending.th);
  clearPendingAccountLinkCookie(req, res);
}

/**
 * Web 完成連結：
 *   1. 這個瀏覽器有有效的 pending cookie（session binding、未過期、簽章正確）
 *   2. email 裡的 token 正是這次 pending 綁定的那一個（hash 相同）——先檢查
 *      cookie 與 hash 才消耗 token，信件掃描器等沒有 cookie 的請求不會用掉它
 *   3. token 原子性地「未使用 → 已使用」、未過期、屬於 pending 的目標帳號
 *   4. finalizeProviderLink（與 App OTP 共用）
 */
export async function completePendingAccountLink(req: Request, res: Response, rawToken: string): Promise<CompleteAccountLinkResult> {
  const pending = await readPendingAccountLink(req);
  if (!pending) return FAIL_INVALID;
  const tokenHash = sha256Hex(rawToken);
  if (tokenHash !== pending.th) return FAIL_INVALID;

  const consumed = await db.consumeEmailVerificationToken(tokenHash);
  if (!consumed.valid || consumed.userId !== pending.tuid || !consumed.email) return FAIL_INVALID;

  const result = await finalizeProviderLink({
    targetUserId: pending.tuid,
    expectedEmail: consumed.email,
    provider: pending.prov,
    providerAccountId: pending.sub,
    displayName: pending.dn,
  });
  clearPendingAccountLinkCookie(req, res);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// App：6 位數 OTP 挑戰（accountLinkChallenges）
// ─────────────────────────────────────────────────────────────────────────

type AppAccountLinkStatePayload = { typ: "app_account_link"; cid: string };

/** 6 位數、密碼學安全亂數（crypto.randomInt），保留前導 0。 */
export function generateAccountLinkOtp(): string {
  return randomInt(0, 10 ** ACCOUNT_LINK_OTP_DIGITS).toString().padStart(ACCOUNT_LINK_OTP_DIGITS, "0");
}

/**
 * HMAC-SHA256(JWT_SECRET, 用途＋版本＋challengeId＋目標帳號＋provider＋subject＋OTP)。
 * 6 位數只有一百萬種可能，單純 SHA-256(OTP) 在資料庫外洩時可以離線逐一枚舉；
 * 加上伺服器端 secret 後，沒有 secret 無法驗證任何候選值。context 綁定讓為 A
 * 挑戰產生的驗證碼無法用在 B 挑戰。
 */
export function hashAccountLinkOtp(ctx: {
  challengeId: string; targetUserId: number; provider: string; providerAccountId: string;
}, otp: string): string {
  return createHmac("sha256", ENV.cookieSecret)
    .update(`oxm-account-link-otp:v1|${ctx.challengeId}|${ctx.targetUserId}|${ctx.provider}|${ctx.providerAccountId}|${otp}`)
    .digest("hex");
}

async function signAppState(challengeId: string, expiresAt: Date): Promise<string> {
  return new SignJWT({ typ: "app_account_link", cid: challengeId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
}

/** App 持有的不透明 state → challengeId；簽章錯誤或過期回 null。 */
export async function readAppAccountLinkState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, secretKey(), { algorithms: ["HS256"] });
    const p = payload as Partial<AppAccountLinkStatePayload>;
    if (p.typ !== "app_account_link" || typeof p.cid !== "string" || !p.cid) return null;
    return p.cid;
  } catch {
    return null;
  }
}

function isChallengeActive(ch: AccountLinkChallenge, now: Date): boolean {
  return !ch.consumedAt && !ch.invalidatedAt && ch.expiresAt.getTime() > now.getTime() && ch.failedAttempts < ch.maxAttempts;
}

async function issueAppChallenge(target: User, provider: LinkableProvider, providerAccountId: string, displayName: string | null, now: Date): Promise<AccountLinkChallenge> {
  // 同一個 provider identity 只允許最新一組有效：先作廢舊的，再建立新的。
  await db.invalidateActiveAccountLinkChallenges({ targetUserId: target.id, provider, providerAccountId, now });
  const challengeId = randomBytes(24).toString("hex");
  const otp = generateAccountLinkOtp();
  const expiresAt = accountLinkExpiry(now.getTime());
  const toEmail = target.primaryEmail!;
  await db.createAccountLinkChallenge({
    challengeId,
    targetUserId: target.id,
    provider,
    providerAccountId,
    displayName,
    targetEmail: toEmail,
    channel: ACCOUNT_LINK_OTP_CHANNEL,
    secretHash: hashAccountLinkOtp({ challengeId, targetUserId: target.id, provider, providerAccountId }, otp),
    maxAttempts: ACCOUNT_LINK_OTP_MAX_ATTEMPTS,
    expiresAt,
    createdAt: now,
  });
  // 收件人一律是目標帳號的可信 primaryEmail；OTP 只出現在信件內容，不寫 log。
  await sendAccountLinkOtpEmail({
    toEmail,
    userName: target.name,
    providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[provider],
    code: otp,
    expiresInMinutes: ACCOUNT_LINK_TTL_MINUTES,
  });
  const created = await db.getAccountLinkChallenge(challengeId);
  if (!created) throw new Error("account link challenge not persisted");
  return created;
}

/**
 * App OAuth callback 偵測到 email 撞到可信既有帳號時呼叫：建立 OTP 挑戰並寄信，
 * 回傳給 App 的不透明 state。冷卻時間內：同一個 provider identity 的有效挑戰
 * 直接沿用（不重複寄信）；目標帳號剛為其他 identity 寄過信 → cooldown。
 */
export async function startAppAccountLinkChallenge(params: {
  target: User;
  provider: LinkableProvider;
  providerAccountId: string;
  displayName: string | null;
  now?: Date;
}): Promise<{ kind: "started"; state: string; emailSent: boolean } | { kind: "cooldown" }> {
  const now = params.now ?? new Date();
  const latest = await db.getLatestAccountLinkChallengeForTarget(params.target.id);
  if (latest && latest.createdAt.getTime() > now.getTime() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
    if (latest.provider === params.provider && latest.providerAccountId === params.providerAccountId && isChallengeActive(latest, now)) {
      return { kind: "started", state: await signAppState(latest.challengeId, latest.expiresAt), emailSent: false };
    }
    return { kind: "cooldown" };
  }
  const ch = await issueAppChallenge(params.target, params.provider, params.providerAccountId, params.displayName, now);
  return { kind: "started", state: await signAppState(ch.challengeId, ch.expiresAt), emailSent: true };
}

async function loadAppChallenge(state: string): Promise<AccountLinkChallenge | null> {
  const cid = await readAppAccountLinkState(state);
  if (!cid) return null;
  const ch = await db.getAccountLinkChallenge(cid);
  if (!ch || ch.channel !== ACCOUNT_LINK_OTP_CHANNEL || ch.provider !== "line") return null;
  return ch;
}

/** App 畫面顯示用：遮罩後 email、剩餘嘗試次數、是否仍有效。 */
export async function describeAppAccountLink(state: string, now: Date = new Date()): Promise<{
  providerLabel: string; maskedEmail: string; remainingAttempts: number; active: boolean; expiresAt: Date;
} | null> {
  const ch = await loadAppChallenge(state);
  if (!ch || ch.consumedAt) return null;
  return {
    providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[ch.provider as LinkableProvider],
    maskedEmail: maskEmail(ch.targetEmail),
    remainingAttempts: Math.max(0, ch.maxAttempts - ch.failedAttempts),
    active: isChallengeActive(ch, now),
    expiresAt: ch.expiresAt,
  };
}

/** 重新寄送：作廢舊挑戰、建立新挑戰（舊 OTP 立即失效），沿用 5 分鐘冷卻。 */
export async function resendAppAccountLinkChallenge(state: string, now: Date = new Date()): Promise<{ kind: "sent"; state: string } | { kind: "cooldown" } | { kind: "invalid" }> {
  const ch = await loadAppChallenge(state);
  if (!ch || ch.consumedAt) return { kind: "invalid" };
  const target = await db.getUserById(ch.targetUserId);
  if (!isTrustedTarget(target) || target.primaryEmail !== ch.targetEmail) return { kind: "invalid" };
  const latest = await db.getLatestAccountLinkChallengeForTarget(target.id);
  if (latest && latest.createdAt.getTime() > now.getTime() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) return { kind: "cooldown" };
  const next = await issueAppChallenge(target, ch.provider as LinkableProvider, ch.providerAccountId, ch.displayName, now);
  return { kind: "sent", state: await signAppState(next.challengeId, next.expiresAt) };
}

/** 取消：作廢挑戰，不修改任何帳號。 */
export async function cancelAppAccountLinkChallenge(state: string, now: Date = new Date()): Promise<void> {
  const ch = await loadAppChallenge(state);
  if (ch) await db.invalidateAccountLinkChallenge(ch.id, now);
}

function inactiveReason(ch: AccountLinkChallenge, now: Date): CompleteAccountLinkResult {
  if (ch.failedAttempts >= ch.maxAttempts) return { ok: false, reason: "exhausted", message: ACCOUNT_LINK_OTP_EXHAUSTED_MESSAGE, remainingAttempts: 0 };
  if (!ch.consumedAt && !ch.invalidatedAt && ch.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", message: ACCOUNT_LINK_OTP_EXPIRED_MESSAGE };
  }
  return FAIL_INVALID;
}

/**
 * App 完成連結：
 *   1. state 簽章有效 → challengeId → 挑戰存在、channel／provider 正確
 *   2. 挑戰仍有效（未使用、未作廢、未過期、錯誤未滿 5 次）
 *   3. HMAC 比對（timing-safe）
 *      - 錯誤：DB 原子性累加 failedAttempts，第 5 次錯誤後挑戰作廢
 *      - 正確：DB 原子性消耗挑戰（同樣要求錯誤未滿上限）
 *   4. finalizeProviderLink（與 Web 共用）
 */
export async function verifyAppAccountLinkChallenge(state: string, code: string, now: Date = new Date()): Promise<CompleteAccountLinkResult> {
  const ch = await loadAppChallenge(state);
  if (!ch) return FAIL_INVALID;
  if (!isChallengeActive(ch, now)) return inactiveReason(ch, now);

  const normalized = code.trim();
  const expected = Buffer.from(ch.secretHash, "hex");
  const actual = Buffer.from(hashAccountLinkOtp(ch, /^\d{6}$/.test(normalized) ? normalized : "invalid"), "hex");
  const matches = /^\d{6}$/.test(normalized) && expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    const recorded = await db.recordAccountLinkChallengeFailure(ch.id, now);
    if (!recorded) {
      const fresh = await db.getAccountLinkChallenge(ch.challengeId);
      return fresh ? inactiveReason(fresh, now) : FAIL_INVALID;
    }
    const remaining = Math.max(0, recorded.maxAttempts - recorded.failedAttempts);
    if (remaining === 0) return { ok: false, reason: "exhausted", message: ACCOUNT_LINK_OTP_EXHAUSTED_MESSAGE, remainingAttempts: 0 };
    return { ok: false, reason: "wrong", message: ACCOUNT_LINK_OTP_WRONG_MESSAGE, remainingAttempts: remaining };
  }

  if (!(await db.consumeAccountLinkChallenge(ch.id, now))) {
    const fresh = await db.getAccountLinkChallenge(ch.challengeId);
    return fresh ? inactiveReason(fresh, now) : FAIL_INVALID;
  }
  return finalizeProviderLink({
    targetUserId: ch.targetUserId,
    expectedEmail: ch.targetEmail,
    provider: ch.provider,
    providerAccountId: ch.providerAccountId,
    displayName: ch.displayName,
  });
}
