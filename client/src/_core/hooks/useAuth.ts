import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo, useState } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore network errors — proceed with client-side cleanup regardless
    }
    utils.auth.me.setData(undefined, null);
    localStorage.removeItem("manus-runtime-user-info");
    window.location.href = "/";
  }, [utils]);

  const state = useMemo(() => ({
    user: meQuery.data ?? null,
    loading: meQuery.isLoading || isLoggingOut,
    error: meQuery.error ?? null,
    isAuthenticated: Boolean(meQuery.data),
  }), [meQuery.data, meQuery.error, meQuery.isLoading, isLoggingOut]);

  // Batch 3.12：不再把完整的會員資料（auth.me）寫進 localStorage——任何程式都沒有讀取它，
  // 只是讓個資常駐在瀏覽器儲存空間。清掉舊版本留下的資料。
  useEffect(() => {
    try { localStorage.removeItem("manus-runtime-user-info"); } catch {}
  }, []);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || isLoggingOut) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    isLoggingOut,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
