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

function getCookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  const match = header.split(";").map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function getStateCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    // SameSite=None;Secure required for Android WebView:
    // Google→callback is a cross-site redirect; Lax cookies are dropped by
    // some WebView versions, making the server unable to read the nonce.
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  };
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/google", (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const baseUrl = process.env.OAUTH_SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/oauth/callback`;
    const nonce = randomBytes(16).toString("hex");
    const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString("base64url");

    const cookieOpts = getStateCookieOptions(isProd);
    console.log("[OAuth/init] NODE_ENV:", process.env.NODE_ENV);
    console.log("[OAuth/init] isProd:", isProd);
    console.log("[OAuth/init] protocol:", req.protocol);
    console.log("[OAuth/init] hostname:", req.hostname);
    console.log("[OAuth/init] host header:", req.headers.host);
    console.log("[OAuth/init] origin:", req.headers.origin);
    console.log("[OAuth/init] referer:", req.headers.referer);
    console.log("[OAuth/init] cookie header present:", !!req.headers.cookie);
    console.log("[OAuth/init] nonce (first 8):", nonce.slice(0, 8));
    console.log("[OAuth/init] redirectUri:", redirectUri);
    console.log("[OAuth/init] cookie options:", { sameSite: cookieOpts.sameSite, secure: cookieOpts.secure, path: cookieOpts.path });

    res.cookie(OAUTH_STATE_COOKIE, nonce, cookieOpts);
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
    console.log("[OAuth/callback] code present:", !!code);

    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    try {
      const { nonce } = JSON.parse(Buffer.from(stateParam ?? "", "base64url").toString());
      const cookieNonce = getCookieValue(req, OAUTH_STATE_COOKIE);
      console.log("[OAuth/callback] state nonce (first 8):", nonce?.slice(0, 8));
      console.log("[OAuth/callback] cookie nonce (first 8):", cookieNonce ? cookieNonce.slice(0, 8) : "(missing)");
      console.log("[OAuth/callback] nonce match:", nonce === cookieNonce);
      if (!cookieNonce || cookieNonce !== nonce) {
        console.warn("[OAuth/callback] INVALID STATE — cookie nonce missing or mismatch");
        res.status(400).json({ error: "Invalid OAuth state" });
        return;
      }
    } catch {
      console.warn("[OAuth/callback] INVALID STATE — failed to parse state param");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    // Clear with same options so browser actually removes the cookie
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
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
