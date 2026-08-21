// 新會員 Spotlight 新手導引的 rollout 判斷。
//
// 責任分離：這支檔案跟 shared/consent.ts 各自獨立、互不 import——onboarding
// 跟法律條款同意是兩件不同的事，即使兩者現在採用同一套「createdAt 是否早於
// launchAt」rollout 安全模式，也不應該共用同一個常數或同一個判斷函式：未來
// 如果需要單獨關掉導覽（例如導覽 UI 有 bug）而不影響條款同意這個法遵功能，
// 兩者拆開才能各自獨立控制。
//
// 這支檔案只放「純函式」，不讀 process.env——launch timestamp 由呼叫端
// （server/routers.ts，經由 server/_core/env.ts 的 ENV.onboardingLaunchAt）
// 從環境變數解析後以參數傳入，這裡完全不碰 process.env，避免這支 shared
// 檔案被任何地方（含 client 端）引用時，把讀取環境變數的邏輯也一起帶進
// client bundle。client（OnboardingTour.tsx）本身也完全不 import 這支檔案
// 的 rollout 判斷——client 只消費 server 端 auth.me 回傳的 needsOnboarding
// 這個已經算好的布林值，server 才是「是否需要導覽」的 source of truth。
//
// Rollout 判斷刻意不用「onboardingCompletedAt IS NULL 就顯示」：migration
// 套用後，所有既有會員這欄都會是 NULL，如果只看欄位是否為 NULL，會讓全站
// 舊會員在這個功能上線那一刻起，下次登入通通被導覽攔住——但需求是「這個功
// 能上線之後才註冊的新會員才需要看導覽」，既有會員不受影響。改用 launchAt
// 這個時間點，只比對 users.createdAt（既有欄位，不需要另外造假資料）：
// createdAt 早於上線時間的一律視為既有會員，永久不受這一版導覽影響；
// createdAt 晚於（含等於）上線時間的才是「這個功能上線後的新會員」，才會
// 被要求看導覽。

// launchAt 未設定（undefined／null／解析失敗）時的安全預設值：刻意設在遙遠
// 的未來，讓 rollout 在「還沒有人明確設定正式上線時間」的狀態下永遠視為
// 「尚未啟用」——不會有任何使用者的 createdAt 晚於西元 9999 年，所以在這個
// fallback 底下 userNeedsOnboarding() 對所有人都回傳 false，等同導覽完全不
// 生效。正式上線時，由部署環境明確設定 ONBOARDING_LAUNCH_AT 這個環境變數
// （見 server/_core/env.ts），屆時才會真正開始套用 rollout boundary。
export const ONBOARDING_LAUNCH_AT_DISABLED_FALLBACK = new Date("9999-01-01T00:00:00Z");

/** userNeedsOnboarding() 只需要的最小欄位子集，方便 server／client 兩邊用
 * 各自手邊已有的 user 物件呼叫，不用整包完整 User type。 */
export interface OnboardingCheckableUser {
  createdAt: Date;
  onboardingCompletedAt: Date | null;
}

/**
 * 純函式：判斷這個 user 目前是否需要顯示新手導覽。
 *
 * @param launchAt 導覽正式啟用的時間點，由呼叫端從 ENV.onboardingLaunchAt
 *   （環境變數 ONBOARDING_LAUNCH_AT）取得；傳入 null／undefined 時視為
 *   「尚未設定」，套用 ONBOARDING_LAUNCH_AT_DISABLED_FALLBACK（效果等同尚
 *   未啟用）。
 *
 * Boundary 語意（與 Consent Gate 一致，createdAt 等於 launchAt 時算「新會
 * 員」，需要導覽）：
 *   createdAt <  launchAt → 舊會員，不需要導覽
 *   createdAt >= launchAt → 新會員，需要導覽（除非已完成或略過）
 *
 * 「完成」與「略過」共用同一個 onboardingCompletedAt 欄位——這支函式不區分
 * 兩者，只要這欄有值就代表「不再需要自動顯示導覽」。
 */
export function userNeedsOnboarding(
  user: OnboardingCheckableUser | null | undefined,
  launchAt: Date | null | undefined,
): boolean {
  if (!user) return false;
  const effectiveLaunchAt = launchAt ?? ONBOARDING_LAUNCH_AT_DISABLED_FALLBACK;
  if (user.createdAt < effectiveLaunchAt) return false;
  return user.onboardingCompletedAt == null;
}
