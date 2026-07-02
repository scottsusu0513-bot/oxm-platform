import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import * as db from "./db";

let firebaseInitialized = false;
let firebaseInitError: string | null = null;

function ensureFirebaseInit(): void {
  if (firebaseInitialized) return;
  if (firebaseInitError) throw new Error(firebaseInitError);

  // Guard against duplicate init (e.g., hot reload)
  if (getApps().length > 0) {
    firebaseInitialized = true;
    return;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    firebaseInitError = "FIREBASE_SERVICE_ACCOUNT_JSON 環境變數未設定";
    throw new Error(firebaseInitError);
  }

  try {
    const serviceAccount = JSON.parse(raw);
    initializeApp({ credential: cert(serviceAccount) });
    firebaseInitialized = true;
  } catch (err) {
    firebaseInitError = `Firebase Admin 初始化失敗: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(firebaseInitError);
  }
}

export type SendPushResult =
  | { status: "sent"; tokenCount: number; successCount: number; failureCount: number }
  | { status: "skipped"; reason: "no_tokens" }
  | { status: "error"; message: string };

export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<SendPushResult> {
  try {
    ensureFirebaseInit();
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }

  const rows = await db.getEnabledPushTokensByUserId(userId);
  if (rows.length === 0) {
    return { status: "skipped", reason: "no_tokens" };
  }

  const tokenList = rows.map(r => r.token);
  const message = {
    tokens: tokenList,
    notification: { title: payload.title, body: payload.body },
    ...(payload.data ? { data: payload.data } : {}),
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
    android: {
      priority: "high" as const,
      notification: {
        channelId: "oxm_default_v2",
        sound: "default",
        defaultVibrateTimings: true,
        defaultSound: true,
      },
    },
  };

  const response = await getMessaging().sendEachForMulticast(message);

  // Handle invalid / unregistered tokens
  response.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code ?? "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        // Auto-disable stale token; fire-and-forget
        db.disablePushNotificationToken(userId, rows[i]!.token).catch(() => {});
        console.warn(`[Push] disabled invalid token for userId=${userId} (code=${code})`);
      } else {
        console.warn(`[Push] send failed for userId=${userId}: ${code}`);
      }
    }
  });

  return {
    status: "sent",
    tokenCount: rows.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
  };
}

export interface SendPushToRecipientsResult {
  targetUserCount: number;
  tokenCount: number;
  successCount: number;
  failureCount: number;
}

/**
 * Send push to a list of users. Deduplicates userIds, excludes sender.
 * Caller is responsible for pre-filtering by notification settings.
 * Always fire-and-forget safe (does not throw).
 */
export async function sendPushToRecipients(opts: {
  userIds: number[];
  excludeUserId?: number;
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<SendPushToRecipientsResult> {
  const result: SendPushToRecipientsResult = {
    targetUserCount: 0,
    tokenCount: 0,
    successCount: 0,
    failureCount: 0,
  };
  const seen = new Set<number>();

  for (const userId of opts.userIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    if (opts.excludeUserId != null && userId === opts.excludeUserId) continue;

    try {
      result.targetUserCount++;
      const r = await sendPushToUser(userId, {
        title: opts.title,
        body: opts.body,
        data: opts.data,
      });
      if (r.status === "sent") {
        result.tokenCount += r.tokenCount;
        result.successCount += r.successCount;
        result.failureCount += r.failureCount;
      }
    } catch (err) {
      console.warn(
        `[Push] sendPushToRecipients userId=${userId} error:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return result;
}
