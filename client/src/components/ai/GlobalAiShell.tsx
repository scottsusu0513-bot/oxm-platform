import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Sparkles,
  X,
  ArrowRight,
  ArrowUp,
  Loader2,
  Send,
  RotateCcw,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiShell } from "@/contexts/AiShellContext";
import { HANDOFF_CTA_LABEL } from "@shared/ai/handoffServices";
import { getNavigationEntry } from "@shared/ai/navigationRegistry";
import {
  AI_GUEST_DENIED_MESSAGE,
  AI_NO_FACTORY_DENIED_MESSAGE,
  AI_COMING_SOON_MAIN_MESSAGE,
  AI_COMING_SOON_SUB_MESSAGE,
  AI_COMING_SOON_COMPOSER_PLACEHOLDER,
} from "@/contexts/aiEntitlementCopy";
import LoginDialog from "@/components/LoginDialog";
import { FactorySearchAttachmentView } from "./FactorySearchAttachment";
import { NewsSearchAttachmentView } from "./NewsSearchAttachment";
import { SubsidyProgramsAttachmentView } from "./SubsidyProgramsAttachment";
import { NavigationAttachmentView } from "./NavigationAttachment";
import { GovSubsidyRecommendationAttachmentView } from "./GovSubsidyRecommendationAttachment";
import { OxmThinkingIndicator } from "./OxmThinkingIndicator";
import {
  isScrollNearBottom,
  computeTextareaHeightPx,
  shouldTrapFocusForViewport,
  resolveFocusTrapTarget,
} from "@/contexts/aiShellHelpers";

