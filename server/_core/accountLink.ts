/**
 * Verified Account Linking（Production Hardening Batch 2.7）。
 *
 * 情境：新的 provider identity（本輪只開 LINE）第一次登入，provider 回傳的
 * email 剛好等於某個既有 OXM 帳號「已驗證」的 primaryEmail。email 字串相同
 * 不能證明是同一個人（LINE 沒有可驗證的 email_verified），所以不自動合併；
 * 改成：寄驗證信到既有帳號的可信 primaryEmail → 使用者在「同一個瀏覽器」
 * 點連結證明控制該信箱 → 才把 provider identity 綁到既有帳號。全程不建立
 * 第二個 OXM user。
 *
 * Pending link 狀態（不需要 migration）：
 *   - 伺服器端：emailVerificationTokens 一列（userId＝目標帳號、email＝目標
 *     帳號當下的 primaryEmail、只存 SHA-256 hash、expiresAt、usedAt 單次使用），
 *     沿用既有 magic link 驗證機制。
 *   - 瀏覽器端：HttpOnly cookie，內容是以 JWT_SECRET 簽章的 JWT（跟 session
 *     同一把 key），記錄 provider、provider subject、目標 user、token hash——
 *     把這次 pending link 綁在發起 OAuth 的瀏覽器上，前端無法竄改目標帳號或
 *     provider identity，也不能指定寄件 email。
 *   完成連結需要「cookie（同一瀏覽器）＋ email 裡的 token（控制信箱）」兩者。
 */
