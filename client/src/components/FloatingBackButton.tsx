import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

type FloatingBackButtonProps = {
  label?: string;
  fallbackHref?: string;
  className?: string;
  noNavbar?: boolean;
};

export function FloatingBackButton({
  label = "返回",
  fallbackHref = "/",
  className,
  noNavbar = false,
}: FloatingBackButtonProps) {
  const [, navigate] = useLocation();

  const handleBack = () => {
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
      className={`fixed left-3 z-40 inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-sm font-medium shadow-md backdrop-blur-sm transition hover:bg-accent active:scale-95 ${className ?? ""}`}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );
}
