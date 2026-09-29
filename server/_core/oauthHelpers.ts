import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import * as db from "../db";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";

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

async function setSessionCookieForUser(
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

/**
 * Issue a session cookie (web flow) or an app ticket (app flow) for the resolved user.
 */
export async function issueSessionOrTicket(
  req: Request,
  res: Response,
  openId: string,
  name: string,
  source: string | null | undefined,
  getClientIp: (req: Request) => string
): Promise<void> {
  if (source === "app") {
    const user = await db.getUserByOpenId(openId);
    if (!user) throw new Error("User not found for ticket issuance");
    const ticket = randomBytes(32).toString("hex");
    await db.createAppLoginTicket({
      ticket,
      userId: user.id,
      userAgent: req.headers["user-agent"],
      ip: getClientIp(req),
    });
    res.redirect(302, `oxm://oauth/callback?ticket=${ticket}`);
  } else {
    await setSessionCookieForUser(req, res, openId, name);
  }
}
