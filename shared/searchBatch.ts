/**
 * 單一 tRPC HTTP 批次內 factory.search 的數量上限（Batch 3.6）。server 端
 * （server/_core/searchBatchGuard.ts）超過即回 400；client 端
 * （client/src/main.tsx）讓 factory.search 走獨立的 httpBatchLink，maxItems
 * 使用同一個值，正常操作不會踩到上限。
 */
export const MAX_SEARCH_CALLS_PER_BATCH = 5;
export const SEARCH_PROCEDURE_PATH = "factory.search";
