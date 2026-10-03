/**
 * 前端執行期錯誤回報（Batch 3.12）：未捕捉的錯誤與 promise rejection 以同源 beacon
 * 送到 /api/client-errors，伺服器端計入故障通知。只送錯誤類型、精簡訊息與 pathname
 * （不含 querystring、使用者資料）；每次載入最多 5 筆，忽略瀏覽器擴充套件等非同源
 * 腳本的錯誤與已知無害的雜訊。
 */
const ENDPOINT = "/api/client-errors";
const MAX_REPORTS_PER_PAGE = 5;
const IGNORED_MESSAGES = [/ResizeObserver loop/i, /^Script error\.?$/i];

let sent = 0;
const seen = new Set<string>();

export function shouldReportClientError(message: string, sourceUrl: string | undefined, origin: string): boolean {
  if (!message) return false;
  if (IGNORED_MESSAGES.some(re => re.test(message))) return false;
  if (sourceUrl && !sourceUrl.startsWith(origin)) return false;
  return true;
}

function report(kind: "error" | "unhandledrejection", message: string): void {
  if (sent >= MAX_REPORTS_PER_PAGE) return;
  const key = `${kind}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  const body = JSON.stringify({ kind, message: message.slice(0, 300), path: window.location.pathname });
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
}

export function installClientErrorReporter(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message ?? "");
    if (shouldReportClientError(message, event.filename, window.location.origin)) report("error", message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const r = event.reason as { name?: string; message?: string } | undefined;
    const message = r?.message ? `${r.name ?? "Error"}: ${r.message}` : String(event.reason ?? "");
    if (shouldReportClientError(message, undefined, window.location.origin)) report("unhandledrejection", message);
  });
}
