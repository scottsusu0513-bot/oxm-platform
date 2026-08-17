import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import type { FactorySearchCandidateForUi } from "@/components/ai/FactorySearchAttachment";

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
      type: "handoff_offer";
      serviceKey: string;
      displayName: string;
    };

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
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `ai-msg-${messageIdCounter}`;
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
  /** FaqAiEntry 這類「入口」元件專用：開啟 Global AI Shell 並直接送出這句問題。 */
  askQuestion: (question: string) => void;
  isCreatingHandoff: boolean;
  handleHandoffCta: (serviceKey: string) => void;
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

  function sendMessage(content: string) {
    setErrorText(null);
    const priorMessages = messages;
    const userMessage: AiShellMessage = { id: nextMessageId(), role: "user", content };
    setMessages([...priorMessages, userMessage]);

    chatMutation.mutate(
      {
        message: content,
        conversationId: isAuthenticated ? conversationIdRef.current ?? undefined : undefined,
        // 已登入使用者不需要、也不被信任傳歷史，伺服器自己從 DB 讀；只有
        // 訪客（無狀態）才需要靠這個欄位延續對話。
        guestHistory: isAuthenticated
          ? undefined
          : priorMessages.map(m => ({ role: m.role, content: m.content })),
      },
      {
        onSuccess: (result) => {
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
          if (result.handoffOffer) {
            attachments.push({
              type: "handoff_offer",
              serviceKey: result.handoffOffer.serviceKey,
              displayName: result.handoffOffer.displayName,
            });
          }
          setMessages(prev => [
            ...prev,
            {
              id: nextMessageId(),
              role: "assistant",
              content: result.reply,
              attachments: attachments.length > 0 ? attachments : undefined,
            },
          ]);
        },
        onError: (error) => {
          // 單次 API error 不清空既有對話紀錄，只顯示可重試的錯誤提示。
          setErrorText(error.message || "AI 暫時無法回應，請稍後再試一次。");
        },
      }
    );
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
          setErrorText(error.message || "暫時無法送出，請稍後再試一次。");
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
    askQuestion,
    isCreatingHandoff: createHandoffMutation.isPending,
    handleHandoffCta,
  };

  return <AiShellContext.Provider value={value}>{children}</AiShellContext.Provider>;
}

export function useAiShell(): AiShellContextValue {
  const ctx = useContext(AiShellContext);
  if (!ctx) throw new Error("useAiShell must be used within AiShellProvider");
  return ctx;
}
