import { type PullState } from "@/hooks/usePullToRefresh";
import { RefreshCw } from "lucide-react";

const THRESHOLD = 72;
// z-index 40 keeps indicator below Navbar (z-50)
const Z_INDEX = 40;

interface Props {
  pullY: PullState["pullY"];
  phase: PullState["phase"];
}

export function PullToRefreshIndicator({ pullY, phase }: Props) {
  if (phase === "idle" && pullY === 0) return null;

  const progress = Math.min(pullY / THRESHOLD, 1);
  const isReady = phase === "ready";
  const isRefreshing = phase === "refreshing";

  const label = isRefreshing ? "重新整理中" : isReady ? "放開以重新整理" : "下拉以重新整理";

  // Start from above the safe-area edge so the pill slides in from the top
  const safeAreaTop = "env(safe-area-inset-top, 0px)";

  return (
    <div
      className="fixed left-0 right-0 flex justify-center pointer-events-none"
      style={{
        top: `calc(${safeAreaTop} - 48px)`,
        zIndex: Z_INDEX,
        transform: `translateY(${pullY}px)`,
        transition: phase === "idle" ? "transform 0.25s ease" : "none",
      }}
    >
      <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm border rounded-full px-4 py-2 shadow-md text-sm text-muted-foreground">
        <RefreshCw
          className={`w-4 h-4 ${isRefreshing ? "animate-spin text-orange-500" : "text-muted-foreground"} motion-reduce:transition-none`}
          style={!isRefreshing ? { transform: `rotate(${progress * 360}deg)`, transition: "none" } : undefined}
        />
        <span className="motion-reduce:hidden">{label}</span>
      </div>
    </div>
  );
}
