import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import type { FactorySearchCandidateForUi } from "@/components/ai/FactorySearchAttachment";
import type { NewsSearchCandidateForUi } from "@/components/ai/NewsSearchAttachment";
import type { SubsidyProgramCandidateForUi } from "@/components/ai/SubsidyProgramsAttachment";
import type { GovSubsidyRecommendationForUi } from "@/components/ai/GovSubsidyRecommendationAttachment";
import { findMostRecentFactorySearchMessageId, appendUserMessageIfNeeded } from "./aiShellHelpers";
import { AiChatSendController } from "./aiChatSendController";
import { resolveChatErrorMessage, resolveHandoffErrorMessage } from "./aiChatErrors";
import { AI_GUEST_DENIED_MESSAGE, AI_NO_FACTORY_DENIED_MESSAGE, formatQuotaExhaustedMessage, AI_DISABLED_MESSAGE, AI_BUSY_MESSAGE, AI_COMING_SOON_MAIN_MESSAGE } from "./aiEntitlementCopy";

/**
 * Phase 6 UI Foundation（見對話中「全站AI Shell」）：OXM AI 是 app 層級、
 * 全站共用的右下角對話層，不是 FAQ 頁面內部的元件——這個 Context 掛在
 * App.tsx（Router 的手足層級），只要使用者還留在 OXM 這個 SPA session 內，
 * 站內路由切換就不會讓 Provider 卸載，訊息／conversationId／開關狀態全部
 * 自然沿用（見「conversation 沒有真正被保留」的根因：舊版狀態掛在
 * FAQ.tsx／FaqAiChatShell.tsx 身上，離開 /faq 就被卸載歸零）。
 *
 * Conversation 生命週期完全不變（見對話中「明確排除的範圍」）：這裡只是把
 * 「站內路由切換」重新定義成「不是 session 結束」，真正的 session 邊界
 * （整頁 refresh／重新進站／閒置逾時）仍然由既有 server 端 conversation
 * lifecycle（finalize → summarize → Enterprise Memory → 刪除原文）決定——
 * conversationIdRef／messages 都只存在瀏覽器記憶體，一旦真正 refresh，
 * React 整個重新掛載，這個 Provider 也會重新建立，狀態自然歸零，行為跟
 * 舊版 FaqAiChatShell.tsx 完全一樣，只是「歸零的時機」從「離開 /faq」改成
 * 「真正離開這個瀏覽 session」。
 */

export type AiShellAttachment =
  | {
      type: "factory_search_results";
      candidates: FactorySearchCandidateForUi[];
      total: number;
      viewAllUrl: string;
    }
  | {
      type: "news_search_results";
      candidates: NewsSearchCandidateForUi[];
      total: number;
      viewAllUrl: string;
    }
  | {
      type: "subsidy_programs_results";
      candidates: SubsidyProgramCandidateForUi[];
      totalActiveCount: number;
      viewAllUrl: string;
    }
  | {
      type: "navigation_action";
      key: string;
      title: string;
      route: string;
    }
  | {
      type: "handoff_offer";
      serviceKey: string;
      displayName: string;
    }
  | ({ type: "gov_subsidy_recommendation" } & GovSubsidyRecommendationForUi);

export interface AiShellMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * Tool Result 只以「這一輪 assistant 訊息的附件」形式存在，不是頁面全域的
   * 常駐搜尋區塊（見對話中「G、Factory Cards 如何成為 assistant 訊息的附件」）
   * ——不落地任何新 DB 欄位，純粹沿用 tRPC 這次呼叫本來就回傳的
   * factorySearchResult／handoffOffer，只是換成掛在 client 這個訊息物件上。
   */
  attachments?: AiShellAttachment[];
  /**
   * Phase 7.1 P1-6（見對話中「Factory Boundary 下一步 UX」）：只有 Factory
   * Result Boundary 這一輪、且對話中真的存在較早的 factory_search_results
   * 附件時才有值——指向那則較早訊息的 id，GlobalAiShell 用它渲染「查看剛剛的
   * 工廠」CTA 並 scroll 過去，不生成任何 URL、不重新 render 卡片。
   */
  boundaryFactoryRefMessageId?: string;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `ai-msg-${messageIdCounter}`;
}

/**
 * Phase 8.1（見對話中「一、entitlement」）：server-authoritative 的使用資格
 * 判斷結果，純轉發 ai.entitlementStatus 這支 query 的回傳值，不在前端另外
 * 猜測或快取一份平行邏輯。quota 只有 factory_member 才有值（admin bypass、
 * guest／no_factory 用不到）。
 */
