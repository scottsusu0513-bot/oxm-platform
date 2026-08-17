import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { HandoffEligibleServiceKey } from "@shared/ai/handoffServices";

/**
 * 讀取 URL 上的 ?aih= token，查詢對應的 AI handoff context，並管理 Blocking
 * Modal 的顯示/acknowledge 狀態（見對話中「十四、十五」）。
 *
 * 一般直接進表單完全不會帶這個參數，這個 hook 在 token 不存在時所有欄位
 * 都是安全的空/false 值，不影響一般入口的行為（見「七、一般入口完全不能被
 * 改壞」）。
 */
export function useAiHandoff(expectedServiceKey: HandoffEligibleServiceKey) {
  const token = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("aih");
  }, []);

  const query = trpc.ai.getHandoffContext.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const acknowledgeMutation = trpc.ai.acknowledgeHandoff.useMutation();
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  const context = query.data ?? null;
  const isRightService = !!context && context.serviceKey === expectedServiceKey;

  // react-query 回傳的 context 物件參照在資料沒變時是穩定的，這裡用 useMemo
  // 再包一層，確保 prefillData／confirmedFields 的物件參照只在真正的資料
  // 內容改變時才變動——表單頁的預填 useEffect 是拿這兩個值當 dependency，
  // 參照穩定才能保證「只在資料真的準備好那一刻觸發一次」，不會因為每次
  // render 都產生新的 {} 字面量而多次觸發或誤判成資料還沒到（見對話中
  // 「七、特別驗證 React effect ordering」）。
  const prefillData = useMemo<Record<string, unknown>>(
    () => (isRightService ? (context!.prefillData as Record<string, unknown>) : {}),
    [isRightService, context]
  );
  const confirmedFields = useMemo<Record<string, { sourceFact: string }>>(
    () => (isRightService ? (context!.confirmedFields as Record<string, { sourceFact: string }>) : {}),
    [isRightService, context]
  );

  // 已經 acknowledge 過（這次 session 剛按過，或先前按過、refresh 後從
  // server 讀到 acknowledgedAt）就不再顯示 Modal，避免每次 refresh 都煩
  // 使用者一次。
  const alreadyAcknowledged = !!context?.acknowledgedAt;
  const showModal = !!token && !query.isLoading && isRightService && !alreadyAcknowledged && !dismissedThisSession;

  function acknowledge() {
    if (!token) return;
    acknowledgeMutation.mutate(
      { token },
      { onSuccess: () => setDismissedThisSession(true) }
    );
  }

  return {
    token,
    hasHandoff: !!token && isRightService,
    prefillData,
    confirmedFields,
    showModal,
    acknowledge,
    isAcknowledging: acknowledgeMutation.isPending,
  };
}
