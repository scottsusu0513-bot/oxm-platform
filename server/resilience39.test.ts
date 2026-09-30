/**
 * Batch 3.9：故障隔離、可觀察性與關機流程的回歸測試。
 * failure injection 只在本機（不可達的 DB port、假 emitter、假 server），不碰 production。
 */
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseUnavailableError,
  OperationTimeoutError,
  createReadinessCheck,
  getRequestId,
  installProcessHandlers,
  maskEmail,
  missingRequiredProductionEnv,
  requestIdMiddleware,
  withTimeout,
} from "./_core/resilience";
import { GENERIC_INTERNAL_ERROR_MESSAGE, formatTrpcError } from "./_core/errorSanitize";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf-8");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withTimeout", () => {
  it("在期限內完成時回傳原結果", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "x")).resolves.toBe(42);
  });
  it("卡住的 promise 在期限到時丟 OperationTimeoutError", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 500, "stuck op");
    const assertion = expect(p).rejects.toMatchObject({ name: "OperationTimeoutError", message: "stuck op timed out after 500ms" });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
  it("原 promise 的錯誤原樣傳出", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow("boom");
  });
});

describe("maskEmail", () => {
  it("只保留第一個字元與網域", () => {
    expect(maskEmail("alice@example.test")).toBe("a***@example.test");
    expect(maskEmail(null)).toBe("(none)");
    expect(maskEmail("no-at-sign")).toBe("***");
  });
});

describe("requestIdMiddleware", () => {
  function run(headers: Record<string, string>) {
    const req = { headers } as any;
    const set: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { set[k] = v; } } as any;
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    return { req, set, next };
  }
  it("產生隨機 id，放在 req 與 X-Request-Id header", () => {
    const { req, set, next } = run({});
    expect(next).toHaveBeenCalledOnce();
    expect(set["X-Request-Id"]).toMatch(/^[0-9a-f]{16}$/);
    expect(getRequestId(req)).toBe(set["X-Request-Id"]);
  });
  it("沿用格式正確的上游 id，拒絕可注入 log 的內容", () => {
    expect(run({ "x-request-id": "abcDEF12-_xyz" }).set["X-Request-Id"]).toBe("abcDEF12-_xyz");
    const bad = run({ "x-request-id": "evil\nInjected: 1" }).set["X-Request-Id"];
    expect(bad).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("missingRequiredProductionEnv", () => {
  it("回傳缺少的必要設定名稱（不含值）", () => {
    expect(missingRequiredProductionEnv({ DATABASE_URL: "mysql://x", JWT_SECRET: "s" } as any)).toEqual([]);
    expect(missingRequiredProductionEnv({ DATABASE_URL: "mysql://x", JWT_SECRET: "  " } as any)).toEqual(["JWT_SECRET"]);
    expect(missingRequiredProductionEnv({} as any)).toEqual(["DATABASE_URL", "JWT_SECRET"]);
  });
  it("server 入口在 production 缺設定時直接結束，不帶著空 JWT_SECRET 服務", () => {
    const src = read("_core/index.ts");
    expect(src).toMatch(/missingRequiredProductionEnv\(\)/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });
});

describe("installProcessHandlers", () => {
  function setup(opts: { closeHangs?: boolean; deadlineMs?: number } = {}) {
    const proc = new EventEmitter();
    const exit = vi.fn();
    const server = { close: vi.fn((cb?: () => void) => { if (!opts.closeHangs) cb?.(); }) };
    const closeResources = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = installProcessHandlers({ server, closeResources, exit, proc, deadlineMs: opts.deadlineMs ?? 1000 });
    return { proc, exit, server, closeResources, errSpy, h };
  }

  it("SIGTERM：停止接新連線 → 關閉 DB 連線池 → exit(0)", async () => {
    const { proc, exit, server, closeResources } = setup();
    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(server.close).toHaveBeenCalledOnce();
    expect(closeResources).toHaveBeenCalledOnce();
  });

  it("重複訊號只關機一次", async () => {
    const { proc, exit, server } = setup();
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("連線遲遲無法關閉時，超過期限強制結束（exit code 非 0）", async () => {
    vi.useFakeTimers();
    const { proc, exit } = setup({ closeHangs: true, deadlineMs: 20_000 });
    proc.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("unhandledRejection：記錄後繼續服務，不結束 process", async () => {
    const { proc, exit, server, errSpy } = setup();
    proc.emit("unhandledRejection", new Error("background email failed"), Promise.resolve());
    await new Promise(r => setTimeout(r, 10));
    expect(exit).not.toHaveBeenCalled();
    expect(server.close).not.toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0][0])).toContain("background email failed");
  });

  it("uncaughtException：記錄並走有上限的關機，exit(1) 讓平台重啟", async () => {
    const { proc, exit, closeResources } = setup();
    proc.emit("uncaughtException", new Error("corrupt state"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(closeResources).toHaveBeenCalledOnce();
  });

  it("server 入口在 listen 後安裝 handlers 並關閉 DB 連線池", () => {
    expect(read("_core/index.ts")).toMatch(/installProcessHandlers\(\{ server, closeResources: closeDbPools \}\)/);
  });
});

describe("createReadinessCheck", () => {
  it("DB 正常 → 200 ready", async () => {
    const check = createReadinessCheck({ getDb: async () => ({ execute: async () => [] }), probe: "SELECT 1" });
    await expect(check()).resolves.toEqual({ status: 200, body: { status: "ready" } });
  });
  it("DB 連不上 → 503，不外洩錯誤內容", async () => {
    const check = createReadinessCheck({ getDb: async () => { throw new DatabaseUnavailableError(); }, probe: "SELECT 1" });
    await expect(check()).resolves.toEqual({ status: 503, body: { status: "unavailable" } });
  });
  it("未設定 DB → 503", async () => {
    const check = createReadinessCheck({ getDb: async () => null, probe: "SELECT 1" });
    expect((await check()).status).toBe(503);
  });
  it("查詢卡住 → 在 timeoutMs 內回 503，不會讓 health check 一起卡住", async () => {
    vi.useFakeTimers();
    const check = createReadinessCheck({ getDb: async () => ({ execute: () => new Promise(() => {}) }), probe: "SELECT 1", timeoutMs: 2000 });
    const p = check();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toEqual({ status: 503, body: { status: "unavailable" } });
  });
  it("/api/health 維持 liveness，/api/health/ready 另外提供", () => {
    const src = read("_core/index.ts");
    expect(src).toMatch(/app\.get\("\/api\/health\/ready"/);
    expect(src).toMatch(/createReadinessCheck\(/);
  });
});

describe("tRPC 錯誤消毒與 request id", () => {
  const shape = { message: "Database unavailable", code: -32603, data: { stack: "s" } };
  it("DatabaseUnavailableError 在 production 換成通用訊息，log 帶 requestId", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new DatabaseUnavailableError() });
    const out = formatTrpcError({ shape, error, path: "factory.search", ctx: { req: { requestId: "req12345abc" } } }, true);
    expect(out.message).toBe(GENERIC_INTERNAL_ERROR_MESSAGE);
    expect(out.data).not.toHaveProperty("stack");
    expect(String(errSpy.mock.calls[0][0])).toContain("requestId=req12345abc");
  });
  it("Email provider／逾時錯誤同樣不直接送到 client", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new Error("Email provider error: validation_error");
    e.name = "EmailProviderError";
    for (const cause of [e, new OperationTimeoutError("email send", 15000)]) {
      const out = formatTrpcError({ shape, error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }) }, true);
      expect(out.message).toBe(GENERIC_INTERNAL_ERROR_MESSAGE);
    }
  });
});

describe("DB 無法連線：明確失敗、可自行恢復", () => {
  const realUrl = process.env.DATABASE_URL;
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("連不上時丟 DatabaseUnavailableError（不是回傳 null 讓頁面顯示「沒有資料」），同時多個呼叫共用一次連線嘗試，恢復後可重新連線", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "mysql://root:x@127.0.0.1:1/oxm_unreachable");
    vi.resetModules();
    const db = await import("./db");
    const results = await Promise.allSettled([db.getDb(), db.getDb(), db.getDb()]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason?.name).toBe("DatabaseUnavailableError");
    }
    expect(db.__getMainPoolConfigForTests()).toBeNull(); // 失敗的 pool 已釋放，不留半套狀態

    if (!realUrl) return; // 沒有本機測試 DB 時只驗證失敗路徑
    vi.stubEnv("DATABASE_URL", realUrl);
    const recovered = await db.getDb();
    expect(recovered).not.toBeNull();
    expect(db.__getMainPoolConfigForTests()).toMatchObject({ connectionLimit: 50, queueLimit: 500, connectTimeout: 10_000 });
    await db.closeDbPools();
    expect(db.__getMainPoolConfigForTests()).toBeNull();
  }, 30_000);
});

