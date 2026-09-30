import type { NextFunction, Request, Response } from "express";
import { MAX_SEARCH_CALLS_PER_BATCH, SEARCH_PROCEDURE_PATH } from "../../shared/searchBatch";

export { MAX_SEARCH_CALLS_PER_BATCH };

/**
 * tRPC 批次請求的 factory.search 數量上限（Production Hardening Batch 3.6）。
 *
 * searchLimiter（每 IP 每分鐘 30 次）以「HTTP request」計數，但 tRPC 預設允許
 * 批次，一個 `/api/trpc/factory.search,factory.search,…?batch=1` 請求可以夾帶
 * 數十到上百個搜尋——每一個都可能觸發一次 OpenAI 呼叫與一整組 DB 查詢，限流卻
 * 只扣 1 次。這裡在 tRPC 解析之前擋掉「單一 HTTP 批次內 factory.search 超過
 * 上限」的請求（不改限流的 key 與次數，也不影響其他 procedure 的批次）。
 *
 * 前端（client/src/main.tsx）讓 factory.search 走獨立的 httpBatchLink
 * （maxItems 與這裡相同），手機「返回恢復」一次補回多頁時會自動拆成多個
 * HTTP 請求，不會踩到這個上限。
 */
const SEARCH_PROCEDURE = SEARCH_PROCEDURE_PATH;
const TRPC_PREFIX = "/api/trpc/";

/** 從 `/api/trpc/a,b,c` 取出 procedure 清單；不是 tRPC 路徑回傳空陣列。 */
export function parseTrpcProcedurePaths(path: string): string[] {
  if (!path.startsWith(TRPC_PREFIX)) return [];
  const rest = path.slice(TRPC_PREFIX.length);
  if (!rest) return [];
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    // 無法解碼就用原始字串計算（tRPC 自己會回錯誤）
  }
  return decoded.split(",").map(p => p.trim());
}

export function countSearchCalls(path: string): number {
  return parseTrpcProcedurePaths(path).filter(p => p === SEARCH_PROCEDURE).length;
}

export function searchBatchGuard(req: Request, res: Response, next: NextFunction): void {
  const procedures = parseTrpcProcedurePaths(req.path);
  const searchCalls = procedures.filter(p => p === SEARCH_PROCEDURE).length;
  if (searchCalls <= MAX_SEARCH_CALLS_PER_BATCH) {
    next();
    return;
  }
  // 跟 tRPC 批次回應同形狀（每個 procedure 一筆錯誤），client 才能正確解析訊息
  const errorItem = {
    error: {
      json: {
        message: "單次請求的搜尋數量過多，請重新整理後再試",
        code: -32600,
        data: { code: "BAD_REQUEST", httpStatus: 400 },
      },
    },
  };
  res.status(400).json(Array.from({ length: Math.max(1, procedures.length) }, () => errorItem));
}
