import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";

type PlatformType = "android" | "ios" | "unknown";
type RegisterInput = { token: string; platform: PlatformType };
type RegisterFn = (input: RegisterInput) => Promise<unknown>;
export type PushInitResult = "success" | "denied" | "not_native" | "plugin_unavailable" | "error";

const OXM_CHANNEL_ID = "oxm_default_v2";

// Module-level guards — listeners registered at most once per app session
let listenersRegistered = false;
let localNotifListenerRegistered = false;
let currentRegisterFn: RegisterFn | null = null;
let localNotifIdCounter = 1000;

// Stores a targetPath from a notification tap before React is fully mounted (cold-start case)
let pendingNavigatePath: string | null = null;

/** Consume and clear the pending push navigation path (call once on app mount). */
export function consumePendingNavigatePath(): string | null {
  const p = pendingNavigatePath;
  pendingNavigatePath = null;
  return p;
}

// 導出供測試直接驗證「現有點擊處理器認得的欄位格式」（見
// server/news.test.ts），不是給其他業務程式碼呼叫用的公開 API。
export function resolveTargetPath(data: Record<string, string> | undefined): string {
  if (!data) return "/messages";
  if (data.targetPath && data.targetPath.startsWith("/")) return data.targetPath;
  if (data.conversationId) return `/chat/${data.conversationId}`;
  return "/messages";
}

function dispatchPushNavigate(path: string) {
  pendingNavigatePath = path;
  window.dispatchEvent(new CustomEvent("oxm-push-navigate", { detail: { path } }));
}

function getPlatform(): PlatformType {
  const raw = Capacitor.getPlatform();
  return raw === "android" || raw === "ios" ? raw : "unknown";
}

/** Create oxm_default_v2 channel on Android (idempotent — OS ignores if already exists with same id) */
async function ensureAndroidChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: OXM_CHANNEL_ID,
      name: "OXM 通知",
      description: "OXM 訊息、詢價、訂單與平台通知",
      importance: 5, // IMPORTANCE_HIGH — 確保震動 + 聲音 + 頭通知
      sound: "default",
      vibration: true,
      lights: true,
      visibility: 1, // PUBLIC
    });
  } catch (e) {
    console.warn("[Push] createChannel failed:", e);
  }
}

/** Show a local notification for foreground FCM messages (Android only).
 *  iOS foreground is handled by presentationOptions in capacitor.config.ts. */
async function showForegroundLocalNotif(
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const id = localNotifIdCounter++;
    if (localNotifIdCounter > 2_000_000_000) localNotifIdCounter = 1000;
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: OXM_CHANNEL_ID,
          extra: { targetPath: data?.targetPath ?? "/messages" },
        },
      ],
    });
  } catch (e) {
    console.warn("[Push] LocalNotifications.schedule failed:", e);
  }
}

/** Register localNotificationActionPerformed listener once per session (Android foreground tap → navigate) */
async function ensureLocalNotifActionListener(): Promise<void> {
  if (localNotifListenerRegistered) return;
  if (Capacitor.getPlatform() !== "android") return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      const path = (event.notification?.extra?.targetPath as string | undefined) ?? "/messages";
      if (path.startsWith("/")) dispatchPushNavigate(path);
    });
    localNotifListenerRegistered = true;
  } catch (e) {
    console.warn("[Push] localNotificationActionPerformed listener failed:", e);
  }
}

export async function initPushNotifications(registerFn: RegisterFn): Promise<PushInitResult> {
  if (!Capacitor.isNativePlatform()) return "not_native";

  currentRegisterFn = registerFn;

  // Android: ensure channel exists before registering listeners / requesting permission
  await ensureAndroidChannel();
  await ensureLocalNotifActionListener();

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

        // Foreground notification received — show LocalNotification on Android
        // iOS foreground is handled by presentationOptions in capacitor.config.ts
        await FirebaseMessaging.addListener("notificationReceived", (event) => {
          const notification = event.notification;
          const title = notification?.title ?? "OXM";
          const body = notification?.body ?? "";
          const data = notification?.data as Record<string, string> | undefined;
          showForegroundLocalNotif(title, body, data).catch(() => {});
        });

        // Background / cold-start notification tapped — navigate to targetPath
        await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
          const data = event.notification?.data as Record<string, string> | undefined;
          const path = resolveTargetPath(data);
          dispatchPushNavigate(path);
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
