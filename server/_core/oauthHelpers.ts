import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import * as db from "../db";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import { APP_LOGIN_CHALLENGE_RE, APP_LOGIN_VERIFIER_RE } from "@shared/appLoginPkce";

export type OAuthUserInfo = {
  provider: "google" | "apple" | "line";
  providerAccountId: string;
  providerEmail: string | null;
  providerEmailVerified: boolean;
  displayName: string | null;
};

export function isApplePrivateRelayEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith("@privaterelay.appleid.com");
}

/**
 * Google userinfo（oauth2/v2/userinfo）的 email 驗證訊號：只有
 * `verified_email === true` 才算已驗證。欄位缺失、false、字串 "true" 等一律
 * 視為未驗證——不可因為 provider 沒回傳就預設為 true。未驗證的 email 不能
 * 當作可信 primaryEmail、不能觸發 email 帳號合併、也不能參與 admin 白名單。
 */
export function isGoogleEmailVerified(userInfo: { verified_email?: unknown } | null | undefined): boolean {
  return userInfo?.verified_email === true;
}

/**
 * LINE Login v2.1 的 email（/oauth2/v2.1/verify 回傳的 ID token `email`
 * claim）：LINE 官方文件沒有提供 email_verified 之類可供 OXM 驗證的訊號，
 * 因此一律視為「未驗證」的非可信 metadata——不能觸發 email 帳號合併、不能
 * 成為可信 primaryEmail、不能參與 admin 白名單。LINE 使用者身分只以 LINE
 * provider user ID（sub）識別。未來 LINE 若提供官方可驗證的訊號，再改這裡。
 */
export function isLineEmailVerified(_claims?: unknown): false {
  return false;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export async function setSessionCookieForUser(
  req: Request,
  res: Response,
  openId: string,
  userName: string
): Promise<void> {
  const sessionToken = await sdk.createSessionToken(openId, {
    name: userName,
    expiresInMs: THIRTY_DAYS_MS,
  });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });
}

/**
 * Shared OAuth login handler for all providers.
 * Resolves or creates a user, writes userAuthAccounts, handles primaryEmail rules.
 * Returns the resolved user's openId + name for session creation.
 */
export async function handleOAuthCallback(
  info: OAuthUserInfo
): Promise<{ openId: string; name: string }> {
  const { provider, providerAccountId, providerEmail, providerEmailVerified, displayName } = info;

  // 1. Existing linked account?
  const existingUser = await db.getUserByAuthAccount(provider, providerAccountId);
  if (existingUser) {
    // Update display name only if provider supplied one (Apple may not on repeat logins)
    if (displayName) {
      await db.upsertUser({
        openId: existingUser.openId,
        lastSignedIn: new Date(),
      });
    } else {
      await db.upsertUser({ openId: existingUser.openId, lastSignedIn: new Date() });
    }
    // Keep providerEmail up to date
    await db.upsertUserAuthAccount({
      userId: existingUser.id,
      provider,
      providerAccountId,
      providerEmail,
      providerEmailVerified,
      displayName: displayName ?? existingUser.name ?? null,
    });
    return { openId: existingUser.openId, name: existingUser.name ?? "" };
  }

  // 2. Conservative auto-merge: all 4 conditions must hold
  // LINE 的 email 沒有可信的驗證訊號（見 isLineEmailVerified）：不論呼叫端
  // 傳入什麼，都不得依 email 自動合併到既有帳號（縱深防禦）。
  const canMerge =
    provider !== "line" &&
    providerEmail !== null &&
    !isApplePrivateRelayEmail(providerEmail) &&
    providerEmailVerified;

  if (canMerge && providerEmail) {
    const matchedUser = await db.getUserByPrimaryEmail(providerEmail);
    if (matchedUser) {
      // Link this new provider to the existing user
      await db.upsertUserAuthAccount({
        userId: matchedUser.id,
        provider,
        providerAccountId,
        providerEmail,
        providerEmailVerified,
        displayName: displayName ?? matchedUser.name ?? null,
      });
      await db.upsertUser({ openId: matchedUser.openId, lastSignedIn: new Date() });
      return { openId: matchedUser.openId, name: matchedUser.name ?? "" };
    }
  }

  // 3. Create new user
  const openId = `${provider}_${providerAccountId}`;
  const name = displayName ?? null;
  // users.email 會參與 admin email 白名單判斷（server/_core/admin.ts、
  // db.upsertUser），所以只寫入「已驗證」的 Google email。
  const loginEmail = provider === "google" && providerEmailVerified && !isApplePrivateRelayEmail(providerEmail)
    ? providerEmail
    : null;

  await db.upsertUser({
    openId,
    name,
    email: loginEmail,
    loginMethod: provider,
    lastSignedIn: new Date(),
  });

  const newUser = await db.getUserByOpenId(openId);
  if (!newUser) throw new Error("User not found after upsert");

  await db.upsertUserAuthAccount({
    userId: newUser.id,
    provider,
    providerAccountId,
    providerEmail,
    providerEmailVerified,
    displayName: name,
  });

  // 4. Set primaryEmail per provider rules
  await applyPrimaryEmailRules(newUser.id, provider, providerEmail, providerEmailVerified);

  return { openId, name: name ?? "" };
}

