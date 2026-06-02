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