const TEXTAREA_MIN_HEIGHT_PX = 36; // 對應既有 min-h-9
const TEXTAREA_MAX_HEIGHT_PX = 128; // 對應既有 max-h-32

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(el => el.offsetParent !== null);
}

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
    closeShell,
    messages,
    isLoading,
    errorText,
    sendMessage,
    retryLastMessage,
    isCreatingHandoff,
    handleHandoffCta,
    entitlement,
  } = useAiShell();
  const [, navigate] = useLocation();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Phase 7.2 E（見對話中「十六、Focus」）：只用來偵測「這次 render 是不是
  // isOpen 剛從 false 變 true／true 變 false」，不驅動任何渲染。關閉時
  // focus 回開關按鈕本身這段邏輯，Phase 7.4 已經搬到 AiLauncherButton.tsx
  // 自己管理（見該檔說明：按鈕現在是獨立元件，有自己的 ref，不需要再跨
  // 元件傳遞）；這裡只保留跟面板本身有關的「開啟時 focus composer」。
  const wasOpenRef = useRef(false);
  // Phase 7.1 P1-2（見對話中「Smart Scroll」）：預設 true（第一次開啟、或還沒
  // 捲動過視為在底部），只有使用者主動往上捲超過門檻才變 false；用 ref 而非
  // state，純粹是 scroll handler 高頻觸發時的效能考量，不需要因此重新渲染。
  const nearBottomRef = useRef(true);

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = isScrollNearBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight
    );
  }

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current;
    if (!el) return;
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [isOpen, messages, isLoading]);

  // Phase 7.1 P1-4（見對話中「Textarea Auto-grow」）：輸入內容變化時重新量測
  // scrollHeight 並夾在 min／max 之間；先設回 auto 才能量到「內容真正需要的
  // 高度」（不這樣做，scrollHeight 只會單調遞增，永遠量不回變短之後的高度）。
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${computeTextareaHeightPx(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX, TEXTAREA_MIN_HEIGHT_PX)}px`;
  }, [input]);

  // Phase 7.2 E（見對話中「十六、Focus」）：開啟時 focus composer，關閉時
  // focus 回開關按鈕本身，避免使用者用鍵盤操作完之後 focus 憑空消失。手機／
  // 觸控裝置刻意不 autofocus——那會立刻叫出虛擬鍵盤，使用者根本還沒決定要
  // 打字（見「不要做會讓 mobile keyboard 自動跳出造成困擾的行為」），用
  // `pointer: fine`（滑鼠／觸控板）而不是螢幕寬度判斷，才是真正對應「這個
  // 裝置有沒有精準指標」，不是螢幕大小本身。
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const prefersFinePointer =
        typeof window !== "undefined" &&
        window.matchMedia("(pointer: fine)").matches;
      if (prefersFinePointer) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  /**
   * Phase 7.2 E（見對話中「十五、Escape 行為」「十七、Focus trap」）：
   * - Escape：這個 onKeyDown 掛在面板自己的 DOM 子樹上（不是 window 全域
   *   listener），只有事件真的從面板內部（composer／卡片／按鈕）冒泡上來時
   *   才會觸發。AiHandoffModal 這類 Radix Dialog 是透過 portal 掛在
   *   document.body 底下、不是這個面板的 DOM 後代，使用者 focus 在那個
   *   blocking modal 裡按 Escape 時，事件根本不會冒泡進這個 handler，天生
   *   不會「穿透」去關掉 AI Shell（不需要額外的 document.querySelector
   *   判斷）。
   * - Tab：只在 mobile（面板本身是近全螢幕 sheet）才攔截並 wrap，桌機浮動
   *   面板刻意不做 focus trap（見「十七」原則，理由見報告 O 節）。
   */
  function handlePanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      closeShell();
      return;
    }
    if (e.key !== "Tab") return;
    if (!shouldTrapFocusForViewport(window.innerWidth)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = getFocusableElements(panel);
    const target = resolveFocusTrapTarget(
      focusable,
      document.activeElement as HTMLElement | null,
      e.shiftKey
    );
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Phase 13.0（見對話「七、十一」）：即使 disabled composer 理論上不可能
    // 被送出（textarea／button 都是 disabled），這裡仍然多一層 client-side
    // 防呆，不依賴 disabled 屬性作為唯一保護——真正的權威判斷仍在
    // server 端 ai.chat 的 release mode gate。
    if (entitlement?.kind === "coming_soon") return;
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    // 使用者主動送出新訊息：這是明確的新互動，即使剛才在往上看舊訊息，也要
    // 合理捲到底部看到自己剛送出的內容（見「十八」）。
    nearBottomRef.current = true;
    sendMessage(trimmed);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function scrollToMessage(messageId: string) {
    document
      .getElementById(`ai-msg-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!isOpen) return null;

  // Phase 8.1（見對話中「一、entitlement」「十五：UX 要求」）：entitlement
  // undefined 代表 query 還沒回來（面板剛打開的短暫瞬間），避免這段時間閃現
  // 一般聊天輸入框；guest／no_factory 完全不顯示訊息清單與輸入框，改成固定
  // 文案 + CTA（不是聊天訊息，是整個面板內容）。
  const isEntitlementLoading = entitlement === undefined;
  const isGated = entitlement?.kind === "guest" || entitlement?.kind === "no_factory";
  // Phase 13.0（見對話「十三」）：coming_soon 比 guest/no_factory 更外層——
  // 一律先看到「敬請期待」，不揭露任何 entitlement 細節。composer 保留
  // （disabled），跟 isGated 完全不顯示 composer 是刻意不同的兩種畫面（見
  // 「十一」）。
  const isComingSoon = entitlement?.kind === "coming_soon";
  const factoryRegisterEntry = getNavigationEntry("factory_register");

  return (
    <>
    <div
      ref={panelRef}
      onKeyDown={handlePanelKeyDown}
      role="dialog"
      aria-modal="false"
      aria-label="OXM AI 對話"
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
          <span className="truncate text-sm font-bold text-slate-900">
            OXM AI
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Phase 8.1（見對話中「十五：quota 顯示要簡單，不顯示 token／金額」）：
              只有已審核工廠成員才有 quota；admin bypass、guest／no_factory 不顯示。 */}
          {entitlement?.kind === "factory_member" && entitlement.quota && (
            <span className="text-xs tabular-nums text-slate-400">
              {entitlement.quota.used}/{entitlement.quota.limit}
            </span>
          )}
          <button
            type="button"
            onClick={closeShell}
            aria-label="關閉 OXM AI 對話"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {isEntitlementLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-slate-300" aria-hidden="true" />
        </div>
      ) : isGated ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <Sparkles className="size-10 text-slate-300" aria-hidden="true" />
          <p className="max-w-[18rem] whitespace-pre-wrap break-words text-sm text-slate-600">
            {entitlement?.kind === "guest" ? AI_GUEST_DENIED_MESSAGE : AI_NO_FACTORY_DENIED_MESSAGE}
          </p>
          {entitlement?.kind === "guest" ? (
            <Button
              type="button"
              onClick={() => setLoginDialogOpen(true)}
              className="bg-slate-950 hover:bg-orange-600"
            >
              登入 / 註冊
            </Button>
          ) : factoryRegisterEntry ? (
            <Button
              type="button"
              onClick={() => navigate(factoryRegisterEntry.route)}
              className="bg-slate-950 hover:bg-orange-600"
            >
              前往{factoryRegisterEntry.title}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
      {isComingSoon ? (
        // Phase 13.0（見對話「十」）：coming_soon 固定畫面，取代正常訊息清單
        // ——不列太多功能、不寫 Beta、不寫「正在測試」（見「十」的明確指示）。
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Sparkles className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold text-slate-900">{AI_COMING_SOON_MAIN_MESSAGE}</p>
          <p className="max-w-[18rem] whitespace-pre-wrap break-words text-sm text-slate-500">
            {AI_COMING_SOON_SUB_MESSAGE}
          </p>
        </div>
      ) : (
      /* 唯一可捲動的區域：訊息清單。面板本身高度固定，不會因為訊息變多而長高。 */
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
            <Sparkles className="size-10 opacity-30" aria-hidden="true" />
            <p className="max-w-[16rem] text-sm">
              跟我說說你們公司現在遇到的狀況，我幫你想想下一步。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map(message => (
              <div
                key={message.id}
                id={`ai-msg-${message.id}`}
                className={
                  message.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
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
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    )}
                  </div>
                  {message.attachments?.map((attachment, i) =>
                    attachment.type === "factory_search_results" ? (
                      <FactorySearchAttachmentView
                        key={i}
                        attachment={attachment}
                      />
                    ) : attachment.type === "news_search_results" ? (
                      <NewsSearchAttachmentView
                        key={i}
                        attachment={attachment}
                      />
                    ) : attachment.type === "subsidy_programs_results" ? (
                      <SubsidyProgramsAttachmentView
                        key={i}
                        attachment={attachment}
                      />
                    ) : attachment.type === "navigation_action" ? (
                      <NavigationAttachmentView
                        key={i}
                        attachment={attachment}
                      />
                    ) : attachment.type === "gov_subsidy_recommendation" ? (
                      <GovSubsidyRecommendationAttachmentView
                        key={i}
                        attachment={attachment}
                      />
                    ) : (
                      <div
                        key={i}
                        className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5"
                      >
                        <Button
                          type="button"
                          onClick={() =>
                            handleHandoffCta(attachment.serviceKey)
                          }
                          disabled={isCreatingHandoff}
                          className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                        >
                          {isCreatingHandoff ? (
                            <Loader2
                              className="size-4 mr-2 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <ArrowRight
                              className="size-4 mr-2"
                              aria-hidden="true"
                            />
                          )}
                          {HANDOFF_CTA_LABEL}
                        </Button>
                      </div>
                    )
                  )}
                  {/* Phase 7.1 P1-6：只有 Boundary 這一輪、且真的找得到較早的
                          factory_search_results 附件時才會有這個欄位。 */}
                  {message.boundaryFactoryRefMessageId && (
                    <button
                      type="button"
                      onClick={() =>
                        scrollToMessage(message.boundaryFactoryRefMessageId!)
                      }
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      <ArrowUp className="size-3" aria-hidden="true" />
                      查看剛剛的工廠
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <OxmThinkingIndicator />
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!isComingSoon && errorText && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-2 border-t border-red-200 bg-red-50 px-4 py-2"
        >
          <p className="text-xs text-red-700">{errorText}</p>
          <button
            type="button"
            onClick={retryLastMessage}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800 hover:underline"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            再試一次
          </button>
        </div>
      )}

      {/* 固定輸入框，不隨訊息清單捲動；手機鍵盤彈出時不會被永久遮住。 */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl"
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isComingSoon}
          placeholder={isComingSoon ? AI_COMING_SOON_COMPOSER_PLACEHOLDER : "說說你現在遇到的問題……"}
          className="max-h-32 min-h-9 flex-1 resize-none overflow-y-auto"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isComingSoon || !input.trim() || isLoading}
          className="h-[38px] w-[38px] shrink-0 bg-slate-950 hover:bg-orange-600"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </Button>
      </form>
        </>
      )}
    </div>
    <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </>
  );
}