async function applyPrimaryEmailRules(
  userId: number,
  provider: "google" | "apple" | "line",
  providerEmail: string | null,
  providerEmailVerified: boolean
): Promise<void> {
  if (!providerEmail) return;

  if (provider === "google") {
    // 只有 Google 明確回傳 verified_email === true 才設為可信 primaryEmail
    // （見 isGoogleEmailVerified）。
    if (providerEmailVerified) {
      await db.setPrimaryEmailVerified(userId, providerEmail);
    }
    return;
  }

  if (provider === "apple") {
    // Private relay: don't set primaryEmail
    if (isApplePrivateRelayEmail(providerEmail)) return;
    // Real email, verified by Apple
    if (providerEmailVerified) {
      await db.setPrimaryEmailVerified(userId, providerEmail);
    }
    return;
  }

  if (provider === "line") {
    // LINE: never auto-set primaryEmail; only store as providerEmail (suggestion only)
    return;
  }
}

// ── OAuth state 綁定與 App 登入票券（Production Hardening Batch 3.7）──────────

export const OAUTH_STATE_COOKIE = "oauth_state";

/** 原始 Cookie header 中名稱為 name 的所有值（同名 cookie 可能因 path 不同而並存）。 */
export function readCookieValues(cookieHeader: string | undefined, name: string): string[] {
  if (!cookieHeader) return [];
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try { out.push(decodeURIComponent(raw)); } catch { out.push(raw); }
  }
  return out;
}

/**
 * OAuth callback 的 state 必須同時：(1) 存在 DB 且未使用未過期（consumeOauthState），
 * (2) 等於「這個瀏覽器」在發起登入時拿到的 oauth_state cookie。少了 (2)，攻擊者
 * 可以用自己帳號發起登入、把 callback 網址丟給受害者，讓受害者的瀏覽器登入成
 * 攻擊者的帳號（login CSRF）。
 */