export interface AiShellEntitlement {
  // Phase 12.2（見對話「三」）："disabled" 是 kill switch 關閉時的提前 UX
  // 訊號（server-side gate 的權威判斷仍然在 ai.chat mutation 本身，這裡只是
  // 讓面板打開當下就能提前反映，避免使用者送出後才被擋下來）。
  // Phase 13.0（見對話「八、十三」）："coming_soon" 是產品發布狀態，比
  // guest/no_factory/disabled 更外層——coming_soon 時不需要、也不應該
  // 揭露任何 entitlement 細節，一律先看到「敬請期待」。
  kind: "guest" | "no_factory" | "factory_member" | "admin" | "disabled" | "coming_soon";
  factoryId?: number | null;
  factoryName?: string | null;
  quota?: { limit: number; used: number; remaining: number; exhausted: boolean; quotaDate: string } | null;
}

interface AiShellContextValue {
  isOpen: boolean;
  openShell: () => void;
  closeShell: () => void;
  toggleShell: () => void;
  messages: AiShellMessage[];
  isLoading: boolean;
  errorText: string | null;
  sendMessage: (content: string) => void;
  /**
   * Phase 7.1 P1-3（見對話中「Retry」）：只在上一次 chat mutation 真正失敗時
   * 有意義；重送失敗的那則使用者訊息，不會在 messages 裡新增第二個使用者
   * bubble（那則使用者 bubble 在原本送出當下就已經加入了）。errorText 還在
   * 代表這一輪失敗、可以重試；沒有失敗紀錄時安全 no-op。
   */
  retryLastMessage: () => void;
  /** FaqAiEntry 這類「入口」元件專用：開啟 Global AI Shell 並直接送出這句問題。 */
  askQuestion: (question: string) => void;
  isCreatingHandoff: boolean;
  handleHandoffCta: (serviceKey: string) => void;
  /** Phase 8.1：undefined 代表還在載入中（面板剛開啟、query 還沒回來）。 */
  entitlement: AiShellEntitlement | undefined;
  /**
   * Phase 13.0 FAQ 入口：跟 entitlement 不同，不受面板是否打開限制，給
   * FaqAiEntry 這類「入口」元件在使用者互動之前就先畫出 disabled 狀態用。
   * 載入中也回傳 true（安全預設）。
   */
  isAiComingSoon: boolean;
}

const AiShellContext = createContext<AiShellContextValue | null>(null);

