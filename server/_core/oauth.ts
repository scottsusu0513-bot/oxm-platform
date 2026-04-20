import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
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

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/google", (req: Request, res: Response) => {
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/callback`;
    const nonce = randomBytes(16).toString("hex");
    const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString("base64url");

    // 把 nonce 存進 httpOnly cookie，callback 時驗證
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000, // 10 分鐘內完成登入
    });

    const params = new URLSearchParams({
      client_id: ENV.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    // 驗證 state nonce，防止 CSRF
    try {
      const { nonce } = JSON.parse(Buffer.from(stateParam ?? "", "base64url").toString());
      const cookieNonce = getCookieValue(req, OAUTH_STATE_COOKIE);
      if (!cookieNonce || cookieNonce !== nonce) {
        res.status(400).json({ error: "Invalid OAuth state" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE);

    try {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/callback`;

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
