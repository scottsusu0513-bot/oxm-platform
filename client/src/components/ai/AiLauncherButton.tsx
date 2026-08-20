import { useEffect, useRef } from "react";
import { MessageSquareText, Sparkles, X } from "lucide-react";
import { useAiShell } from "@/contexts/AiShellContext";

/**
 * Phase 7.4（見對話中「Floating UI Stack Consolidation」）：從
 * GlobalAiShell.tsx 抽出來的「只是 launcher slot」——原本按鈕跟面板是同一個
 * component 裡的兩個 fragment 子節點，各自負責自己的 fixed 定位；現在
 * positioning 交給 FloatingActionStack.tsx 統一擁有，這裡只保留按鈕本身的
 * 視覺／互動（icon、開關狀態、開合時的 focus 管理），完全不碰面板（面板
 * 仍是 GlobalAiShell.tsx 獨立 render，不受這次搬家影響，見對話中「如果某個
 * component 同時負責 launcher + modal/popover，只把 launcher slot 暴露給
 * stack，不要破壞 modal portal」）。
 */
export function AiLauncherButton() {
  const { isOpen, toggleShell } = useAiShell();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 見 GlobalAiShell.tsx 原本 Phase 7.2 E 的「十六、Focus」：關閉時 focus
  // 回這顆按鈕本身；這段邏輯原本在 GlobalAiShell.tsx（因為按鈕跟面板同一個
  // component），現在按鈕自己有 ref 了，直接在這裡做，不需要再跨元件傳遞 ref。
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      buttonRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggleShell}
      aria-label={isOpen ? "關閉 OXM AI 對話" : "開啟 OXM AI 對話"}
      className="flex size-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_12px_32px_-8px_rgba(15,23,42,0.55)] transition-transform hover:scale-105 hover:bg-orange-600"
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
  );
}
