import { useState, type FormEvent } from "react";
import { MessageSquareText, Send, Sparkles } from "lucide-react";
import { FAQ_AI_ENTRY_CONTENT } from "@shared/content/faqAiEntry";
import { AiCompanionIllustration } from "@/components/faq/FaqEditorialIllustrations";
import { AI_COMING_SOON_COMPOSER_PLACEHOLDER } from "@/contexts/aiEntitlementCopy";

/**
 * FAQ 頁「AI 問答入口」——使用者在這裡輸入的第一句問題會交給 App 層級共用的
 * Global AI Shell（client/src/components/ai/GlobalAiShell.tsx，狀態在
 * contexts/AiShellContext.tsx）當成第一則訊息，後續整段對話都在那個右下角
 * 浮動視窗進行——這裡的輸入框本身不承載聊天紀錄，避免 FAQ 頁面因為對話越聊
 * 越長。
 *
 * 標題／說明文字放在 shared/content/faqAiEntry.ts，供這裡與
 * scripts/prerender-faq.ts 共用同一份文字，不直接寫死兩份。
 *
 * Phase 13.0（見對話「十一、十三」）：comingSoon 由 AiShellContext 的
 * isAiComingSoon（server-authoritative，來源是 OXM_AI_RELEASE_MODE）決定，
 * 這裡不自己判斷、不建立第二套 frontend flag。coming_soon 時 input／button
 * 都是 disabled，handleSubmit 在呼叫 onAskAi 之前就短路——不打開 Global AI
 * Shell、不 navigate、不建立任何 draft question。文案沿用 GlobalAiShell 同一
 * 套 aiEntitlementCopy.ts 常數，不另外寫一份。
 */
export interface FaqAiEntryProps {
  onAskAi: (question: string) => void;
  comingSoon: boolean;
}

export function FaqAiEntry({ onAskAi, comingSoon }: FaqAiEntryProps) {
  const [question, setQuestion] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // coming_soon 時整個表單本身也已經是 disabled（input／button 都無法互動，
    // Enter 也就無從觸發 submit），這裡多一層防呆，不單獨依賴 disabled 屬性。
    if (comingSoon) return;
    const trimmed = question.trim();
    if (!trimmed) return;

    onAskAi(trimmed);
    setQuestion("");
  }

  return (
    <section
      aria-labelledby="faq-ai-entry-title"
      className="bg-[#fcfbf9] px-4 py-10 sm:py-14 lg:py-16"
    >
      <div className="container">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_55px_-38px_rgba(15,23,42,0.45)] sm:rounded-3xl">
          <div className="absolute inset-x-0 top-0 flex h-1" aria-hidden="true">
            <span className="w-2/3 bg-orange-500" />
            <span className="w-1/3 bg-purple-600" />
          </div>
          <AiCompanionIllustration className="pointer-events-none absolute bottom-1 right-1 w-24 rotate-[-5deg] opacity-25 sm:right-3 sm:w-28 sm:opacity-35 lg:bottom-2 lg:left-[42%] lg:right-auto lg:w-28 lg:opacity-60" />
          <div className="grid gap-7 px-5 py-7 sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-center lg:gap-12 lg:px-12 lg:py-11">
            <div>
              <div className="mb-5 flex items-center gap-3">
                <span className="relative inline-flex size-11 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600">
                  <MessageSquareText className="size-5" aria-hidden="true" />
                  <span className="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-full border-2 border-white bg-purple-600 text-white">
                    <Sparkles className="size-2.5" aria-hidden="true" />
                  </span>
                </span>
                <span className="text-xs font-bold tracking-[0.16em] text-slate-400">OXM AI</span>
              </div>
              <h2 id="faq-ai-entry-title" className="break-words text-xl font-bold leading-snug tracking-[-0.02em] text-slate-950 sm:text-2xl">
                {FAQ_AI_ENTRY_CONTENT.title}
              </h2>
              <p className="mt-3 max-w-lg break-words text-sm leading-7 text-slate-600 sm:text-[15px]">
                {FAQ_AI_ENTRY_CONTENT.description}
              </p>
            </div>

            <div>
              <form onSubmit={handleSubmit} className="rounded-xl bg-slate-100 p-2 sm:flex sm:items-center sm:gap-2 sm:rounded-2xl">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={comingSoon ? AI_COMING_SOON_COMPOSER_PLACEHOLDER : "例如：我們工廠最近訂單減少，應該先找新市場還是先做內部轉型？"}
                  aria-label={FAQ_AI_ENTRY_CONTENT.title}
                  disabled={comingSoon}
                  className="min-h-12 w-full min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:min-h-14 sm:rounded-xl sm:text-[15px]"
                />
                <button
                  type="submit"
                  disabled={comingSoon}
                  className="mt-2 inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:hover:bg-slate-300 sm:mt-0 sm:min-h-14 sm:w-auto sm:rounded-xl"
                >
                  送出問題
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </form>
              {comingSoon && (
                <p className="mt-3 break-words text-xs leading-6 text-slate-400">
                  未來可直接向 OXM AI 詢問工廠媒合、企業轉型與平台使用問題。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
