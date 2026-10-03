/**
 * tRPC 錯誤回應消毒（Production Hardening Batch 3.4）。
 *
 * tRPC v11 預設行為：procedure 丟出非 TRPCError 的例外時，會包成
 * INTERNAL_SERVER_ERROR，而且 message 直接沿用原始 error.message（只有 stack 在
 * production 會被拿掉）。Drizzle 查詢失敗的 message 是
 * 「Failed query: <SQL>\nparams: <參數>」，mysql2 的錯誤也帶 sql／sqlMessage——
 * 會把資料表／欄位與查詢參數送到 client。
 *
 * 判斷依據是錯誤的「類別與屬性」，不是比對字串：
 *   - 明確的 TRPCError（包含程式刻意丟出、帶使用者可讀訊息的
 *     INTERNAL_SERVER_ERROR）→ 保留
 *   - 應用程式自己寫的一般 `new Error("中文訊息")`（建構子就是 Error、沒有額外的
 *     driver 屬性）→ 保留：現有很多 procedure 用它回傳給使用者看的訊息
 *   - 其他（DrizzleQueryError、mysql2 錯誤、TypeError 等執行期錯誤、AWS SDK
 *     錯誤、丟出的非 Error 物件）→ production 改回通用訊息，完整錯誤只記在 server log
 *
 * 已知限制：丟出原始字串／數字時 tRPC 會轉成 `new Error(String(x))`，和應用程式的
 * 一般 Error 無法區分而會保留訊息；server/ 目前沒有 throw 原始值的寫法。
 */
import { TRPCError } from "@trpc/server";
import { getRequestId } from "./resilience";
import { recordOpsEvent } from "./opsAlert";

export const GENERIC_INTERNAL_ERROR_MESSAGE = "伺服器發生錯誤，請稍後再試";

/** 帶有這些屬性的錯誤來自 DB driver／ORM／AWS SDK 等底層，message 可能含內部細節。 */
const INTERNAL_DETAIL_PROPS = ["sql", "sqlMessage", "sqlState", "errno", "query", "params", "$metadata", "$fault"] as const;

/** 是否為「應用程式自己寫給使用者看的一般 Error」（可以保留 message）。 */
function isPlainApplicationError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (Object.getPrototypeOf(cause) !== Error.prototype) return false; // 子類別（DrizzleQueryError、TypeError…）一律不算
  if (cause.name !== "Error") return false;
  for (const prop of INTERNAL_DETAIL_PROPS) {
    if (Object.prototype.hasOwnProperty.call(cause, prop)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(cause, "cause") && (cause as { cause?: unknown }).cause !== undefined) return false;
  return true;
}

/**
 * 回傳 true 代表這個錯誤的 message 在 production 不能送到 client。
 * 只有「tRPC 自動包裝的非 TRPCError 例外」才會被考慮——明確丟出的 TRPCError
 * 不論 code（包含 INTERNAL_SERVER_ERROR）都保留原本訊息。
 */
export function shouldSanitizeTrpcError(error: TRPCError): boolean {
  if (error.code !== "INTERNAL_SERVER_ERROR") return false;
  const cause = error.cause;
  if (cause === undefined) return false; // 程式明確 new TRPCError({ code: "INTERNAL_SERVER_ERROR", message })
  if (cause instanceof TRPCError) return false;
  return !isPlainApplicationError(cause);
}

type ErrorShapeLike = { message: string; code: number; data: Record<string, unknown> & { stack?: string } };

/**
 * tRPC errorFormatter 本體。development／test 維持 tRPC 預設（完整訊息＋stack，
 * 方便除錯）；production 一律拿掉 stack，並把 shouldSanitizeTrpcError 判定為內部
 * 細節的訊息換成通用文案——完整錯誤仍記錄在 server log 供診斷。
 */
export function formatTrpcError<S extends ErrorShapeLike>(
  opts: { shape: S; error: TRPCError; path?: string; ctx?: unknown },
  isProduction: boolean,
): S {
  if (!isProduction) return opts.shape;
  const { stack: _stack, ...data } = opts.shape.data;
  if (shouldSanitizeTrpcError(opts.error)) {
    const requestId = getRequestId((opts.ctx as { req?: unknown } | undefined)?.req) ?? "-";
    console.error(`[trpc] internal error sanitized for client (path=${opts.path ?? "unknown"} requestId=${requestId}):`, opts.error.cause);
    recordOpsEvent("server_5xx", `${opts.path ?? "unknown"} ${(opts.error.cause as { name?: string } | undefined)?.name ?? "Error"}`);
    return { ...opts.shape, message: GENERIC_INTERNAL_ERROR_MESSAGE, data } as S;
  }
  return { ...opts.shape, data } as S;
}
