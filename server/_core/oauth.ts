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

export function registerOAuthRoutes(app: Express) {
  // ── 1. Initiate Google OAuth ─────────────────────────────────────────────
  app.get("/api/oauth/google", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const source = getQueryParam(req, "source") ?? "web"; // "app" | "web"
    const baseUrl = process.env.OAUTH_SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/oauth/callback`;

    const state = randomBytes(32).toString("hex");

    console.log("[OAuth/init] NODE_ENV:", process.env.NODE_ENV);
    console.log("[OAuth/init] source:", source);
    console.log("[OAuth/init] protocol:", req.protocol);
    console.log("[OAuth/init] hostname:", req.hostname);
    console.log("[OAuth/init] host header:", req.headers.host);
    console.log("[OAuth/init] origin:", req.headers.origin);
    console.log("[OAuth/init] cookie header present:", !!req.headers.cookie);
    console.log("[OAuth/init] state (first 8):", state.slice(0, 8));

    try {
      await db.createOauthState({
        state,
        redirectTo: "/",
        source,
        userAgent: req.headers["user-agent"],
        ip: getClientIp(req),
      });
      db.purgeExpiredOauthStates().catch(() => {});
    } catch (err) {
      console.error("[OAuth/init] Failed to write state to DB:", err);
      res.status(500).json({ error: "OAuth init failed" });
      return;
    }

    // Web fallback cookie（APP 不依賴此）
    const { maxAge: _omit, ...clearOpts } = getStateCookieOptions(isProd);
    void clearOpts;
    res.cookie(OAUTH_STATE_COOKIE, state, getStateCookieOptions(isProd));

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

  // ── 2. Google OAuth Callback ─────────────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    console.log("[OAuth/callback] protocol:", req.protocol);
    console.log("[OAuth/callback] hostname:", req.hostname);
    console.log("[OAuth/callback] cookie header present:", !!req.headers.cookie);
    console.log("[OAuth/callback] state present:", !!stateParam);
    console.log("[OAuth/callback] state (first 8):", stateParam?.slice(0, 8));
    console.log("[OAuth/callback] code present:", !!code);

    if (!code || !stateParam) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // Validate state via DB
    let dbResult: { valid: boolean; redirectTo?: string | null; source?: string | null };
    try {
      dbResult = await db.consumeOauthState(stateParam);
      console.log("[OAuth/callback] DB state valid:", dbResult.valid, "source:", dbResult.source);
    } catch (err) {
      console.error("[OAuth/callback] DB state lookup failed:", err);
      dbResult = { valid: false };
    }

    if (!dbResult.valid) {
      console.warn("[OAuth/callback] INVALID STATE");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    // Clear web fallback cookie
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

      // ── APP flow: issue one-time ticket, deep link back to APP ──────────
      if (dbResult.source === "app") {
        const dbUser = await db.getUserByOpenId(openId);
        if (!dbUser) {
          res.status(500).json({ error: "User not found after upsert" });
          return;
        }
        const ticket = randomBytes(32).toString("hex");
        console.log("[OAuth/callback] APP flow — creating ticket (first 8):", ticket.slice(0, 8));
        await db.createAppLoginTicket({
          ticket,
          userId: dbUser.id,
          userAgent: req.headers["user-agent"],
          ip: getClientIp(req),
        });
        res.redirect(302, `oxm://oauth/callback?ticket=${ticket}`);
        return;
      }

      // ── Web flow: set cookie, redirect to site ───────────────────────────
      await setSessionCookieForUser(req, res, openId, userInfo.name || "");
      res.redirect(302, dbResult.redirectTo || "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // ── 3. APP login completion (called by APP WebView after deep link) ──────
  app.post("/api/oauth/app-complete", async (req: Request, res: Response) => {
    const { ticket } = req.body ?? {};

    console.log("[OAuth/app-complete] ticket present:", !!ticket);
    console.log("[OAuth/app-complete] ticket (first 8):", typeof ticket === "string" ? ticket.slice(0, 8) : "(invalid)");

    if (!ticket || typeof ticket !== "string") {
      res.status(400).json({ error: "ticket is required" });
      return;
    }

    try {
      const result = await db.consumeAppLoginTicket(ticket);
      console.log("[OAuth/app-complete] ticket valid:", result.valid);

      if (!result.valid || !result.userId) {
        res.status(400).json({ error: "Invalid or expired ticket" });
        return;
      }

      // Find user openId to create session
      const user = await db.getUserById(result.userId);
      if (!user) {
        res.status(400).json({ error: "User not found" });
        return;
      }

      await setSessionCookieForUser(req, res, user.openId, user.name || "");
      console.log("[OAuth/app-complete] session cookie set for userId:", result.userId);
      res.json({ success: true });
    } catch (error) {
      console.error("[OAuth/app-complete] Failed:", error);
      res.status(500).json({ error: "App login completion failed" });
    }
  });
}
