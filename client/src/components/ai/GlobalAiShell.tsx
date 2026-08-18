import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MessageSquareText, Sparkles, X, ArrowRight, Loader2, Send } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiShell } from "@/contexts/AiShellContext";
import { HANDOFF_CTA_LABEL } from "@shared/ai/handoffServices";
import { FactorySearchAttachmentView } from "./FactorySearchAttachment";
import { NewsSearchAttachmentView } from "./NewsSearchAttachment";
import { SubsidyProgramsAttachmentView } from "./SubsidyProgramsAttachment";
import { NavigationAttachmentView } from "./NavigationAttachment";

/**
 * Global AI Shell（見對話中「Phase 6 UI Foundation：全站AI Shell」）：
 * app 層級、跨頁共用的右下角對話面板，取代原本掛在 FAQ 頁面內、隨路由卸載
 * 就清空的 FaqAiChatShell.tsx。這個元件本身完全不管「這是哪個 conversation」
 * ──那些狀態全部在 AiShellProvider（contexts/AiShellContext.tsx），這裡
 * 只負責畫面。
 *
 * Viewport 安全規則（見「D、Viewport 如何修正」）：
 * - 桌機：面板本身有 max-height（100dvh 扣掉上下安全邊界），永遠不會超出
 *   螢幕；只有訊息清單那一段（flex-1 + overflow-y-auto）會捲動，標題列與
 *   輸入框固定在頂部／底部不動。
 * - 手機：改成近全螢幕（inset-0 fixed），不是硬把桌機寬度的側邊欄塞進手機；
 *   輸入框固定在畫面最底部，鍵盤彈出時不會被永久遮住，訊息區塊照樣可以捲動。
 *
 * Tool Result 與 Assistant Response 的分離（見「G」）：這裡完全不自己組裝
 * 任何「找到 X 家工廠」「已經交給OXM」這類句子——那些文字全部來自
 * message.content（AI 生成），這個元件只負責把 message.attachments 裡的
 * 結構化資料渲染成卡片／按鈕（見 FactorySearchAttachmentView）。
 */
export function GlobalAiShell() {
  const {
    isOpen,
    toggleShell,
    closeShell,
    messages,
    isLoading,
    errorText,
    sendMessage,
    isCreatingHandoff,
    handleHandoffCta,
  } = useAiShell();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [isOpen, messages, isLoading]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggleShell}
        aria-label={isOpen ? "關閉 OXM AI 對話" : "開啟 OXM AI 對話"}
        className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_12px_32px_-8px_rgba(15,23,42,0.55)] transition-transform hover:scale-105 hover:bg-orange-600 sm:bottom-7 sm:right-7"
      >
        {isOpen ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <span className="relative inline-flex">
            <MessageSquareText className="size-6" aria-hidden="true" />
            <span className="absolute -right-1.5 -top-1.5 inline-flex size-4 items-center justify-center rounded-full border-2 border-slate-950 bg-purple-600">
              <Sparkles className="size-2" aria-hidden="true" />
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div
          // Viewport 修正（見對話中「Viewport 必須真正修好」）：桌機版不要用
          // 「bottom 錨定 + max-height 換算」——那種寫法只要 max-height 的計算
          // 來源被任何東西蓋掉（先前真實發生過：一個 inline style 蓋過了這裡
          // 的 class），面板就會從 bottom 往上長超過 viewport 頂端。改用
          // 「top 與 bottom 都各自用安全距離釘住」：面板高度永遠精確等於
          // viewport 高度扣掉上下安全距離，不依賴任何 max-height 換算，天生
          // 不可能超出螢幕。手機版用 inset-0（等於整個視窗），道理相同。
          className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:top-6 sm:bottom-6 sm:right-7 sm:w-[26rem] sm:max-w-[calc(100vw-3.5rem)] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-[0_24px_70px_-24px_rgba(15,23,42,0.45)]"
        >
          {/* 固定標題列，不隨訊息清單捲動 */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:rounded-t-2xl sm:pt-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                <Sparkles className="size-4" aria-hidden="true" />
              </span>
              <span className="truncate text-sm font-bold text-slate-900">OXM AI</span>
            </div>
            <button
              type="button"
              onClick={closeShell}
              aria-label="關閉 OXM AI 對話"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:hidden"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          {/* 唯一可捲動的區域：訊息清單。面板本身高度固定，不會因為訊息變多而長高。 */}
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
                <Sparkles className="size-10 opacity-30" aria-hidden="true" />
                <p className="max-w-[16rem] text-sm">跟我說說你們公司現在遇到的狀況，我幫你想想下一步。</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div className="max-w-[85%]">
                      <div
                        className={
                          message.role === "user"
                            ? "rounded-lg bg-slate-950 px-4 py-2.5 text-sm text-white"
                            : "rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-800"
                        }
                      >
                        {message.role === "assistant" ? (
                          <div className="prose prose-sm max-w-none prose-p:my-0">
                            <Streamdown>{message.content}</Streamdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        )}
                      </div>
                      {message.attachments?.map((attachment, i) =>
                        attachment.type === "factory_search_results" ? (
                          <FactorySearchAttachmentView key={i} attachment={attachment} />
                        ) : attachment.type === "news_search_results" ? (
                          <NewsSearchAttachmentView key={i} attachment={attachment} />
                        ) : attachment.type === "subsidy_programs_results" ? (
                          <SubsidyProgramsAttachmentView key={i} attachment={attachment} />
                        ) : attachment.type === "navigation_action" ? (
                          <NavigationAttachmentView key={i} attachment={attachment} />
                        ) : (
                          <div key={i} className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5">
                            <Button
                              type="button"
                              onClick={() => handleHandoffCta(attachment.serviceKey)}
                              disabled={isCreatingHandoff}
                              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                            >
                              {isCreatingHandoff ? (
                                <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                              ) : (
                                <ArrowRight className="size-4 mr-2" aria-hidden="true" />
                              )}
                              {HANDOFF_CTA_LABEL}
                            </Button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5">
                      <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden="true" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {errorText && (
            <p role="alert" className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
              {errorText}
            </p>
          )}

          {/* 固定輸入框，不隨訊息清單捲動；手機鍵盤彈出時不會被永久遮住。 */}
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="說說你現在遇到的問題……"
              className="max-h-32 min-h-9 flex-1 resize-none"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isLoading}
              className="h-[38px] w-[38px] shrink-0 bg-slate-950 hover:bg-orange-600"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
