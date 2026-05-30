import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";

type PlatformType = "android" | "ios" | "unknown";
type RegisterInput = { token: string; platform: PlatformType };
type RegisterFn = (input: RegisterInput) => Promise<unknown>;
export type PushInitResult = "success" | "denied" | "not_native" | "plugin_unavailable" | "error";

// Module-level guards — listeners registered at most once per app session
let listenersRegistered = false;
let currentRegisterFn: RegisterFn | null = null;

function getPlatform(): PlatformType {
  const raw = Capacitor.getPlatform();
  return raw === "android" || raw === "ios" ? raw : "unknown";
}

export async function initPushNotifications(registerFn: RegisterFn): Promise<PushInitResult> {
  if (!Capacitor.isNativePlatform()) return "not_native";

  currentRegisterFn = registerFn;

  try {
    if (!listenersRegistered) {
      listenersRegistered = true;

      try {
        // Token refresh — re-register updated FCM token with backend
        await FirebaseMessaging.addListener("tokenReceived", async (event) => {
          try {
            if (currentRegisterFn) {
              await currentRegisterFn({ token: event.token, platform: getPlatform() });
            }
          } catch {
            console.warn("[Push] token refresh registration to server failed");
          }
        });

        // Foreground notification received
        await FirebaseMessaging.addListener("notificationReceived", (event) => {
          console.info("[Push] foreground notification:", event.notification.title ?? "(no title)");
        });

        // Notification tapped / action performed
        await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
          console.info("[Push] notification tapped");
          const data = event.notification.data as Record<string, string> | undefined;
          if (data?.type === "chat" && data?.conversationId) {
            // 預留導頁，下一階段接 navigation
            // window.location.href = `/chat/${data.conversationId}`;
          }
        });

      } catch (listenerErr) {
        // Listener setup failed — reset guard so next attempt can retry
        listenersRegistered = false;
        console.warn("[Push] addListener failed:", listenerErr);
        return "plugin_unavailable";
      }
    }

    // Check / request notification permission
    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive !== "granted") {
      perm = await FirebaseMessaging.requestPermissions();
    }
    if (perm.receive !== "granted") return "denied";

    // Get FCM token (not APNs raw token)
    const { token } = await FirebaseMessaging.getToken();

    // Register FCM token with backend
    try {
      if (currentRegisterFn) {
        await currentRegisterFn({ token, platform: getPlatform() });
      }
    } catch {
      console.warn("[Push] FCM token registration to server failed");
    }

    return "success";

  } catch (err: unknown) {
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
