/**
 * 正式站故障主動通知（Batch 3.12）。
 *
 * 原本所有失敗只寫進 Render log，owner 不主動打開 log 就不會知道。這裡用最簡單、
 * 不需要新外部平台的方式：在 process 內以滑動視窗計數各類故障事件，超過門檻時
 * 寫一行 [ops-alert] log，並透過既有的 Resend 寄信給管理員（ALERT_EMAIL，未設定時
 * 用 ADMIN_EMAIL）。每一類最多每 30 分鐘通知一次，不會洗信箱。
 *
 * 通知內容只有類別、次數、時間窗與精簡的錯誤類型／路徑——不含使用者資料、IP、
 * token、request body 或錯誤全文。process 本身當掉／重啟迴圈無法由自己通知，
 * 由 Render 的服務通知負責（見 Batch 3.12 報告的 owner action）。
 */
export type OpsAlertKind =
  | "process_error"
  | "server_5xx"
  | "readiness_failed"
  | "email_failures"
  | "oauth_failures"
  | "storage_failures"
  | "client_errors";

export const OPS_ALERT_THRESHOLDS: Record<OpsAlertKind, { count: number; windowMs: number; label: string }> = {
  process_error: { count: 1, windowMs: 60_000, label: "未處理的 process 例外（unhandledRejection／uncaughtException）" },
  server_5xx: { count: 5, windowMs: 10 * 60_000, label: "API 內部錯誤（5xx）" },
  readiness_failed: { count: 3, windowMs: 5 * 60_000, label: "readiness 檢查失敗（資料庫無法使用）" },
  email_failures: { count: 5, windowMs: 30 * 60_000, label: "Email 寄送失敗" },
  oauth_failures: { count: 10, windowMs: 15 * 60_000, label: "OAuth 登入流程失敗" },
  storage_failures: { count: 5, windowMs: 15 * 60_000, label: "S3 儲存操作失敗" },
  client_errors: { count: 20, windowMs: 10 * 60_000, label: "前端執行期錯誤" },
};
export const OPS_ALERT_COOLDOWN_MS = 30 * 60_000;
const MAX_DETAIL_LENGTH = 120;

export type OpsAlert = { kind: OpsAlertKind; label: string; count: number; windowMinutes: number; latestDetail: string | null; at: Date };
export type OpsAlertSender = (alert: OpsAlert) => Promise<void>;

/** 只留下錯誤類型等精簡資訊：去掉 email、IP、網址 query、過長內容。 */
export function sanitizeAlertDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return detail
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[ip]")
    .replace(/\?[^\s]*/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, MAX_DETAIL_LENGTH);
}

export function createOpsAlertMonitor(opts: { send: OpsAlertSender; now?: () => number; log?: (line: string) => void }) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.error(line));
  const events = new Map<OpsAlertKind, number[]>();
  const lastAlertAt = new Map<OpsAlertKind, number>();

  function record(kind: OpsAlertKind, detail?: string | null): boolean {
    const t = now();
    const { count, windowMs, label } = OPS_ALERT_THRESHOLDS[kind];
    const list = (events.get(kind) ?? []).filter(ts => t - ts < windowMs);
    list.push(t);
    events.set(kind, list.slice(-Math.max(count, 50)));
    if (list.length < count) return false;
    const last = lastAlertAt.get(kind);
    if (last !== undefined && t - last < OPS_ALERT_COOLDOWN_MS) return false;
    lastAlertAt.set(kind, t);
    const alert: OpsAlert = { kind, label, count: list.length, windowMinutes: Math.round(windowMs / 60_000), latestDetail: sanitizeAlertDetail(detail), at: new Date(t) };
    log(`[ops-alert] kind=${kind} count=${alert.count} window=${alert.windowMinutes}m detail=${alert.latestDetail ?? "-"}`);
    opts.send(alert).catch(err => log(`[ops-alert] notification delivery failed: ${(err as { name?: string } | null)?.name ?? "Error"}`));
    return true;
  }

  return { record };
}

let monitor: ReturnType<typeof createOpsAlertMonitor> | null = null;

/** 全站共用的事件記錄入口；寄信實作延遲載入，避免與 email.ts 形成循環依賴。 */
export function recordOpsEvent(kind: OpsAlertKind, detail?: string | null): void {
  if (!monitor) {
    monitor = createOpsAlertMonitor({
      send: async (alert) => {
        const { sendOpsAlertEmail } = await import("../email");
        await sendOpsAlertEmail(alert);
      },
    });
  }
  try { monitor.record(kind, detail); } catch { /* 通知機制本身絕不影響原本的請求流程 */ }
}

export type ClientErrorReport = { kind: "error" | "unhandledrejection"; path: string; message: string };

/** 前端錯誤回報的嚴格解析：只接受固定欄位，path 只留 pathname，訊息去識別化並截斷。 */
export function parseClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind === "unhandledrejection" ? "unhandledrejection" : b.kind === "error" ? "error" : null;
  if (!kind || typeof b.message !== "string" || typeof b.path !== "string") return null;
  const path = b.path.split(/[?#]/)[0].replace(/[^\w\-./~%]/g, "").slice(0, 200) || "/";
  const message = sanitizeAlertDetail(b.message) ?? "";
  return { kind, path, message };
}

/** 測試用：重設全域 monitor。 */
export function __resetOpsAlertMonitorForTests(): void {
  monitor = null;
}