import type { Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { sendAccountLinkVerificationEmail } from "../email";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
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

export type LinkableProvider = "line";
export const ACCOUNT_LINK_PROVIDER_LABEL: Record<LinkableProvider, string> = { line: "LINE" };

type PendingAccountLinkPayload = {
  typ: "pending_account_link";
  tuid: number;
  prov: LinkableProvider;
  sub: string;
  th: string;
  dn: string | null;
};

function secretKey() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

/** a***@example.com：只保留第一個字元與網域。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
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
  if (!target || target.deletedAt || !target.primaryEmail || !target.primaryEmailVerifiedAt) return null;
  return target;
}

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

async function issueTokenAndEmail(target: User, provider: LinkableProvider): Promise<{ tokenHash: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS);
  // 寄件目標一律從目標帳號重新讀取的可信 primaryEmail，不是 provider 回傳的 email。
  const toEmail = target.primaryEmail!;
  await db.createEmailVerificationToken({ userId: target.id, tokenHash, email: toEmail, expiresAt });
  await sendAccountLinkVerificationEmail({
    toEmail,
    userName: target.name,
    providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[provider],
    verifyUrl: `${emailVerificationBaseUrl()}/account-link/verify?token=${rawToken}`,
    expiresInHours: EMAIL_VERIFICATION_TOKEN_TTL_MS / 3_600_000,
  });
  return { tokenHash, expiresAt };
}

/**
 * OAuth callback 偵測到 email 撞到可信既有帳號時呼叫：建立（或在寄信冷卻
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
    ({ tokenHash, expiresAt } = await issueTokenAndEmail(target, provider));
    emailSent = true;
  }
  await setPendingCookie(req, res, { typ: "pending_account_link", tuid: target.id, prov: provider, sub: providerAccountId, th: tokenHash, dn: displayName }, expiresAt);
  return { emailSent };
}

/**
 * LINE callback 取得 provider subject（及可能的 email）之後的決策，獨立成
 * 函式方便測試：
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

/** 目前瀏覽器的 pending link 摘要（只給遮罩後 email），沒有 pending 時回 null。 */
export async function describePendingAccountLink(req: Request): Promise<{ provider: LinkableProvider; providerLabel: string; maskedEmail: string } | null> {
  const pending = await readPendingAccountLink(req);
  if (!pending) return null;
  const target = await db.getUserById(pending.tuid);
  if (!target || target.deletedAt || !target.primaryEmail || !target.primaryEmailVerifiedAt) return null;
  return { provider: pending.prov, providerLabel: ACCOUNT_LINK_PROVIDER_LABEL[pending.prov], maskedEmail: maskEmail(target.primaryEmail) };
}

/** 重新寄送：目標與 email 一律由 pending cookie＋資料庫決定，沿用既有寄信冷卻時間。 */
export async function resendPendingAccountLink(req: Request, res: Response): Promise<"sent" | "cooldown" | "invalid"> {
  const pending = await readPendingAccountLink(req);
  if (!pending) return "invalid";
  const target = await db.getUserById(pending.tuid);
  if (!target || target.deletedAt || !target.primaryEmail || !target.primaryEmailVerifiedAt) return "invalid";
  const recent = await db.getLatestEmailVerificationToken(target.id, target.primaryEmail);
  if (recent && recent.createdAt.getTime() > Date.now() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) return "cooldown";
  const { tokenHash, expiresAt } = await issueTokenAndEmail(target, pending.prov);
  await setPendingCookie(req, res, { ...pending, th: tokenHash }, expiresAt);
  return "sent";
}

/** 取消：作廢這次 pending 的 token（單次使用機制）並清除 cookie，不修改任何帳號。 */
export async function cancelPendingAccountLink(req: Request, res: Response): Promise<void> {
  const pending = await readPendingAccountLink(req);
  if (pending) await db.consumeEmailVerificationToken(pending.th);
  clearPendingAccountLinkCookie(req, res);
}

export type CompleteAccountLinkResult =
  | { ok: true; user: User }
  | { ok: false; message: string };

/**
 * 完成連結。依序重新檢查（全部由伺服器端狀態決定，不信任任何前端傳入的
 * user／email）：
 *   1. 這個瀏覽器有有效的 pending cookie（session binding、未過期、簽章正確）
 *   2. email 裡的 token 正是這次 pending 綁定的那一個（hash 相同）
 *   3. token 原子性地「未使用 → 已使用」（單次使用、防重放、防併發）且未過期
 *   4. token 屬於 pending 的目標帳號
 *   5. 目標帳號仍存在、未刪除、primaryEmail 仍是當初寄信的已驗證信箱
 *   6. provider 是允許的 provider（本輪只有 line）
 *   7. 這個 provider identity 尚未屬於任何帳號、目標帳號也還沒有同類 identity
 *   8. INSERT 綁定（唯一索引保證併發下只會有一個帳號成功）
 */
export async function completePendingAccountLink(req: Request, res: Response, rawToken: string): Promise<CompleteAccountLinkResult> {
  const fail = { ok: false as const, message: ACCOUNT_LINK_FAILED_MESSAGE };
  const pending = await readPendingAccountLink(req);
  if (!pending) return fail;
  const tokenHash = sha256Hex(rawToken);
  if (tokenHash !== pending.th) return fail;

  const consumed = await db.consumeEmailVerificationToken(tokenHash);
  if (!consumed.valid || consumed.userId !== pending.tuid) return fail;

  const target = await db.getUserById(pending.tuid);
  if (!target || target.deletedAt || !target.primaryEmailVerifiedAt || !target.primaryEmail || target.primaryEmail !== consumed.email) {
    clearPendingAccountLinkCookie(req, res);
    return fail;
  }
  if (pending.prov !== "line") return fail;

  const existingOwner = await db.getUserByAuthAccount(pending.prov, pending.sub);
  if (existingOwner && existingOwner.id !== target.id) {
    clearPendingAccountLinkCookie(req, res);
    return { ok: false, message: ACCOUNT_LINK_PROVIDER_TAKEN_MESSAGE };
  }
  if (!existingOwner) {
    const sameTypeIdentity = await db.getAuthAccountByProviderForUser(target.id, pending.prov);
    if (sameTypeIdentity) {
      clearPendingAccountLinkCookie(req, res);
      return { ok: false, message: ACCOUNT_LINK_TARGET_HAS_PROVIDER_MESSAGE };
    }
    const linked = await db.linkProviderIdentityToUser({
      userId: target.id,
      provider: pending.prov,
      providerAccountId: pending.sub,
      displayName: pending.dn,
    });
    if (linked === "taken") {
      clearPendingAccountLinkCookie(req, res);
      return { ok: false, message: ACCOUNT_LINK_PROVIDER_TAKEN_MESSAGE };
    }
  }
  clearPendingAccountLinkCookie(req, res);
  return { ok: true, user: target };
}
