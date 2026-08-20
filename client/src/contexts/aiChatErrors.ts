import { TRPCClientError } from "@trpc/client";

/**
 * Phase 7.2（見對話中「F：Error UX differentiation」）：只做「少量分類」，
 * 不建立完整 error taxonomy（見「二十」）。這裡刻意不把 error.message 顯示
 * 給使用者——不管這次 tRPC error 的 message 內容是什麼（可能包含 DB／
 * provider 內部細節），一律回傳這裡固定的安全文字，raw 內容只留在
 * console.error／server log（見「二十一：錯誤文字不能洩漏 server detail」）。
 *
 * 「Factory/News/Subsidy resource action failure」這個類別，在目前架構下沒有
 * 對應的即時訊號可以分辨：server 端 runPersistentAiChat／runAiChat 把
 * Factory／News／Subsidy 搜尋失敗跟 Layer 2 routing 失敗都吸收進同一個
 * try/catch，優雅降級成 Layer 1 fallback 回覆（見 server/ai/chatService.ts），
 * 根本不會讓這個錯誤拋到 client——這是既有、刻意的架構決策，不是這輪的
 * 缺口，所以這裡沒有做出一個永遠不會被觸發的假分類。
 */
export function resolveChatErrorMessage(error: unknown): string {
  if (isLikelyNetworkFailure(error)) {
    return "連線逾時，請確認網路後再試一次。";
  }
  return "OXM AI 暫時無法回應，請再試一次。";
}

/** Handoff 建立失敗只有一種使用者可見的情境，不需要再細分（見「二十二」）。 */
export function resolveHandoffErrorMessage(_error: unknown): string {
  return "目前無法開啟詢問表單，請再試一次。";
}

/**
 * tRPC 的 TRPCClientError 在「根本沒有從 server 收到一個真正的 RPC 回應」
 * （fetch 失敗、逾時、CORS、離線）時，`data` 是 undefined／null；只要 server
 * 有回應（即使是 500 / TRPCError），`data` 就會是一個真正的物件（至少帶
 * code／httpStatus）。這是 TRPCClientError 本身的結構性訊號，不是猜字串
 * （見 @trpc/client 原始碼：`this.data = opts?.result?.error.data`）。
 */
function isLikelyNetworkFailure(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  return error.data == null;
}
