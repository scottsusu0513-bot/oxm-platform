import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { CookieOptions, Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { randomBytes } from "crypto";

const OAUTH_STATE_COOKIE = "oauth_state";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getStateCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip ?? "";
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/google", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const baseUrl = process.env.OAUTH_SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/oauth/callback`;

    // 產生 state：64 hex chars（32 bytes）
    const state = randomBytes(32).toString("hex");

    console.log("[OAuth/init] NODE_ENV:", process.env.NODE_ENV);
    console.log("[OAuth/init] isProd:", isProd);
    console.log("[OAuth/init] protocol:", req.protocol);
    console.log("[OAuth/init] hostname:", req.hostname);
    console.log("[OAuth/init] host header:", req.headers.host);
    console.log("[OAuth/init] origin:", req.headers.origin);
    console.log("[OAuth/init] referer:", req.headers.referer);
    console.log("[OAuth/init] cookie header present:", !!req.headers.cookie);
    console.log("[OAuth/init] state (first 8):", state.slice(0, 8));
    console.log("[OAuth/init] redirectUri:", redirectUri);

    // 1. 寫入 DB（主要驗證機制）
    try {
      await db.createOauthState({
        state,
        redirectTo: "/",
        userAgent: req.headers["user-agent"],
        ip: getClientIp(req),
      });
      // 順手清理過期資料
      db.purgeExpiredOauthStates().catch(() => {});
    } catch (err) {
      console.error("[OAuth/init] Failed to write state to DB:", err);
      res.status(500).json({ error: "OAuth init failed" });
      return;
    }

    // 2. 同時設 cookie 作為 web fallback（不影響 APP 流程）
    const cookieOpts = getStateCookieOptions(isProd);
    console.log("[OAuth/init] cookie options:", { sameSite: cookieOpts.sameSite, secure: cookieOpts.secure, path: cookieOpts.path });
    res.cookie(OAUTH_STATE_COOKIE, state, cookieOpts);

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: ENV.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    }).toString()}`);
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    console.log("[OAuth/callback] protocol:", req.protocol);
    console.log("[OAuth/callback] hostname:", req.hostname);
    console.log("[OAuth/callback] host header:", req.headers.host);
    console.log("[OAuth/callback] origin:", req.headers.origin);
    console.log("[OAuth/callback] referer:", req.headers.referer);
    console.log("[OAuth/callback] cookie header present:", !!req.headers.cookie);
    console.log("[OAuth/callback] state param present:", !!stateParam);
    console.log("[OAuth/callback] state (first 8):", stateParam?.slice(0, 8));
    console.log("[OAuth/callback] code present:", !!code);

    if (!code || !stateParam) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // 主要驗證：DB lookup（cookie-free，相容 Android WebView）
    let dbResult: { valid: boolean; redirectTo?: string | null };
    try {
      dbResult = await db.consumeOauthState(stateParam);
      console.log("[OAuth/callback] DB state valid:", dbResult.valid);
    } catch (err) {
      console.error("[OAuth/callback] DB state lookup failed:", err);
      dbResult = { valid: false };
    }

    if (!dbResult.valid) {
      console.warn("[OAuth/callback] INVALID STATE — DB validation failed");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    // 清除 cookie（給 web 版用的，APP 不影響）
    const { maxAge: _omit, ...clearOpts } = getStateCookieOptions(isProd);
    res.clearCookie(OAUTH_STATE_COOKIE, clearOpts);

    try {
      const baseUrl = process.env.OAUTH_SERVER_URL || `${req.protocol}://${req.get("host")}`;
      const redirectUri = `${baseUrl}/api/oauth/callback`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json() as any;

      if (!tokenData.access_token) {
        console.error("[OAuth] Failed to get access token");
        res.status(400).json({ error: "Failed to get access token" });
        return;
      }

      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userInfo = await userRes.json() as any;

      if (!userInfo.id) {
        res.status(400).json({ error: "Failed to get user info" });
        return;
      }

      const openId = `google_${userInfo.id}`;

      await db.upsertUser({
        openId,
        name: userInfo.name || null,
        email: userInfo.email || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.name || "",
        expiresInMs: THIRTY_DAYS_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });
      res.redirect(302, dbResult.redirectTo || "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
