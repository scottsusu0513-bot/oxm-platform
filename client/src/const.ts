export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { Capacitor } from "@capacitor/core";

export const getLoginUrl = () => "/api/oauth/google";

export async function performLogin(): Promise<void> {
  console.log("[performLogin] clicked");
  const appLoginUrl = "https://www.oxmmatch.com/api/oauth/google?source=app";
  try {
    const isNative = Capacitor.isNativePlatform();
    console.log("[performLogin] isNative:", isNative);
    if (isNative) {
      console.log("[performLogin] Browser.open:", appLoginUrl);
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: appLoginUrl });
      return;
    }
    console.log("[performLogin] web redirect");
    window.location.href = "/api/oauth/google";
  } catch (error) {
    console.error("[performLogin] failed:", error);
    if (Capacitor.isNativePlatform()) {
      window.location.href = appLoginUrl;
      return;
    }
    window.location.href = "/api/oauth/google";
  }
}
