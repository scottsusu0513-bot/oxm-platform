import { vi } from "vitest";

/**
 * 頁面層 render 測試用的 tRPC 替身：任何 `trpc.a.b.useQuery()` 都回傳一個
 * 預設「成功、沒有資料」的 query 結果，`queryResults["a.b"]` 有設定時覆蓋對應
 * 欄位；`useMutation`／`useUtils` 回傳不做事的 stub。讓整頁元件可以在 jsdom
 * 裡 render，而不用逐一 mock 頁面用到的每一支 procedure。
 */
export type QueryResultOverrides = Record<string, Record<string, unknown>>;

const UTILS_METHODS = new Set(["invalidate", "fetch", "prefetch", "setData", "getData", "cancel", "refetch", "reset", "ensureData"]);

function utilsProxy(): any {
  return new Proxy(function noop() {}, {
    get(_target, prop: string) {
      if (UTILS_METHODS.has(prop)) return vi.fn(async () => undefined);
      return utilsProxy();
    },
  });
}

export function createTrpcProxy(queryResults: QueryResultOverrides, path: string[] = []): any {
  return new Proxy(function noop() {}, {
    get(_target, prop: string) {
      if (prop === "useQuery") {
        const key = path.join(".");
        return () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          isPlaceholderData: false,
          refetch: vi.fn(async () => undefined),
          ...(queryResults[key] ?? {}),
        });
      }
      if (prop === "useMutation") {
        return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, reset: vi.fn() });
      }
      if (prop === "useUtils" || prop === "useContext") return () => utilsProxy();
      return createTrpcProxy(queryResults, [...path, prop]);
    },
  });
}
