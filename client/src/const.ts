export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { Capacitor } from "@capacitor/core";
import { APP_LOGIN_CHALLENGE_PARAM, APP_LOGIN_VERIFIER_STORAGE_KEY } from "@shared/appLoginPkce";

export const getLoginUrl = () => "/api/oauth/google";

export type OAuthProvider = "google" | "apple" | "line";

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * App 登入的 PKCE 式綁定（見 shared/appLoginPkce.ts）：產生隨機 verifier 存在本機，
 * 只把它的 SHA-256 帶給 server；登入票券回到 App 時必須同時提出 verifier。
 */
async function createAppLoginChallenge(): Promise<string | null> {
  try {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    localStorage.setItem(APP_LOGIN_VERIFIER_STORAGE_KEY, verifier);
    return base64Url(digest);
  } catch {
    return null;
  }
}

export async function performLogin(provider: OAuthProvider = "google"): Promise<void> {
  const webUrl = `/api/oauth/${provider}`;
  let appUrl = `https://www.oxmmatch.com/api/oauth/${provider}?source=app`;
  try {
    if (Capacitor.isNativePlatform()) {
      const challenge = await createAppLoginChallenge();
      if (challenge) appUrl += `&${APP_LOGIN_CHALLENGE_PARAM}=${challenge}`;
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: appUrl });
      return;
    }
    window.location.href = webUrl;
  } catch (error) {
    console.error("[performLogin] failed:", error);
    window.location.href = Capacitor.isNativePlatform() ? appUrl : webUrl;
  }
}
