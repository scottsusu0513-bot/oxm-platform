export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { Capacitor } from "@capacitor/core";

export const getLoginUrl = () => "/api/oauth/google";

export async function performLogin(): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  const url = isNative
    ? "https://www.oxmmatch.com/api/oauth/google?source=app"
    : "/api/oauth/google";

  console.log("[performLogin] isNative:", isNative, "url:", url);

  if (isNative) {
    const { Browser } = await import("@capacitor/browser");
    console.log("[performLogin] calling Browser.open");
    await Browser.open({ url });
  } else {
    console.log("[performLogin] fallback window.location.href");
    window.location.href = url;
  }
}
