/**
 * Email 驗證政策（集中定義，避免 magic number 散落）。
 *
 * 兩種用途刻意分開：
 *   - 一般 Email verification（會員設定／驗證主信箱）：24 小時。
 *   - Account Linking（Web magic link 與 App OTP）：15 分鐘——連結既有帳號是
 *     高風險操作，有效時間比一般信箱驗證短。
 * 兩者共用同一個重寄冷卻時間。
 */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_LINK_VERIFICATION_TTL_MS = 15 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/** App OTP：每一組驗證碼挑戰最多允許的錯誤次數（第 5 次錯誤後立即失效）。 */
export const ACCOUNT_LINK_OTP_MAX_ATTEMPTS = 5;
export const ACCOUNT_LINK_OTP_DIGITS = 6;

export function emailVerificationBaseUrl(): string {
  return process.env.OAUTH_SERVER_URL || "https://www.oxmmatch.com";
}
