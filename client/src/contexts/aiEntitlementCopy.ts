/**
 * Phase 8.1（見對話中「十五：UX 要求」）：guest／no_factory／quota_exhausted
 * 三種拒絕狀態的固定文案——deterministic，不是 LLM 生成，理由同
 * aiChatErrors.ts（產品政策文案本身就該固定，也才能真正省 token）。
 */
export const AI_GUEST_DENIED_MESSAGE =
  "OXM AI 僅提供已通過審核的工廠會員使用。請先登入或註冊帳號。";

export const AI_NO_FACTORY_DENIED_MESSAGE =
  "OXM AI 目前提供已通過審核的工廠會員使用。";

/** quotaDate 目前只用來確認「今天」的額度已用盡，文案本身不需要把日期印出來。 */
export function formatQuotaExhaustedMessage(): string {
  return [
    "今天的 OXM AI 對話次數已達每日上限。",
    "額度是以工廠為單位，由工廠內所有管理者（負責人與共同管理者）共用。",
    "額度會在台灣時間每日凌晨重新計算，請明天再使用。",
  ].join("\n");
}

/**
 * Phase 12.2（見對話「三」）：kill switch 關閉時的固定文案，刻意不能跟
 * quota_exhausted 共用同一句——語意完全不同（維護中 vs 額度用完），使用者
 * 需要知道「不是我的問題／不是我用完了」。同樣不提供 Retry（見「三」：
 * 「不要把 disabled 顯示成 quota exhausted」）。
 */
export const AI_DISABLED_MESSAGE = "OXM AI 目前暫時維護中，請稍後再使用。";

/**
 * Phase 12.2（見對話「九」）：同一工廠上一輪 AI 對話還在處理中時的固定
 * 文案。跟 quota_exhausted／ai_disabled 語意都不同——這不是拒絕，是「請稍
 * 候」，但產品要求仍然不給 Retry 按鈕（見「九：不要 generic error／不要
 * Retry」），使用者等上一輪完成後自然可以再送出新訊息。
 */
export const AI_BUSY_MESSAGE = "OXM AI 正在處理上一個需求，完成後即可繼續。";

/**
 * Phase 13.0（見對話「十、十一」）：release mode = coming_soon 時的固定
 * 文案。跟 ai_disabled 語意不同——這不是「已開放但臨時故障」，是「還沒
 * 正式對外開放」，所以刻意不用「維護中」這種暗示「本來能用、現在壞了」的
 * 說法。composer 保留（disabled），placeholder 直接沿用同一句主文案的縮
 * 短版本，讓使用者一眼知道「這裡未來就是可以輸入 AI 問題的地方」（見
 * 「十一」）。
 */
export const AI_COMING_SOON_TITLE = "OXM AI";
export const AI_COMING_SOON_MAIN_MESSAGE = "OXM AI 即將開放";
export const AI_COMING_SOON_SUB_MESSAGE =
  "企業需求診斷、找工廠、政府補助與 OXM 資源導航等 AI 功能即將上線，敬請期待。";
export const AI_COMING_SOON_COMPOSER_PLACEHOLDER = "OXM AI 即將開放，敬請期待";
