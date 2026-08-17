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
  aiSearchProvider: (process.env.AI_SEARCH_PROVIDER ?? 'disabled') as 'openai' | 'anthropic' | 'disabled',
  aiSearchModel:    process.env.AI_SEARCH_MODEL ?? 'gpt-4o-mini',
  openaiApiKey:     process.env.OPENAI_API_KEY ?? '',
  // OXM AI（企業需求診斷與資源分流）對話核心使用的模型，與上面搜尋關鍵字增強
  // 用途的 aiSearchModel 分開設定，避免未來各自調整時互相牽動。
  aiChatProvider:   (process.env.AI_CHAT_PROVIDER ?? 'openai') as 'openai',
  aiChatModel:      process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
  // 見對話中「本機模型配置改成 Terra」：per-layer model override，各自預設
  // 回退到上面共用的 aiChatModel——沒有設定任何 AI_*_MODEL 覆寫時，行為跟
  // 改版前完全一樣（四層共用同一個模型），這是刻意保留的安全 fallback，不會
  // 因為新增這組設定就改變任何現有環境（含 production）的實際行為。只在
  // local/dev 的 .env 明確覆寫特定層級時才會分流到不同模型。
  aiDiagnosisModel:       process.env.AI_DIAGNOSIS_MODEL ?? process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
  aiRoutingModel:         process.env.AI_ROUTING_MODEL ?? process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
  aiActionPlannerModel:   process.env.AI_ACTION_PLANNER_MODEL ?? process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
  aiResponseComposerModel: process.env.AI_RESPONSE_COMPOSER_MODEL ?? process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
  // 見對話中「非 OXM 純閒聊收斂機制」：極輕量 resume gate 專用，刻意跟
  // aiChatModel 共用同一個保守預設（不會因為 local 端把 Layer 1/2 換成更貴
  // 的模型就跟著變貴），需要的話可以獨立覆寫成更便宜／更快的模型。
  aiCasualPauseGateModel: process.env.AI_CASUAL_PAUSE_GATE_MODEL ?? process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini',
};