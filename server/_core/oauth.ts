import type { CookieOptions, Express, Request, Response } from "express";
import * as db from "../db";
import { ENV } from "./env";
import { randomBytes } from "crypto";
import { handleOAuthCallback, issueSessionOrTicket } from "./oauthHelpers";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Cached Apple JWKS (fetched lazily on first Apple login)
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

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

async function initOAuthState(
  req: Request,
  res: Response,
  provider: string
): Promise<string | null> {
  const isProd = process.env.NODE_ENV === "production";
  const source = getQueryParam(req, "source") ?? "web";
  const state = randomBytes(32).toString("hex");

  try {
    await db.createOauthState({
      state,
      redirectTo: "/",
      source,
      provider,
      userAgent: req.headers["user-agent"],
      ip: getClientIp(req),
    });
    db.purgeExpiredOauthStates().catch(() => {});
  } catch (err) {
    console.error("[OAuth] Initialization failed", {
      provider,
      source,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "OAuth initialization failed" });
    return null;
  }

  res.cookie(OAUTH_STATE_COOKIE, state, getStateCookieOptions(isProd));
  return state;
}

export function registerOAuthRoutes(app: Express) {
  // ── Google: Initiate ────────────────────────────────────────────────────────
  app.get("/api/oauth/google", async (req: Request, res: Response) => {
    const state = await initOAuthState(req, res, "google");
    if (!state) return;

    const baseUrl = process.env.OAUTH_SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/oauth/callback`;

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

  // ── Google: Callback ────────────────────────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    if (!code || !stateParam) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    let dbResult: { valid: boolean; redirectTo?: string | null; source?: string | null; provider?: string | null };
    try {
      dbResult = await db.consumeOauthState(stateParam);
    } catch (err) {
      console.error("[OAuth/google/callback] DB state lookup failed:", err);
      dbResult = { valid: false };
    }

    if (!dbResult.valid) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    const { maxAge: _omit, ...clearOpts } = getStateCookieOptions(isProd);
    void _omit;
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

      const { openId, name } = await handleOAuthCallback({
        provider: "google",
        providerAccountId: userInfo.id,
        providerEmail: userInfo.email ?? null,
        providerEmailVerified: true, // Google always verifies email
        displayName: userInfo.name ?? null,
      });

      await issueSessionOrTicket(req, res, openId, name, dbResult.source, getClientIp);

      if (dbResult.source !== "app") {
        res.redirect(302, dbResult.redirectTo || "/");
      }
    } catch (error) {
      console.error("[OAuth/google/callback] Failed:", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // ── LINE: Initiate ──────────────────────────────────────────────────────────
  app.get("/api/oauth/line", async (req: Request, res: Response) => {
    const state = await initOAuthState(req, res, "line");
    if (!state) return;

    res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: ENV.lineChannelId,
      redirect_uri: ENV.lineRedirectUri,
      scope: "profile openid email",
      state,
    }).toString()}`);
  });

  // ── LINE: Callback ──────────────────────────────────────────────────────────
  app.get("/api/oauth/line/callback", async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    const code = getQueryParam(req, "code");
    const stateParam = getQueryParam(req, "state");

    if (!code || !stateParam) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    let dbResult: { valid: boolean; redirectTo?: string | null; source?: string | null; provider?: string | null };
    try {
      dbResult = await db.consumeOauthState(stateParam);
    } catch {
      dbResult = { valid: false };
    }

    if (!dbResult.valid) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    const { maxAge: _omit2, ...clearOpts2 } = getStateCookieOptions(isProd);
    void _omit2;
    res.clearCookie(OAUTH_STATE_COOKIE, clearOpts2);

    try {
      // Exchange code for token
      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ENV.lineRedirectUri,
          client_id: ENV.lineChannelId,
          client_secret: ENV.lineChannelSecret,
        }),
      });

      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) {
        res.status(400).json({ error: "Failed to get LINE access token" });
        return;
      }

      // Verify id_token via LINE API to get user claims
      let lineUserId: string | null = null;
      let lineEmail: string | null = null;
      let lineName: string | null = null;

      if (tokenData.id_token) {
        const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            id_token: tokenData.id_token,
            client_id: ENV.lineChannelId,
          }),
        });
        if (verifyRes.ok) {
          const claims = await verifyRes.json() as any;
          lineUserId = claims.sub ?? null;
          lineEmail = claims.email ?? null;
          lineName = claims.name ?? null;
        }
      }

      // Fallback: fetch profile if id_token verify failed or had no sub
      if (!lineUserId) {
        const profileRes = await fetch("https://api.line.me/v2/profile", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json() as any;
          lineUserId = profile.userId ?? null;
          lineName = lineName ?? profile.displayName ?? null;
        }
      }

      if (!lineUserId) {
        res.status(400).json({ error: "Failed to get LINE user ID" });
        return;
      }

      const { openId, name } = await handleOAuthCallback({
        provider: "line",
        providerAccountId: lineUserId,
        providerEmail: lineEmail,
        // LINE email from id_token verify is considered verified by LINE
        providerEmailVerified: lineEmail !== null,
        displayName: lineName,
      });

      await issueSessionOrTicket(req, res, openId, name, dbResult.source, getClientIp);

      if (dbResult.source !== "app") {
        res.redirect(302, dbResult.redirectTo || "/");
      }
    } catch (error) {
      console.error("[OAuth/line/callback] Failed:", error);
      res.status(500).json({ error: "LINE OAuth callback failed" });
    }
  });

  // ── Apple: Initiate ─────────────────────────────────────────────────────────
  app.get("/api/oauth/apple", async (req: Request, res: Response) => {
    if (!ENV.appleClientId || !ENV.appleTeamId || !ENV.appleKeyId || !ENV.applePrivateKey) {
      res.status(503).json({ error: "Apple 登入伺服器設定尚未完成，請稍後再試。" });
      return;
    }

    const state = await initOAuthState(req, res, "apple");
    if (!state) return;

    let clientSecret: string;
    try {
      clientSecret = await generateAppleClientSecret();
    } catch (err) {
      console.error("[OAuth/apple/init] Failed to generate client_secret:", err);
      res.status(500).json({ error: "Apple OAuth init failed" });
      return;
    }

    // Store clientSecret in state cookie for callback (short-lived, httpOnly)
    // Apple requires response_mode=form_post; state is embedded in form POST
    res.redirect(`https://appleid.apple.com/auth/authorize?${new URLSearchParams({
      client_id: ENV.appleClientId,
      redirect_uri: ENV.appleRedirectUri,
      response_type: "code",
      scope: "name email",
      response_mode: "form_post",
      state,
    }).toString()}`);
  });

  // ── Apple: Callback (POST, Apple sends form_post) ───────────────────────────
  app.post("/api/oauth/apple/callback", async (req: Request, res: Response) => {
    if (!ENV.appleClientId || !ENV.appleTeamId || !ENV.appleKeyId || !ENV.applePrivateKey) {
      res.status(503).json({ error: "Apple 登入伺服器設定尚未完成，請稍後再試。" });
      return;
    }

    const isProd = process.env.NODE_ENV === "production";
    const { code, state: stateParam, user: userJson } = req.body ?? {};

    if (!code || !stateParam) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    let dbResult: { valid: boolean; redirectTo?: string | null; source?: string | null; provider?: string | null };
    try {
      dbResult = await db.consumeOauthState(stateParam);
    } catch {
      dbResult = { valid: false };
    }

    if (!dbResult.valid) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    const { maxAge: _omit3, ...clearOpts3 } = getStateCookieOptions(isProd);
    void _omit3;
    res.clearCookie(OAUTH_STATE_COOKIE, clearOpts3);

    try {
      const clientSecret = await generateAppleClientSecret();

      const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ENV.appleClientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: ENV.appleRedirectUri,
        }),
      });

      const tokenData = await tokenRes.json() as any;
      if (!tokenData.id_token) {
        res.status(400).json({ error: "Failed to get Apple id_token" });
        return;
      }

      // Verify id_token signature against Apple JWKS (ES256)
      let idTokenPayload: Record<string, unknown>;
      try {
        const { payload } = await jwtVerify(tokenData.id_token, APPLE_JWKS, {
          issuer: "https://appleid.apple.com",
          audience: ENV.appleClientId,
        });
        idTokenPayload = payload as Record<string, unknown>;
      } catch (err) {
        console.error("[OAuth/apple/callback] id_token JWKS verification failed:", (err as Error).message);
        res.status(400).json({ error: "Apple id_token 驗證失敗，請稍後再試" });
        return;
      }
      const appleUserId: string = idTokenPayload.sub as string;
      const appleEmail: string | null = (idTokenPayload.email as string | undefined) ?? null;
      const appleEmailVerified: boolean = idTokenPayload.email_verified === true || idTokenPayload.email_verified === "true";
      const isPrivateRelay: boolean = idTokenPayload.is_private_email === true || idTokenPayload.is_private_email === "true";

      if (!appleUserId) {
        res.status(400).json({ error: "Failed to get Apple user ID" });
        return;
      }

      // Apple only sends name on first authorization (comes as JSON in form body)
      let displayName: string | null = null;
      if (userJson) {
        try {
          const parsedUser = typeof userJson === "string" ? JSON.parse(userJson) : userJson;
          const fn = parsedUser?.name?.firstName ?? "";
          const ln = parsedUser?.name?.lastName ?? "";
          displayName = [fn, ln].filter(Boolean).join(" ") || null;
        } catch {
          // ignore parse errors
        }
      }

      const { openId, name } = await handleOAuthCallback({
        provider: "apple",
        providerAccountId: appleUserId,
        // If private relay, still store it in providerEmail for record, but handleOAuthCallback won't set it as primaryEmail
        providerEmail: appleEmail,
        providerEmailVerified: appleEmailVerified && !isPrivateRelay,
        displayName,
      });

      await issueSessionOrTicket(req, res, openId, name, dbResult.source, getClientIp);

      if (dbResult.source !== "app") {
        res.redirect(302, dbResult.redirectTo || "/");
      }
    } catch (error) {
      console.error("[OAuth/apple/callback] Failed:", error);
      res.status(500).json({ error: "Apple OAuth callback failed" });
    }
  });

  // ── App login completion (unchanged) ────────────────────────────────────────
  app.post("/api/oauth/app-complete", async (req: Request, res: Response) => {
    const { ticket } = req.body ?? {};

    if (!ticket || typeof ticket !== "string") {
      res.status(400).json({ error: "ticket is required" });
      return;
    }

    try {
      const result = await db.consumeAppLoginTicket(ticket);
      if (!result.valid || !result.userId) {
        res.status(400).json({ error: "Invalid or expired ticket" });
        return;
      }

      const user = await db.getUserById(result.userId);
      if (!user) {
        res.status(400).json({ error: "User not found" });
        return;
      }

      const { COOKIE_NAME, THIRTY_DAYS_MS } = await import("@shared/const");
      const { getSessionCookieOptions } = await import("./cookies");
      const { sdk } = await import("./sdk");

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: THIRTY_DAYS_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[OAuth/app-complete] Failed:", error);
      res.status(500).json({ error: "App login completion failed" });
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function generateAppleClientSecret(): Promise<string> {
  const { SignJWT } = await import("jose");

  const privateKeyPem = ENV.applePrivateKey.replace(/\\n/g, "\n");
  const { createPrivateKey } = await import("crypto");
  const privateKey = createPrivateKey({ key: privateKeyPem, format: "pem" });

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: ENV.appleKeyId })
    .setIssuer(ENV.appleTeamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 180) // 180 days max
    .setAudience("https://appleid.apple.com")
    .setSubject(ENV.appleClientId)
    .sign(privateKey);
}
