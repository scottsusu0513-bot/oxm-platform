// 註冊條款 Consent Gate（服務條款 + 隱私權政策）的版本與 rollout 判斷。
//
// 這支檔案只放「純函式」，不讀 process.env——launch timestamp 由呼叫端
// （server/routers.ts，經由 server/_core/env.ts 的 ENV.consentGateLaunchAt）
// 從環境變數解析後以參數傳入，這裡完全不碰 process.env，避免這支 shared
// 檔案被任何地方（含未來可能的 client 端）引用時，把讀取環境變數的邏輯也
// 一起帶進 client bundle。client（ConsentGate.tsx）本身也完全不 import
// 這支檔案的 rollout 判斷——client 只消費 server 端 auth.me 回傳的
// needsConsent 這個已經算好的布林值，server 才是 Consent 是否需要完成的
// source of truth。
//
// Rollout 判斷刻意不用「termsAcceptedAt IS NULL 就攔」：migration 套用後，
// 所有既有會員這四個新欄位都會是 NULL，如果只看欄位是否為 NULL，會讓全站
// 舊會員在這個功能上線那一刻起，下次登入通通被 Consent Gate 攔住——但需求
// 是「這個功能上線之後才註冊的新會員才需要完成 Consent Gate」，既有會員不
// 受影響。改用 launchAt 這個時間點，只比對 users.createdAt（既有欄位，不
// 需要另外造假資料）：createdAt 早於上線時間的一律視為既有會員，永久不受
// 這一版 Consent Gate 影響；createdAt 晚於（含等於）上線時間的才是「這個
// 功能上線後的新會員」，才會被要求完成 Consent Gate。

// launchAt 未設定（undefined／null／解析失敗）時的安全預設值：刻意設在遙遠
// 的未來，讓 rollout 在「還沒有人明確設定正式上線時間」的狀態下永遠視為
// 「尚未啟用」——不會有任何使用者的 createdAt 晚於西元 9999 年，所以在這個
// fallback 底下 userNeedsConsent() 對所有人都回傳 false，等同 Consent Gate
// 完全不生效。這是刻意選擇的方向：忘記設定環境變數時寧可「Gate 沒有生
// 效」，也絕對不能反過來變成「用今天/上線前的模糊時間，誤傷正式部署前就已
// 經存在的既有會員」。正式上線時，由部署環境明確設定
// CONSENT_GATE_LAUNCH_AT 這個環境變數（見 server/_core/env.ts），屆時才會
// 真正開始套用 rollout boundary。
export const CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK = new Date("9999-01-01T00:00:00Z");

// 服務條款／隱私權政策各自獨立的版本字串（不是同一個版本號）——未來只要
// 條款或政策其中一份有實質修改，把對應的版本常數往上動即可：schema 已經有
// termsVersion／privacyVersion 兩個獨立欄位，userNeedsConsent() 會自動比對
// 「已同意的版本」是不是「目前版本」，不需要改這支函式或 schema。這一輪
// 先不主動要求既有已同意會員重新同意（見上面 launchAt 的 grandfather
// 邏輯——只有 createdAt 晚於上線時間的會員才會被這個版本比對攔到），未來
// 若要強制全站重新同意，屬於另一個決策，不在這次改動範圍內。
export const CURRENT_TERMS_VERSION = "2026-08-21";
export const CURRENT_PRIVACY_VERSION = "2026-08-21";

/** userNeedsConsent() 只需要的最小欄位子集，方便 server／client 兩邊用各自
 * 手邊已有的 user 物件呼叫，不用整包完整 User type。 */
export interface ConsentCheckableUser {
  createdAt: Date;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyAcceptedAt: Date | null;
  privacyVersion: string | null;
}

/**
 * 純函式：判斷這個 user 目前是否需要顯示 Consent Gate。
 *
 * @param launchAt Consent Gate 正式啟用的時間點，由呼叫端從
 *   ENV.consentGateLaunchAt（環境變數 CONSENT_GATE_LAUNCH_AT）取得；傳入
 *   null／undefined 時視為「尚未設定」，套用
 *   CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK（見上方說明，效果等同尚未
 *   啟用）。
 *
 * Boundary 語意（createdAt 與 launchAt 相等時算「新會員」，需要 Gate）：
 *   createdAt <  launchAt → 舊會員，不需要 Gate
 *   createdAt >= launchAt → 新會員，需要 Gate（除非已完成同意）
 */
export function userNeedsConsent(
  user: ConsentCheckableUser | null | undefined,
  launchAt: Date | null | undefined,
): boolean {
  if (!user) return false;
  const effectiveLaunchAt = launchAt ?? CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK;
  if (user.createdAt < effectiveLaunchAt) return false;
  const termsOk = user.termsAcceptedAt != null && user.termsVersion === CURRENT_TERMS_VERSION;
  const privacyOk = user.privacyAcceptedAt != null && user.privacyVersion === CURRENT_PRIVACY_VERSION;
  return !(termsOk && privacyOk);
}
