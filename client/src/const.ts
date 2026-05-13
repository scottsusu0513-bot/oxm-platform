export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const getLoginUrl = () => "/api/oauth/google";

export async function performLogin(): Promise<void> {
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: "https://www.oxmmatch.com/api/oauth/google?source=app" });
  } else {
    window.location.href = "/api/oauth/google";
  }
}
