import { Capacitor } from "@capacitor/core";

/** Returns true when running inside a Capacitor native app (iOS or Android). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Returns true when running inside the iOS Capacitor app. */
export function isIOSApp(): boolean {
  try {
    return Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

/** Returns true when running inside the Android Capacitor app. */
export function isAndroidApp(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export type AppPlatform = "ios" | "android" | "web";

/** Returns the current runtime platform. Safe to call on web (returns "web"). */
export function getAppPlatform(): AppPlatform {
  try {
    const p = Capacitor.getPlatform();
    if (p === "ios") return "ios";
    if (p === "android") return "android";
  } catch {}
  return "web";
}

/**
 * Analytics 2.0 用的 platform 分類（見對話「APP 必須有可辨識的分類」）：
 * 三選一固定字串，跟後端 analyticsV2.trackEvent 的 zod enum 完全對應，避免
 * client 端各自定義字串造成拼字不一致。
 */
export function getAnalyticsPlatform(): "web" | "ios_app" | "android_app" {
  try {
    const platform = getAppPlatform();
    if (platform === "ios") return "ios_app";
    if (platform === "android") return "android_app";
  } catch {
    // fall through to web
  }
  return "web";
}

/**
 * Opens an external https:// URL in the system browser on native (Capacitor
 * `@capacitor/browser`, so it doesn't hijack the app's own WebView), or a new
 * tab on web (`noopener,noreferrer`). Same fallback pattern already used by
 * FloatingAnnouncementButton's LINE link and performLogin's OAuth redirect —
 * kept here as a small shared helper for other callers (e.g. announcement
 * action links) that need the same behavior without duplicating it.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      // fall through to window.open below
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
