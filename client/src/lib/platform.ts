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
