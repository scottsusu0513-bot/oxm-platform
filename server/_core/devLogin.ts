import type { Express, Request, Response } from "express";
import { randomBytes } from "crypto";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { isAdminUser } from "./admin";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";

/**
 * 本機開發專用管理員登入入口——只有在無法在 localhost 使用正式 OAuth（本專案
 * 目前 Google OAuth 的 redirect_uri 設定與本機環境不相容）時，讓開發者能以
 * 「真實後端 session + 既有 ctx.user／isAdminUser 權限邏輯」驗收後台功能，
 * 不是繞過權限檢查的後門。
 *
 * 安全設計：
 * - 只在 process.env.NODE_ENV === "development" 時才註冊這個路由；production
 *   build／runtime 下這個路由完全不存在（真正的 404，不是「存在但被擋」）。
 * - 沒有寫死的帳號／密碼／token：驗證用的 token 是每次啟動 process 時隨機
 *   產生（記憶體內，不寫入任何檔案／repo），只印在啟動當下的本機終端機。
 * - 額外防線：即使 NODE_ENV 誤設，也會再檢查 DATABASE_URL 是否為 localhost，
 *   不是 localhost 一律拒絕，避免任何情況下對正式資料庫寫入測試資料。
 * - 簽發 session 的方式與正式 OAuth 登入完全相同（sdk.createSessionToken +
 *   getSessionCookieOptions + COOKIE_NAME），之後每個請求的 ctx.user／
 *   isAdminUser／adminProcedure 都是既有邏輯，不做任何特例判斷。
 */

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function registerDevLoginRoutes(app: Express): void {
  // 只在 development 才註冊路由本身——production build 完全沒有這個路由，
  // 連「路由存在但回傳 403」都不會發生。
  if (process.env.NODE_ENV !== "development") return;

  const devLoginToken = randomBytes(24).toString("hex");
  const adminEmail = ENV.adminWhitelistEmails[0];

  console.log("[dev-login] enabled — development only, do not use in production");
  if (!adminEmail) {
    console.log("[dev-login] WARNING: ADMIN_WHITELIST_EMAILS is empty in .env — set it first so the dev-login user actually passes isAdminUser().");
  } else {
    console.log(`[dev-login] visit this URL in your browser to sign in as ${adminEmail}:`);
    console.log(`[dev-login]   http://localhost:${process.env.PORT ?? 3000}/api/dev-login?token=${devLoginToken}`);
  }

  app.get("/api/dev-login", async (req: Request, res: Response) => {
    // 防禦性重複檢查：就算未來這支檔案被以其他方式引用/註冊，同樣的閘門
    // 還是會擋下 production。
    if (process.env.NODE_ENV !== "development") {
      res.status(404).end();
      return;
    }

    const dbUrl = process.env.DATABASE_URL ?? "";
    if (!isLocalDatabaseUrl(dbUrl)) {
      res.status(403).json({ error: "Refusing to run dev-login against a non-local database" });
      return;
    }

    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (token !== devLoginToken) {
      res.status(401).json({ error: "Invalid or missing dev-login token" });
      return;
    }

    const emailParam = typeof req.query.email === "string" ? req.query.email.trim() : "";
    const targetEmail = emailParam || adminEmail;
    if (!targetEmail) {
      res.status(400).json({ error: "No email provided and ADMIN_WHITELIST_EMAILS is empty in .env" });
      return;
    }

    try {
      // openId 用固定前綴 + email 推導，同一個 email 每次都對應同一筆本機測試
      // 使用者，不會每次登入都新增一筆新帳號。
      const openId = `dev-local_${Buffer.from(targetEmail).toString("hex").slice(0, 48)}`;

      await db.upsertUser({
        openId,
        name: "本機測試管理員",
        email: targetEmail,
        loginMethod: "dev-local",
        lastSignedIn: new Date(),
      });

      const user = await db.getUserByOpenId(openId);
      if (!user) {
        res.status(500).json({ error: "Failed to create local dev user" });
        return;
      }

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name ?? "",
        expiresInMs: THIRTY_DAYS_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });

      const redirectTo = typeof req.query.redirect === "string" && req.query.redirect.startsWith("/")
        ? req.query.redirect
        : "/admin/announcements";

      console.log(`[dev-login] signed in as ${targetEmail} (isAdmin=${isAdminUser(user)}), redirecting to ${redirectTo}`);
      res.redirect(302, redirectTo);
    } catch (err) {
      console.error("[dev-login] failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "dev-login failed", detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
