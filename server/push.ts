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
    console.log(`[Push] userId=${userId} skipped: no enabled tokens`);
    return { status: "skipped", reason: "no_tokens" };
  }

  const platforms = rows.map(r => r.platform).join(",");
  console.log(`[Push] userId=${userId} tokenCount=${rows.length} platforms=[${platforms}]`);
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
  console.log(`[Push] userId=${userId} FCM result: success=${response.successCount} fail=${response.failureCount}`);

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

/**
 * Strip markdown/HTML-ish formatting and collapse whitespace so free-text
 * content (e.g. an announcement body) is safe to show as a plain-text push
 * notification body, and truncate to a reasonable length.
 */
export function toPlainPushSummary(text: string, maxLen = 100): string {
  const plain = text
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[#*_~`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen - 1).trimEnd() + "…";
}

const DEFAULT_NOTIFICATION_TITLE = "OXM 產業情報中心有新消息";

/**
 * 通知「標題」共用清理函式：Email 主旨、Push 標題、站內通知（communityNotifications）
 * 的 titleSnapshot 都必須呼叫這支，不得各自處理——APP 系統推播與站內通知中心
 * 都不會解析 Markdown，`**粗體**`／`### 標題` 這類格式符號如果直接送出去，
 * 使用者看到的就是原始符號本身。這裡只清理「拿去當通知標題用的純文字版本」，
 * 不會、也不應該修改 news.title 這個原始欄位——網站消息頁面／管理後台仍然
 * 顯示原始 Markdown 標題，兩者是同一份資料的兩種呈現方式，不是兩份資料。
 *
 * 清理範圍（依序套用）：
 *   1) HTML 標籤：整個標籤直接移除（不留下尖括號本身）。
 *   2) Markdown 連結／圖片 [文字](網址)：只留下「文字」，網址不會出現在標題裡。
 *   3) Markdown 標題符號 #／##／###（僅限行首，避免誤刪句子中間合理出現的
 *      # 字元，例如「工廠 #1」不會被動到）。
 *   4) 粗體 **文字**／__文字__、斜體 *文字*／_文字_、行內程式碼反引號、
 *      刪除線 ~~文字~~：這些格式符號（*／_／`／~）不分成雙字元或單字元
 *      分別處理，直接整體移除——跟本檔案既有的 toPlainPushSummary 用同一種
 *      「移除格式符號本身、保留被包住的文字」策略，不是重新發明一套規則。
 *   5) 控制字元（含換行、tab、其他不可見控制碼）先轉成空白，再把連續空白
 *      收斂成單一空白、裁掉前後空白——保證輸出裡不會出現換行或原始控制碼。
 *
 * 不刪除中文標點、括號、全形／半形斜線、連字號、百分比或數字，只移除上述
 * Markdown／HTML／控制字元。
 *
 * 防呆：
 *   - 清理後若變成空字串（例如整個標題只有 Markdown 符號組成的極端情況），
 *     fallback 成固定安全標題，不會送出空白通知。
 *   - 輸出長度限制在 maxLen（預設 80）以內；因為截斷前已經把所有 Markdown
 *     符號都清乾淨了，slice 的截斷點不可能落在殘留符號上、留下半個符號。
 */
export function toPlainNotificationText(value: string, maxLen = 80): string {
  const plain = value
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/[*_`~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const safe = plain.length > 0 ? plain : DEFAULT_NOTIFICATION_TITLE;
  if (safe.length <= maxLen) return safe;
  return `${safe.slice(0, maxLen - 1).trimEnd()}…`;
}
