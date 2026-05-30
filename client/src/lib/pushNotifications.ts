import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

type PlatformType = "android" | "ios" | "unknown";
type RegisterInput = { token: string; platform: PlatformType };
type RegisterFn = (input: RegisterInput) => Promise<unknown>;
export type PushInitResult = "success" | "denied" | "not_native" | "plugin_unavailable" | "error";

// Module-level guards — listeners are registered at most once per app session
let listenersRegistered = false;
let currentRegisterFn: RegisterFn | null = null;

export async function initPushNotifications(registerFn: RegisterFn): Promise<PushInitResult> {
  if (!Capacitor.isNativePlatform()) return "not_native";

  // Always update callback so the latest mutation reference is used
  currentRegisterFn = registerFn;

  try {
    if (!listenersRegistered) {
      listenersRegistered = true;

      try {
        await PushNotifications.addListener("registration", async (token) => {
          const raw = Capacitor.getPlatform();
          const platform: PlatformType = raw === "android" || raw === "ios" ? raw : "unknown";
          try {
            if (currentRegisterFn) {
              await currentRegisterFn({ token: token.value, platform });
            }
          } catch {
            console.warn("[Push] token registration to server failed");
          }
        });

        await PushNotifications.addListener("registrationError", (err) => {
          console.warn("[Push] registration error:", err.error);
        });

        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          console.info("[Push] foreground notification:", notification.title ?? "(no title)");
        });

        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          console.info("[Push] notification tapped");
          const data = action.notification.data as Record<string, string> | undefined;
          if (data?.type === "chat" && data?.conversationId) {
            // 預留導頁，下一階段接 navigation
            // window.location.href = `/chat/${data.conversationId}`;
          }
        });
      } catch (listenerErr) {
        // 若 addListener 失敗，標記重置讓下次有機會重試
        listenersRegistered = false;
        console.warn("[Push] addListener failed:", listenerErr);
        return "plugin_unavailable";
      }
    }

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return "denied";

    await PushNotifications.register();
    return "success";

  } catch (err: unknown) {
    // 捕捉舊版 APP native plugin 不存在、not implemented、permission API throw 等情況
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("not implemented") ||
      msg.includes("not available") ||
      msg.includes("Plugin") ||
      msg.includes("unavailable")
    ) {
      console.warn("[Push] plugin not available in this app version:", msg);
      return "plugin_unavailable";
    }
    console.warn("[Push] unexpected error during init:", msg);
    return "error";
  }
}
