/**
 * Phase 7.1 P1-1（見對話中「OXM Thinking Animation」）＋P1-1 十四（見「Processing
 * Status 不要假裝知道 LLM 內部狀態」）：這一輪的聊天請求是單一 tRPC mutation
 * （chat）串起 Layer1/Layer2/Planner/Composer，client 在收到回覆之前完全不知道
 * 最後會落在哪個 Action（找工廠／找消息／一般聊天…），沒有真實的階段性進度
 * 可以回報——所以狀態文字固定只有「正在處理」，不假裝知道細節階段，避免出現
 * 「正在分析第 3 家工廠」這種前端自己編造、跟後端實際狀態脫鉤的文字。
 *
 * Accessibility（見「十五」）：外層 aria-live="polite" 讓螢幕報讀者知道有東西
 * 正在處理；視覺用的跳動字母 aria-hidden，真正給螢幕報讀者的文字是
 * sr-only 的「OXM AI 正在處理」；prefers-reduced-motion 時字母動畫關閉（見
 * index.css 的 .oxm-thinking-letter 對應規則），改成靜止顯示。
 */
const LETTERS = ["O", "X", "M"] as const;

export function OxmThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5" aria-live="polite">
      <span className="sr-only">OXM AI 正在處理</span>
      <div className="flex items-end gap-0.5" aria-hidden="true">
        {LETTERS.map((letter, i) => (
          <span
            key={letter}
            className="oxm-thinking-letter text-sm font-bold text-orange-600"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            {letter}
          </span>
        ))}
      </div>
      <span className="text-xs text-slate-500" aria-hidden="true">
        正在處理
      </span>
    </div>
  );
}
