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
  // Phase 12.2：OXM AI 全域 kill switch，唯一權威來源。語意刻意設計成
  // 「unset → enabled」（只有明確設成字串 "false" 才會關閉）——這樣
  // production 忘記設這個 env var 不會導致 AI 被誤關，只有維運人員主動設
  // OXM_AI_ENABLED=false 才會停用。gate 實際擋在 server/routers.ts 的
  // ai.chat mutation 最前面（entitlement 判斷之前），對一般使用者與 Admin
  // 一視同仁（見對話「四」：這是整個系統的緊急停止，不是使用者限制）。
  aiEnabled: process.env.OXM_AI_ENABLED !== "false",
  // Phase 13.0：產品發布狀態（release gate），跟上面的 kill switch 是兩個
  //完全獨立的概念，不可互相取代（見對話「一」）：kill switch 是「已經正式
  // 開放後，臨時故障/維護」，release mode 是「還沒對外正式開放，敬請
  // 期待」。語意刻意設計成「unset 或任何非 'live' 的值 → coming_soon」——
  // 只有明確設成字串 "live" 才會真正開放，這樣 production 忘記設這個 env
  // var、或未來不小心打錯字（例如 "Live"／"LIVE"／"prod"），都會安全落回
  // coming_soon，絕對不會因為忘記設定或打錯字就把還沒準備好的 AI 系統
  // 誤開放給所有使用者（見對話「十九」：預設安全策略跟 kill switch 相反）。
  aiReleaseMode: (process.env.OXM_AI_RELEASE_MODE === "live" ? "live" : "coming_soon") as "coming_soon" | "live",
  // 註冊條款 Consent Gate 的正式啟用時間點——只有 createdAt 晚於（含等於）
  // 這個時間的會員才會被要求完成 Consent Gate（見 shared/consent.ts 的
  // userNeedsConsent）。刻意不給任何預設時間字串：沒有設定或格式無法解析
  // 時一律回傳 null，由 userNeedsConsent() 自己套用「視為尚未啟用」的安全
  // fallback（CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK）。正式部署前，需要
  // 由部署環境依實際上線時間明確設定這個環境變數；忘記設定時，效果是
  // Consent Gate 對所有人都不生效，不會誤傷部署前就已存在的會員。
  consentGateLaunchAt: (() => {
    const raw = process.env.CONSENT_GATE_LAUNCH_AT;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })(),
};