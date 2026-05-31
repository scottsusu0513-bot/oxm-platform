import { Capacitor } from "@capacitor/core";

export async function setBadgeCount(count: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    const { isSupported } = await Badge.isSupported();
    if (!isSupported) return;
    if (count > 0) {
      await Badge.set({ count });
    } else {
      await Badge.clear();
    }
  } catch (e) {
    console.warn("[Badge] setBadgeCount failed:", e);
  }
}

export async function clearBadge(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    await Badge.clear();
  } catch (e) {
    console.warn("[Badge] clearBadge failed:", e);
  }
}
