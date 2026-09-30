/**
 * App 登入票券的 PKCE 式綁定（Production Hardening Batch 3.7）。
 *
 * App 的 OAuth 在系統瀏覽器完成，登入票券透過 `oxm://oauth/callback?ticket=…`
 * 自訂 scheme 交回 App。Android 上任何 App 都能註冊同一個 scheme 攔截這個網址；
 * 舊流程只要拿到票券就能在 2 分鐘內換到該使用者的 session。
 *
 * 現在：App（WebView）開啟登入前先產生隨機 verifier 存在本機，只把它的
 * SHA-256（challenge）帶進 `/api/oauth/<provider>?source=app&app_challenge=…`。
 * server 把 challenge 放進 OAuth state 與票券本身；`/api/oauth/app-complete`
 * 必須同時提出票券與 verifier，雜湊相符才發 session。攔截到票券的其他 App
 * 沒有 verifier，換不到 session。
 */
export const APP_LOGIN_CHALLENGE_PARAM = "app_challenge";
export const APP_LOGIN_VERIFIER_STORAGE_KEY = "oxm_app_login_verifier";
/** SHA-256 的 base64url（無 padding）固定 43 字元。 */
export const APP_LOGIN_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636：43～128 個 unreserved 字元；這裡只接受 base64url 字元集。 */
export const APP_LOGIN_VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;