describe("外部呼叫都有等待上限（source contract）", () => {
  it("OAuth provider 的每個 fetch 都帶 AbortSignal.timeout；Apple JWKS 有 timeoutDuration", () => {
    const src = read("_core/oauth.ts");
    const fetches = src.match(/await fetch\([^\n]*\n[^\n]*/g) ?? [];
    expect(fetches.length).toBe(6);
    for (const f of fetches) expect(f).toMatch(/signal: AbortSignal\.timeout\(OAUTH_PROVIDER_TIMEOUT_MS\)/);
    expect(src).toMatch(/createRemoteJWKSet\([^)]*\)[^;]*timeoutDuration: 10_000/);
  });
  it("公開與私有 S3 client 都設定 connectionTimeout／requestTimeout", () => {
    for (const f of ["storage.ts", "privateStorage.ts"]) {
      expect(read(f)).toMatch(/requestHandler: \{ connectionTimeout: 5_000, requestTimeout: 30_000 \}/);
    }
  });
  it("routers 內所有 detached 背景工作（寄信佇列、找消息通知、顧問通知）都有 .catch", () => {
    const src = read("routers.ts");
    for (const label of [
      "[news] email dispatch failed",
      "[news] push dispatch failed",
      "[admin] broadcast email queue failed",
      "[admin] announcement email queue failed",
      "[upgrade] consultant notification failed",
      "[finance] consultant notification failed",
    ]) expect(src).toContain(label);
    expect(src.split("[news] notification dispatch failed").length - 1).toBe(2);
  });
});
