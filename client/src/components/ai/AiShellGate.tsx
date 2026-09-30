import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAiShell } from "@/contexts/AiShellContext";
import { isAiShellExcludedPath } from "@/lib/aiShellRoutes";

// GlobalAiShell（含 Streamdown／KaTeX／Shiki 等 Markdown 依賴，約 900 KB raw）
// 只在使用者「第一次打開 AI」時才下載（Batch 3.3）：lazy() 本身只會切出獨立
// chunk，只要 <GlobalAiShell /> 一被 render，React 就會立刻觸發 import——
// 原本 AiShellGate 在每個頁面啟動時就 render 它（面板關著時 return null），
// 等於每一頁都先下載整包。現在改成 isOpen 第一次為 true 之前完全不 render。
const GlobalAiShell = lazy(() =>
  import("@/components/ai/GlobalAiShell").then(m => ({ default: m.GlobalAiShell }))
);

/**
 * 第一次打開、chunk 還在下載時的最小 loading 回饋（位置與面板相同）。
 * 只在面板仍是打開狀態時顯示；載入途中使用者又關掉就不顯示。
 */
function AiShellLoadingFallback() {
  const { isOpen } = useAiShell();
  if (!isOpen) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center gap-2 bg-white text-sm text-slate-500 sm:inset-auto sm:top-6 sm:bottom-6 sm:right-7 sm:w-[26rem] sm:max-w-[calc(100vw-3.5rem)] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-[0_24px_70px_-24px_rgba(15,23,42,0.45)]"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      正在開啟 OXM AI…
    </div>
  );
}

/**
 * isOpen 的唯一來源仍是 AiShellContext。hasEverOpened 只記錄「是否打開過」：
 *   - 從沒打開過 → 不 render GlobalAiShell（不觸發 dynamic import）
 *   - 第一次打開（包含 FAQ 等外部 openShell 呼叫）→ 同一次 render 就掛載並開始下載
 *   - 之後關閉 → 維持掛載（GlobalAiShell 自己在 isOpen=false 時 return null），
 *     再次打開不重新下載、不重新初始化、不遺失輸入中的草稿等元件狀態
 */
export function AiShellGate() {
  const [pathname] = useLocation();
  const { isOpen } = useAiShell();
  const [hasEverOpened, setHasEverOpened] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setHasEverOpened(true);
  }, [isOpen]);

  if (isAiShellExcludedPath(pathname)) return null;
  if (!isOpen && !hasEverOpened) return null;
  return (
    <Suspense fallback={<AiShellLoadingFallback />}>
      <GlobalAiShell />
    </Suspense>
  );
}