export function isOAuthStateBoundToBrowser(req: Request, stateParam: string): boolean {
  const expected = Buffer.from(stateParam);
  return readCookieValues(req.headers.cookie, OAUTH_STATE_COOKIE).some(v => {
    const actual = Buffer.from(v);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

/** initOAuthState 產生的 state 格式：`<64 hex>`（Web）或 `<64 hex>.<challenge>`（App）。 */
const OAUTH_STATE_RE = /^[0-9a-f]{64}(?:\.[A-Za-z0-9_-]{43})?$/;

export type OAuthStateRejectReason =
  | "malformed" | "cookie_missing" | "cookie_mismatch"
  | "not_found" | "consumed" | "expired" | "provider_mismatch" | "purpose_mismatch" | "lookup_failed";

export type OAuthStateBinding =
  | { ok: true; mode: "browser_cookie" | "app_pkce"; appChallenge: string | null }
  | { ok: false; reason: OAuthStateRejectReason };

/**
 * callback 的 state 綁定檢查（DB 消耗之前）：
 *   - browser_cookie：state 等於這個瀏覽器的 oauth_state cookie（Web 與一般 App 流程）。
 *   - app_pkce：cookie 不在，但 state 帶有 App 登入 challenge。iOS 選「使用 LINE
 *     應用程式進行登入」時，LINE App 授權後在「另一個」瀏覽器環境（Safari）開啟
 *     callback，App 內 SFSafariViewController 的 cookie 不會跟過去。這種 state 只能
 *     以 source=app 消耗，簽出的票券（與帳號連結 state）綁定同一個 challenge，必須由
 *     持有 verifier 的那台 App 才能兌換——偷渡 callback 網址給別人的瀏覽器拿不到
 *     session（取代 cookie 的 login CSRF 防護）。
 * 不帶 challenge 的 state 仍然必須有相符的 cookie。
 */
export function resolveOAuthStateBinding(req: Request, stateParam: string): OAuthStateBinding {
  if (!OAUTH_STATE_RE.test(stateParam)) return { ok: false, reason: "malformed" };
  const appChallenge = appLoginChallengeFromState(stateParam);
  if (isOAuthStateBoundToBrowser(req, stateParam)) return { ok: true, mode: "browser_cookie", appChallenge };
  if (appChallenge) return { ok: true, mode: "app_pkce", appChallenge };
  return { ok: false, reason: readCookieValues(req.headers.cookie, OAUTH_STATE_COOKIE).length > 0 ? "cookie_mismatch" : "cookie_missing" };
}

/** App 登入：state 格式為 `<64 hex>.<challenge>`；其他情況回傳 null。 */
export function appLoginChallengeFromState(state: string): string | null {
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const challenge = state.slice(dot + 1);
  return APP_LOGIN_CHALLENGE_RE.test(challenge) ? challenge : null;
}

export function appLoginChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * 票券格式：`<64 hex>` 或 `<64 hex>.<challenge>`。DB 只存 SHA-256（不存原文）；
 * challenge 是票券的一部分，竄改 challenge 會讓雜湊查不到。
 */
export function parseAppLoginTicket(ticket: string): { ticketHash: string; challenge: string | null } | null {
  const m = /^([0-9a-f]{64})(?:\.([A-Za-z0-9_-]{43}))?$/.exec(ticket);
  if (!m) return null;
  return { ticketHash: sha256Hex(ticket), challenge: m[2] ?? null };
}

/** 票券帶 challenge 時，verifier 必須存在且雜湊相符（常數時間比較）。 */
export function isAppLoginVerifierValid(challenge: string | null, verifier: unknown): boolean {
  if (challenge == null) return true;
  if (typeof verifier !== "string" || !APP_LOGIN_VERIFIER_RE.test(verifier)) return false;
  const a = Buffer.from(appLoginChallengeFromVerifier(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Issue a session cookie (web flow) or an app ticket (app flow) for the resolved user.
 * App 流程的票券帶上 OAuth state 裡的 challenge（見 shared/appLoginPkce.ts）。
 */
export async function issueSessionOrTicket(
  req: Request,
  res: Response,
  openId: string,
  name: string,
  source: string | null | undefined,
  getClientIp: (req: Request) => string,
  appLoginChallenge: string | null = null,
): Promise<void> {
  if (source === "app") {
    const user = await db.getUserByOpenId(openId);
    if (!user) throw new Error("User not found for ticket issuance");
    const ticket = appLoginChallenge ? `${randomBytes(32).toString("hex")}.${appLoginChallenge}` : randomBytes(32).toString("hex");
    await db.createAppLoginTicket({
      ticketHash: sha256Hex(ticket),
      userId: user.id,
      userAgent: req.headers["user-agent"],
      ip: getClientIp(req),
    });
    res.redirect(302, `oxm://oauth/callback?ticket=${encodeURIComponent(ticket)}`);
  } else {
    await setSessionCookieForUser(req, res, openId, name);
  }
}
