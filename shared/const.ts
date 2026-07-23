export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ===== 找消息（News）NEW 徽章有效期限 =====
// 唯一真相來源：NEW 徽章顯示＝firstPublishedAt 未滿此時數 AND 目前使用者尚未讀過。
// 前端（列表項目／看板／產業父子層）、後端彙總查詢、邊界測試都必須讀這個常數，
// 不得各自寫死小時數字——否則前後端或測試很容易改一邊漏一邊，造成期限不一致。
export const NEWS_NEW_WINDOW_HOURS = 168;
export const NEWS_NEW_WINDOW_MS = NEWS_NEW_WINDOW_HOURS * 60 * 60 * 1000;

// ===== 政府補助顧問對話：客戶端顯示的匿名顧問身分 =====
// 由「顧問管理中心／聯繫客戶」建立或進入的顧問對話，案件申請人（工廠端）看到的
// 對話身分一律顯示此名稱，不顯示實際顧問的個人姓名。判斷邏輯見 server/db.ts 的
// isAdvisorConversation()／getAdvisorUserIdsForFactory()。
export const ADVISOR_DISPLAY_NAME = "OXM政府補助顧問";

// ===== OXM 商案討論區 =====
export type CommunityFeatureStatus = "coming_soon" | "beta" | "live" | "maintenance";
export const COMMUNITY_FEATURE_STATUS: CommunityFeatureStatus = "beta";
export const COMMUNITY_CROSS_INDUSTRY_NAME = "跨產業交流區" as const;
export const COMMUNITY_CROSS_INDUSTRY_SLUG = "cross-industry" as const;
// Controls public UI entry points (Navbar, menus, etc.).
// Set to false to hide all public entries while keeping /community route + API functional for internal testing.
export const COMMUNITY_PUBLIC_ENTRY_ENABLED = false;

// ===== 通知中心：eventType 分群 =====
// Platform notifications: always visible to all logged-in users
export const PLATFORM_NOTIFICATION_TYPES = new Set<string>([
  "factory_approved",
  "factory_rejected",
  "chat_message", // covers both directions: buyer→factory and factory→buyer
  "review_reply",
  "co_manager_invitation",
  "co_manager_invitation_accepted",
  "co_manager_invitation_rejected",
  "admin_announcement",
  "report_status_changed",
  "support_ticket_updated",
  "news", // 產業情報中心（找消息）站內通知——全站功能，不受社群 beta 開關綁定
]);

// Community/bid notifications: only visible when COMMUNITY_PUBLIC_ENTRY_ENABLED or user is admin
export const COMMUNITY_NOTIFICATION_TYPES = new Set<string>([
  "community_post_reply",
  "community_comment_reply",
  "community_mention",
  "community_reply_and_mention",
  "bid_review_approved",
  "bid_review_rejected",
  "bid_new_offer",
  "followed_factory_new_discussion",
  "board_new_discussion",
]);
