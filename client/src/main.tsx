import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink, TRPCClientError } from "@trpc/client";
import { MAX_SEARCH_CALLS_PER_BATCH, SEARCH_PROCEDURE_PATH } from "@shared/searchBatch";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { performLogin } from "./const";
import { installChunkReloadHandler } from "./lib/chunkReload";
import "./index.css";

// 必須在任何 lazy route 載入前註冊，見 client/src/lib/chunkReload.ts。
installChunkReloadHandler();

// window.__showOxmApp 定義在 client/index.html（同一份一次性函式也給 5 秒
// fallback 呼叫），這裡不重複寫一份 DOM 操作，避免兩套流程各自維護、互相
// 競態或以後改邏輯只改到其中一邊。
declare global {
  interface Window {
    __showOxmApp?: () => void;
  }
}

// GEO 預渲染的裸文字（client/index.html 的 #app-loading + inline <style> 已把
// #root 預設隱藏）要在 React 真正完成首次掛載後才能拿掉，不能用固定的
// setTimeout 猜時間——太早拿掉等於白做，太晚又會多等。掛在跟 <App/> 同一棵
// render 樹下、緊鄰的一個空節點，靠 useEffect 只在 mount 後才觸發一次的特性，
// 保證這一刻 React 已經把整棵初始樹（包含 <App/>）commit 進 DOM。
function AppReadySignal() {
  useEffect(() => {
    window.__showOxmApp?.();
  }, []);

  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 資料在 60 秒內視為新鮮，不重新打 API
      staleTime: 60 * 1000,
      // 視窗重新聚焦時不自動 refetch（切分頁回來不重打）
      refetchOnWindowFocus: false,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  performLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    // auth.me returning UNAUTHORIZED is expected when logged out — don't auto-redirect
    const queryPath = event.query.queryKey[0];
    const isAuthMe = Array.isArray(queryPath) && queryPath[0] === "auth" && queryPath[1] === "me";
    if (!isAuthMe) redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
  });

// factory.search 走獨立的批次連線，單一 HTTP 請求最多 MAX_SEARCH_CALLS_PER_BATCH
// 個搜尋（server 端 searchBatchGuard 超過即回 400）——手機「返回恢復」一次補回
// 多頁時會自動拆成多個請求。其他 procedure 的批次行為完全不變。
const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.path === SEARCH_PROCEDURE_PATH,
      true: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        maxItems: MAX_SEARCH_CALLS_PER_BATCH,
        fetch: trpcFetch,
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch: trpcFetch,
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <AppReadySignal />
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
