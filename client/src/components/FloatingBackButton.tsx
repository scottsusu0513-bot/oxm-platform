import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

type FloatingBackButtonProps = {
  label?: string;
  fallbackHref?: string;
  className?: string;
  noNavbar?: boolean;
  // 明確父層返回：一律導向 fallbackHref（並 replace 掉目前歷史紀錄），不查詢瀏覽器
  // history／sessionStorage 的上一頁。用於管理員後台等有固定階層的頁面，避免兩頁
  // 互相 push 導致的 A → B → A 返回迴圈；一般頁面預設 false，行為不受影響。
  deterministic?: boolean;
};

export function FloatingBackButton({
  label = "返回",
  fallbackHref = "/",
  className,
  noNavbar = false,
  deterministic = false,
}: FloatingBackButtonProps) {
  const [, navigate] = useLocation();

  const handleBack = () => {
    if (deterministic) {
      navigate(fallbackHref, { replace: true });
      return;
    }
    try {
      const prev = sessionStorage.getItem("oxm.previousPath");
      if (prev && prev !== window.location.pathname && prev.startsWith("/")) {
        window.history.back();
        return;
      }
    } catch {
      // sessionStorage unavailable
    }
    navigate(fallbackHref);
  };

  const topValue = noNavbar
    ? "calc(env(safe-area-inset-top, 0px) + 1rem)"
    : "calc(env(safe-area-inset-top, 0px) + 4rem + 0.75rem)";

  return (
    <button
      onClick={handleBack}
      aria-label={label}
      style={{ top: topValue }}
      // Opts this button out of usePullToRefresh's gesture tracking (see
      // that hook's onTouchStart) — otherwise a tap here can be swallowed
      // as the start of a pull-to-refresh drag on pages using
      // NativePullToRefreshLayout, requiring a second tap to actually go back.
      data-ptr-ignore
      className={`fixed left-3 z-40 inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-sm font-medium shadow-md backdrop-blur-sm transition hover:bg-accent active:scale-95 ${className ?? ""}`}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );
}
