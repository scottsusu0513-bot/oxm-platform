/**
 * Batch 3.4：production tRPC 錯誤消毒。DB／driver／執行期錯誤不能把 SQL、參數、
 * stack 送到 client；程式刻意丟出的 TRPCError 與一般中文 Error 訊息維持原樣。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { formatTrpcError, GENERIC_INTERNAL_ERROR_MESSAGE, shouldSanitizeTrpcError } from "./_core/errorSanitize";

const SQL_TEXT = "select `id`, `ownerId` from `factories` where `factories`.`taxId` = ?";

function mysqlError() {
  const e = new Error(`Unknown column 'secretCol' in 'field list'`) as Error & Record<string, unknown>;
  Object.assign(e, { code: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22", sqlMessage: "Unknown column 'secretCol'", sql: SQL_TEXT });
  return e;
}

function buildRouter(isProduction: boolean) {
  const t = initTRPC.create({ transformer: superjson, errorFormatter: opts => formatTrpcError(opts, isProduction) });
  return t.router({
    drizzle: t.procedure.query(() => { throw new DrizzleQueryError(SQL_TEXT, ["12345678"], mysqlError()); }),
    mysql: t.procedure.query(() => { throw mysqlError(); }),
    typeError: t.procedure.query(() => { (undefined as any).ownerId; }),
    nonError: t.procedure.query(() => { throw { detail: "raw object with /internal/path" }; }),
    notFound: t.procedure.query(() => { throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" }); }),
    badRequest: t.procedure.query(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "欄位格式錯誤" }); }),
    forbidden: t.procedure.query(() => { throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限" }); }),
    explicitInternal: t.procedure.query(() => { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "上傳失敗，請重試" }); }),
    plainError: t.procedure.query(() => { throw new Error("此工廠已下架"); }),
  });
}

async function call(isProduction: boolean, path: string) {
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`),
    router: buildRouter(isProduction),
    createContext: () => ({}),
    onError: () => {},
  });
  const text = await res.text();
  return { status: res.status, text, error: JSON.parse(text).error.json as { message: string; data: Record<string, unknown> } };
}

afterEach(() => vi.restoreAllMocks());

describe("production：內部錯誤消毒", () => {
  for (const path of ["drizzle", "mysql", "typeError", "nonError"]) {
    it(`${path}：HTTP 回應只有通用訊息，沒有 SQL／參數／stack，且完整錯誤有記到 server log`, async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { status, text, error } = await call(true, path);
      expect(status).toBe(500);
      expect(error.message).toBe(GENERIC_INTERNAL_ERROR_MESSAGE);
      expect(error.data).not.toHaveProperty("stack");
      expect(error.data.code).toBe("INTERNAL_SERVER_ERROR");
      for (const leak of ["select", "factories", "12345678", "secretCol", "params", "ownerId", "/internal/path", ".ts:"]) expect(text).not.toContain(leak);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`path=${path}`), expect.anything());
    });
  }

  for (const [path, code, message] of [
    ["notFound", "NOT_FOUND", "找不到工廠"],
    ["badRequest", "BAD_REQUEST", "欄位格式錯誤"],
    ["forbidden", "FORBIDDEN", "沒有權限"],
    ["explicitInternal", "INTERNAL_SERVER_ERROR", "上傳失敗，請重試"],
    ["plainError", "INTERNAL_SERVER_ERROR", "此工廠已下架"],
  ] as const) {
    it(`${path}：程式刻意給使用者看的訊息保留（${message}），但仍不帶 stack`, async () => {
      const { error } = await call(true, path);
      expect(error.message).toBe(message);
      expect(error.data.code).toBe(code);
      expect(error.data).not.toHaveProperty("stack");
    });
  }
});

describe("development：維持 tRPC 預設行為（完整訊息＋stack 方便除錯）", () => {
  it("DB 錯誤訊息與 stack 保留", async () => {
    const { error } = await call(false, "drizzle");
    expect(error.message).toContain("Failed query");
    expect(error.data).toHaveProperty("stack");
  });
  it("刻意的 TRPCError 不變", async () => {
    const { error } = await call(false, "notFound");
    expect(error.message).toBe("找不到工廠");
  });
});

describe("shouldSanitizeTrpcError 判斷依據是類別與屬性", () => {
  const wrap = (cause: unknown) => new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
  it("已知限制：丟出原始字串時 tRPC 會轉成一般 new Error(String(x))，無法和應用程式訊息區分——server/ 目前沒有任何 throw 原始值", () => {
    expect(shouldSanitizeTrpcError(wrap(new Error("x")))).toBe(false);
  });
  it("一般 Error 保留；帶 driver 屬性、子類別、巢狀 cause 的一律消毒", () => {
    expect(shouldSanitizeTrpcError(wrap(new Error("中文訊息")))).toBe(false);
    expect(shouldSanitizeTrpcError(wrap(mysqlError()))).toBe(true);
    expect(shouldSanitizeTrpcError(wrap(new TypeError("x")))).toBe(true);
    expect(shouldSanitizeTrpcError(wrap(new Error("wrapper", { cause: mysqlError() })))).toBe(true);
    expect(shouldSanitizeTrpcError(new TRPCError({ code: "BAD_REQUEST", message: "x", cause: mysqlError() }))).toBe(false);
  });
});
