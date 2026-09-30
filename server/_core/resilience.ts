/**
 * Production Hardening Batch 3.9：故障隔離、可觀察性與關機流程的共用工具。
 */
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * 設定了 DATABASE_URL 但連不上資料庫。刻意是 Error 的子類別：tRPC 錯誤消毒
 * （server/_core/errorSanitize.ts）會把它換成通用訊息，不外洩連線細節；前端
 * 因此看到「發生錯誤」而不是「沒有資料」。
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database unavailable");
    this.name = "DatabaseUnavailableError";
  }
}

export class OperationTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "OperationTimeoutError";
  }
}

/**
 * 替不支援 AbortSignal 的外部呼叫加上等待上限。只停止「等待」，底層請求仍可能
 * 完成——呼叫端必須把逾時視為「結果未知」，不可自動重試有副作用的操作（例如寄信）。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(label, ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/** log 用：保留網域與帳號第一個字元，避免完整 email 進入 production log。 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

// ── Request correlation ───────────────────────────────────────────────────

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** 每個 HTTP request 一個隨機 id（不含任何使用者／session 資訊），放在 response header。 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === "string" && REQUEST_ID_RE.test(incoming) ? incoming : randomBytes(8).toString("hex");
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

export function getRequestId(req: unknown): string | undefined {
  return (req as { requestId?: string } | null | undefined)?.requestId;
}

// ── Process lifecycle ─────────────────────────────────────────────────────

export const SHUTDOWN_DEADLINE_MS = 20_000;

type Closable = { close: (cb?: (err?: Error) => void) => unknown };

/**
 * 安裝 process 層級處理：
 *   - SIGTERM／SIGINT（Render 部署／重啟）：停止接受新連線、等正在處理的 request
 *     結束、關閉 DB 連線池；超過 SHUTDOWN_DEADLINE_MS 仍未完成就強制結束。
 *   - unhandledRejection：記錄後繼續服務。Node 預設會讓整個 process 結束，任何一個
 *     沒有接住的背景 promise（寄信、推播、通知）失敗都會中斷所有使用者的 request。
 *   - uncaughtException：process 狀態可能已不安全，記錄後走同一個有上限的關機流程，
 *     以 exit code 1 結束讓平台重啟。
 */
export function installProcessHandlers(opts: {
  server: Closable;
  closeResources: () => Promise<void>;
  exit?: (code: number) => void;
  deadlineMs?: number;
  /** 測試用：預設為 process。 */
  proc?: NodeJS.EventEmitter;
}): { shutdown: (reason: string, code: number) => Promise<void> } {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const proc = opts.proc ?? process;
  const deadlineMs = opts.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let shuttingDown = false;

  const shutdown = async (reason: string, code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${reason}: draining (deadline ${deadlineMs}ms)`);
    const force = setTimeout(() => {
      console.error(`[shutdown] deadline exceeded, forcing exit`);
      exit(code || 1);
    }, deadlineMs);
    force.unref?.();
    try {
      await new Promise<void>(resolve => opts.server.close(() => resolve()));
      await opts.closeResources();
      console.log(`[shutdown] complete`);
    } catch (err) {
      console.error(`[shutdown] error while closing:`, err instanceof Error ? `${err.name}: ${err.message}` : err);
    } finally {
      clearTimeout(force);
      exit(code);
    }
  };

  proc.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  proc.on("SIGINT", () => void shutdown("SIGINT", 0));
  proc.on("unhandledRejection", (reason: unknown) => {
    const r = reason as { name?: string; message?: string } | undefined;
    console.error(`[process] unhandledRejection (kept running): ${r?.name ?? typeof reason}: ${r?.message ?? String(reason)}`);
  });
  proc.on("uncaughtException", (err: Error) => {
    console.error(`[process] uncaughtException: ${err.name}: ${err.message}`, err.stack);
    void shutdown("uncaughtException", 1);
  });
  return { shutdown };
}

/** production 啟動前必要設定；缺少時回傳缺少的名稱（不含值）。 */
export function missingRequiredProductionEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  return required.filter(k => !env[k] || !String(env[k]).trim());
}

/**
 * Readiness 檢查（Batch 3.9）：只做唯讀 SELECT 1，整體最多 timeoutMs；不寫入、不呼叫
 * 任何外部服務。回傳 HTTP 狀態碼與內容。
 */
export function createReadinessCheck(opts: {
  getDb: () => Promise<{ execute: (q: any) => Promise<unknown> } | null>;
  probe: unknown;
  timeoutMs?: number;
}): () => Promise<{ status: 200 | 503; body: { status: "ready" | "unavailable" } }> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  return async () => {
    try {
      const db = await withTimeout(opts.getDb(), timeoutMs, "readiness db");
      if (!db) throw new Error("no database configured");
      await withTimeout(db.execute(opts.probe), timeoutMs, "readiness query");
      return { status: 200, body: { status: "ready" } };
    } catch {
      return { status: 503, body: { status: "unavailable" } };
    }
  };
}
