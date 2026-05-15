export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  appleClientId: process.env.APPLE_CLIENT_ID ?? "",
  appleTeamId: process.env.APPLE_TEAM_ID ?? "",
  appleKeyId: process.env.APPLE_KEY_ID ?? "",
  applePrivateKey: process.env.APPLE_PRIVATE_KEY ?? "",
  appleRedirectUri: process.env.APPLE_REDIRECT_URI ?? "https://www.oxmmatch.com/api/oauth/apple/callback",
  lineChannelId: process.env.LINE_CHANNEL_ID ?? "",
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  lineRedirectUri: process.env.LINE_REDIRECT_URI ?? "https://www.oxmmatch.com/api/oauth/line/callback",
  adminWhitelistOpenIds: (() => {
    try {
      const raw = process.env.ADMIN_WHITELIST_OPEN_IDS ?? "[]";
      return JSON.parse(raw) as string[];
    } catch {
      return [] as string[];
    }
  })(),
  adminWhitelistEmails: (() => {
    try {
      const raw = process.env.ADMIN_WHITELIST_EMAILS ?? "[]";
      return JSON.parse(raw) as string[];
    } catch {
      return [] as string[];
    }
  })(),
};