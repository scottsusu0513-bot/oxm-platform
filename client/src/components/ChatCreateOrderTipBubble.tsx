import { X } from "lucide-react";

// 20 則訊息輕提醒——漫畫式小對話框（speech bubble），只提醒工廠端（左下角
// 「建立合作確認單」入口只有工廠端看得到，見 shared/chatEducation.ts 開頭
// 說明）。刻意用 CSS 絕對定位掛在「+」附件按鈕同一個 relative 容器裡（跟
// ChatPage.tsx 原本的附件選單 `absolute bottom-12 left-0` 是同一種做法），
// 不用 getBoundingClientRect／resize 監聽：Bubble 本來就該永遠貼著同一個
// 父層容器，容器在桌機／手機／App 底下不管排版怎麼變，這個小提醒都會跟著
// 移動，不需要另外量測 viewport。
//
// 不加全畫面遮罩、不阻擋使用者繼續點聊天室其他功能——只有這個小卡片本身
// 攔截點擊（右上角 × 關閉），符合規格「不要遮住主要聊天內容／不要阻止使用
// 者繼續聊天」。

export interface ChatCreateOrderTipBubbleProps {
  message: string;
  onClose: () => void;
}

export function ChatCreateOrderTipBubble({ message, onClose }: ChatCreateOrderTipBubbleProps) {
  return (
    <div
      className="absolute bottom-12 left-0 z-40 w-64 max-w-[80vw] animate-in fade-in zoom-in-95 duration-150"
      role="status"
    >
      <div className="relative rounded-2xl border border-orange-200 bg-white shadow-lg px-3.5 py-3 text-sm text-foreground">
        <button
          type="button"
          aria-label="關閉提示"
          onClick={onClose}
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/80 text-background hover:bg-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
        <p className="whitespace-pre-line leading-relaxed pr-1">{message}</p>
        {/* 小箭頭指向下方的建立訂單入口（「+」按鈕） */}
        <div className="absolute -bottom-1.5 left-5 h-3 w-3 rotate-45 border-b border-r border-orange-200 bg-white" />
      </div>
    </div>
  );
}