export function AiShellProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AiShellMessage[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  // 只存在記憶體：站內路由切換／同一 session 內收合再打開都沿用同一個
  // conversationId（component 不會因為換頁而卸載）；真正 refresh 才會歸零。
  const conversationIdRef = useRef<number | null>(null);

  const chatMutation = trpc.ai.chat.useMutation();
  const createHandoffMutation = trpc.ai.createHandoff.useMutation();
  // Phase 8.1：只在面板真的打開過之後才查（大多數訪客／一般使用者根本不會
  // 打開面板，沒必要每一頁都打這支 query）；每次成功／被拒的 turn 之後都會
  // refetch，讓「13/20」這類顯示保持最新（見下方 onSuccess）。
  const entitlementQuery = trpc.ai.entitlementStatus.useQuery(undefined, { enabled: isOpen });
  // Phase 13.0 FAQ 入口：跟 entitlementQuery 不同，這支不受 isOpen 限制——
  // FaqAiEntry 這類「面板還沒打開就要先畫出 disabled 狀態」的入口元件，需要
  // 在使用者互動之前就知道是不是 coming_soon（見 server/routers.ts 的
  // ai.releaseMode 註解：極輕量、不查 DB，可以放心每頁都查一次）。
  const releaseModeQuery = trpc.ai.releaseMode.useQuery();
  // 載入中（releaseModeQuery.data 還沒回來）一律視同 coming_soon——安全預設
  // 是先擋住，不要在還不確定的當下先讓使用者看到能互動的輸入框。
  const isAiComingSoon = releaseModeQuery.data?.mode !== "live";

  // Phase 8.1（見對話中「五、十：P0 retry 去重」）：同一個 user-visible turn
  // 的第一次送出與所有 retry 必須共用同一個 clientTurnId，但這個 class
  // （AiChatSendController）本身是 transport-agnostic 的通用重送/並發保護
  // 邏輯，不應該知道「clientTurnId」這種 AI-quota 專屬概念。retry 時
  // performSend 會用「完全相同」的 content／priorMessages 物件重新呼叫
  // transport，所以用「priorMessages.length + content」當穩定 key：同一次
  // retry 這個 key 不變、沿用同一個 id；真正的新訊息因為 priorMessages 長度
  // 已經變了，會產生新的 id。
  const lastClientTurnIdRef = useRef<{ key: string; id: string } | null>(null);
  function resolveClientTurnId(content: string, priorMessages: AiShellMessage[]): string {
    const key = `${priorMessages.length}:${content}`;
    if (lastClientTurnIdRef.current?.key === key) return lastClientTurnIdRef.current.id;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    lastClientTurnIdRef.current = { key, id };
    return id;
  }

  // Phase 7.2（見對話中「B：Retry 真實端到端驗證」「C：Provider concurrency
  // 真實驗證」）：guard／retry 的實際狀態機搬進 AiChatSendController（見該檔
  // 說明），這裡只需要建立唯一一個 instance（整個 Provider 生命週期只建一次，
  // 用 useRef 存），並把 trpc mutation／React state setter 包成 callbacks
  // 餵進去——UI 可見的行為（哪些欄位、什麼時候顯示 CTA）完全沒有改變，只是
  // guard／retry 本身現在是一個可以獨立用 integration test 驗證的 class。
  //
  // transport 用 ref 間接呼叫（sendTransportRef.current 每次 render 都更新
  // 成最新的 closure），是因為 controller instance 本身只建立一次，但
  // isAuthenticated／conversationIdRef 這些值必須讀「當下最新」的，不能被
  // 第一次 render 的 closure 卡住。
  const sendTransportRef = useRef<
    ((content: string, priorMessages: AiShellMessage[]) => ReturnType<typeof chatMutation.mutateAsync>) | undefined
  >(undefined);
  sendTransportRef.current = (content, priorMessages) =>
    chatMutation.mutateAsync({
      message: content,
      clientTurnId: resolveClientTurnId(content, priorMessages),
      conversationId: isAuthenticated ? conversationIdRef.current ?? undefined : undefined,
      // 已登入使用者不需要、也不被信任傳歷史，伺服器自己從 DB 讀；只有
      // 訪客（無狀態）才需要靠這個欄位延續對話。
      guestHistory: isAuthenticated
        ? undefined
        : priorMessages.map(m => ({ role: m.role, content: m.content })),
    });

  const controllerRef = useRef<AiChatSendController<Awaited<ReturnType<typeof chatMutation.mutateAsync>>> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AiChatSendController({
      send: (content, priorMessages) => sendTransportRef.current!(content, priorMessages),
      onBeforeSend: (content, priorMessages, isRetry) => {
        setErrorText(null);
        // 只有「新訊息」才把使用者剛打的話加進 messages；retry 呼叫時
        // isRetry 是 true，那則使用者 bubble 在第一次送出（失敗）當下就已經
        // 在目前的 messages state 裡了，這裡完全不動 setMessages，避免把它
        // 從畫面上重置掉（見 appendUserMessageIfNeeded 的說明）。
        if (!isRetry) {
          const userMessage: AiShellMessage = { id: nextMessageId(), role: "user", content };
          setMessages(prev => appendUserMessageIfNeeded(prev, userMessage, true));
        }
      },
      onSuccess: (result, priorMessages) => {
        // Phase 8.1：這是 tRPC 呼叫本身成功、但 server-authoritative 判斷
        // 這一輪不被允許（entitlement 在面板打開當下就該擋掉大部分情況，這裡
        // 是 race condition 的防禦：例如同一段對話中途額度被別的共同管理者
        // 用完）。固定文案顯示成一則 assistant 訊息，不當成傳輸層錯誤（不會
        // 顯示「再試一次」——重試在 quota_exhausted 下只會得到同樣的結果）。
        void entitlementQuery.refetch();
        if (result.status === "denied") {
          const content =
            result.reason === "guest" ? AI_GUEST_DENIED_MESSAGE :
            result.reason === "no_factory" ? AI_NO_FACTORY_DENIED_MESSAGE :
            result.reason === "ai_disabled" ? AI_DISABLED_MESSAGE :
            result.reason === "ai_busy" ? AI_BUSY_MESSAGE :
            result.reason === "coming_soon" ? AI_COMING_SOON_MAIN_MESSAGE :
            formatQuotaExhaustedMessage();
          setMessages(prev => [...prev, { id: nextMessageId(), role: "assistant", content }]);
          return;
        }
        if (result.conversationId != null) conversationIdRef.current = result.conversationId;
        const attachments: AiShellAttachment[] = [];
        if (result.factorySearchResult) {
          attachments.push({
            type: "factory_search_results",
            candidates: result.factorySearchResult.candidates.slice(0, 3),
            total: result.factorySearchResult.total,
            viewAllUrl: result.factorySearchResult.viewAllUrl,
          });
        }
        if (result.newsSearchResult) {
          attachments.push({
            type: "news_search_results",
            candidates: result.newsSearchResult.candidates.slice(0, 3),
            total: result.newsSearchResult.total,
            viewAllUrl: result.newsSearchResult.viewAllUrl,
          });
        }
        if (result.subsidyProgramsResult) {
          attachments.push({
            type: "subsidy_programs_results",
            candidates: result.subsidyProgramsResult.candidates,
            totalActiveCount: result.subsidyProgramsResult.totalActiveCount,
            viewAllUrl: result.subsidyProgramsResult.viewAllUrl,
          });
        }
        if (result.navigationAction) {
          attachments.push({
            type: "navigation_action",
            key: result.navigationAction.key,
            title: result.navigationAction.title,
            route: result.navigationAction.route,
          });
        }
        if (result.handoffOffer) {
          attachments.push({
            type: "handoff_offer",
            serviceKey: result.handoffOffer.serviceKey,
            displayName: result.handoffOffer.displayName,
          });
        }
        if (result.govSubsidyRecommendation) {
          attachments.push({ type: "gov_subsidy_recommendation", ...result.govSubsidyRecommendation });
        }
        // Phase 7.1 P1-6：只用結構化的 factoryResultBoundary 旗標＋
        // priorMessages（這一輪開始前、真正存在過的訊息清單）判斷，不看
        // finalReply 文字，找不到較早的 factory_search_results 附件就是
        // undefined（不顯示 CTA）。
        const boundaryFactoryRefMessageId = result.factoryResultBoundary
          ? findMostRecentFactorySearchMessageId(priorMessages) ?? undefined
          : undefined;
        setMessages(prev => [
          ...prev,
          {
            id: nextMessageId(),
            role: "assistant",
            content: result.reply,
            attachments: attachments.length > 0 ? attachments : undefined,
            boundaryFactoryRefMessageId,
          },
        ]);
      },
      onError: (safeMessage) => {
        // Phase 7.2 F（見對話中「錯誤文字不能洩漏 server detail」）：這裡收到
        // 的已經是 resolveChatErrorMessage 分類過的安全文字，不是原始
        // error.message——單次 API error 不清空既有對話紀錄，只顯示可重試
        // 的錯誤提示。
        setErrorText(safeMessage);
      },
      resolveErrorMessage: resolveChatErrorMessage,
    });
  }

  function sendMessage(content: string) {
    void controllerRef.current!.send(content, messages);
  }

  function retryLastMessage() {
    void controllerRef.current!.retry();
  }

  function askQuestion(question: string) {
    setIsOpen(true);
    sendMessage(question);
  }

  // 使用者點【幫你送出詢問】：這一刻才建立 handoff context，成功後導向既有
  // 表單（帶著 aih token），不是導向一個 AI 專用的第二套表單。
  function handleHandoffCta(_serviceKey: string) {
    createHandoffMutation.mutate(
      { conversationId: conversationIdRef.current ?? undefined },
      {
        onSuccess: (result) => {
          navigate(`${result.applyPath}?aih=${encodeURIComponent(result.token)}`);
        },
        onError: (error) => {
          // Phase 7.2 F：Handoff 建立失敗只有一種使用者可見情境，固定安全文字，不顯示 raw error.message。
          setErrorText(resolveHandoffErrorMessage(error));
        },
      }
    );
  }

  const value: AiShellContextValue = {
    isOpen,
    openShell: () => setIsOpen(true),
    closeShell: () => setIsOpen(false),
    toggleShell: () => setIsOpen(o => !o),
    messages,
    isLoading: chatMutation.isPending,
    errorText,
    sendMessage,
    retryLastMessage,
    askQuestion,
    isCreatingHandoff: createHandoffMutation.isPending,
    handleHandoffCta,
    entitlement: entitlementQuery.data,
    isAiComingSoon,
  };

  return <AiShellContext.Provider value={value}>{children}</AiShellContext.Provider>;
}

export function useAiShell(): AiShellContextValue {
  const ctx = useContext(AiShellContext);
  if (!ctx) throw new Error("useAiShell must be used within AiShellProvider");
  return ctx;
}
