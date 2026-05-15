export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { Capacitor } from "@capacitor/core";

export const getLoginUrl = () => "/api/oauth/google";

export type OAuthProvider = "google" | "apple" | "line";

export async function performLogin(provider: OAuthProvider = "google"): Promise<void> {
  const webUrl = `/api/oauth/${provider}`;
  const appUrl = `https://www.oxmmatch.com/api/oauth/${provider}?source=app`;
  try {
    if (Capacitor.isNativePlatform()) {
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
