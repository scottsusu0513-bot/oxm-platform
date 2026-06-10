export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ===== OXM 商案討論區 =====
export type CommunityFeatureStatus = "coming_soon" | "beta" | "live" | "maintenance";
export const COMMUNITY_FEATURE_STATUS: CommunityFeatureStatus = "coming_soon";
export const COMMUNITY_CROSS_INDUSTRY_NAME = "跨產業交流區" as const;
