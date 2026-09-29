/**
 * Email 驗證（magic link）共用政策。auth.sendVerificationEmail 與 Verified
 * Account Linking 共用同一組數值，不各自維護一份。
 */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

export function emailVerificationBaseUrl(): string {
  return process.env.OAUTH_SERVER_URL || "https://www.oxmmatch.com";
}
