import type { AiShellMessage } from "./AiShellContext";

/**
 * Phase 7.1（見對話中「Phase 7.1：OXM AI Core UX Production Fix」）：這裡只放
 * AiShellContext／GlobalAiShell 會用到、但不需要碰任何 React state／DOM 就能
 * 單獨驗證的純函式，讓 P1-2／P1-5／P1-6 的核心判斷邏輯可以直接寫 deterministic
 * unit test，不需要額外引入 jsdom／React Testing Library。
 */

/** P1-5：Provider-level concurrency guard。已有一個請求在飛時，禁止再送出下一個。 */
export function shouldAllowSendMessage(isSendPending: boolean): boolean {
  return !isSendPending;
}

/**
 * P1-3 Retry：新訊息一定要把使用者剛打的話加進 messages；重試失敗訊息則
 * 絕對不能再加一次——那則使用者 bubble 在第一次送出（失敗）當下就已經在
 * messages 裡了，重試只是重新呼叫 mutation，不是產生新的使用者 turn。
 */
export function appendUserMessageIfNeeded(
  messages: AiShellMessage[],
  newUserMessage: AiShellMessage,
  appendUserMessage: boolean
): AiShellMessage[] {
  return appendUserMessage ? [...messages, newUserMessage] : messages;
}

/**
 * P1-2 Smart Scroll：只有使用者本來就在「接近底部」時，新訊息才自動跟隨捲到
 * 底部；使用者往上捲看舊訊息時，不強制拉回底部。threshold 預設 120px，落在
 * 使用者建議的 80~150px 區間內。
 */
export function isScrollNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = 120
): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

/** P1-4 Textarea Auto-grow：高度只在 min／max 之間成長，超過 max 才交給內部捲動。 */
export function computeTextareaHeightPx(scrollHeightPx: number, maxHeightPx: number, minHeightPx: number): number {
  return Math.min(Math.max(scrollHeightPx, minHeightPx), maxHeightPx);
}

/**
 * Phase 7.2 E（見對話中「Focus trap」）：跟 GlobalAiShell.tsx 面板本身用的
 * Tailwind sm: 斷點（640px）一致——小於這個寬度時面板是近全螢幕的 mobile
 * sheet，比較應該限制 Tab focus 在 Shell 內；桌機浮動面板刻意不做 focus
 * trap，因為使用者可能想邊看網站邊問 AI（見「十七」，理由寫在報告，不在這裡
 * 重複整段）。
 */
export const MOBILE_FOCUS_TRAP_BREAKPOINT_PX = 640;

export function shouldTrapFocusForViewport(viewportWidthPx: number): boolean {
  return viewportWidthPx < MOBILE_FOCUS_TRAP_BREAKPOINT_PX;
}

/**
 * 純粹的「Tab 是否該被攔截並 wrap 到另一端」判斷邏輯，跟真正的 DOM 完全
 * 無關（用泛型而非 HTMLElement，方便用一般物件當替身直接單元測試）——真正
 * 呼叫端（GlobalAiShell.tsx）會傳真的 DOM 節點陣列與 document.activeElement
 * 進來。回傳 null 代表這次 Tab 不需要攔截（走瀏覽器預設行為）。
 */
export function resolveFocusTrapTarget<T>(focusableElements: T[], activeElement: T | null, shiftKey: boolean): T | null {
  if (focusableElements.length === 0) return null;
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}

/**
 * P1-6 Factory Boundary 下一步 UX：只用結構化的 attachments（不是文字）判斷
 * 「最近一筆 factory_search_results 附件在哪一則訊息」，找不到就回 null——
 * 呼叫端必須在 null 時不顯示「查看剛剛的工廠」CTA。
 */
export function findMostRecentFactorySearchMessageId(messages: AiShellMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.attachments?.some(a => a.type === "factory_search_results")) {
      return message.id;
    }
  }
  return null;
}
