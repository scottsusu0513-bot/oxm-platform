/**
 * NativePullToRefreshLayout
 *
 * On Capacitor native: applies transform: translate3d(0, pullY, 0) to the content
 * wrapper, revealing a refresh indicator in the space above. The background layer
 * prevents the WebView chrome from showing through.
 *
 * On web / PWA: renders a plain <div> with the same className — zero visual change,
 * no stacking context created.
 *
 * Usage:
 *   const { pullY, phase } = usePullToRefresh({ onRefresh });
 *   return (
 *     <NativePullToRefreshLayout pullY={pullY} phase={phase} className="min-h-screen bg-background">
 *       <Navbar />
 *       …page content…
 *     </NativePullToRefreshLayout>
 *   );
 */
import { type CSSProperties } from "react";
import { Capacitor } from "@capacitor/core";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PTR_THRESHOLD,
  PTR_REFRESH_HOLD,
  PTR_SETTLE_MS,
} from "@/lib/pullToRefreshLogic";
import type { PullPhase } from "@/hooks/usePullToRefresh";

// Evaluated once at module load — safe for a client-only SPA
const isNativePlatform = Capacitor.isNativePlatform();

const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const SETTLE_DURATION = prefersReducedMotion ? 50 : PTR_SETTLE_MS;

interface Props {
  pullY: number;
  phase: PullPhase;
  children: React.ReactNode;
  className?: string;
}

export function NativePullToRefreshLayout({ pullY, phase, children, className }: Props) {
  // ── Web / PWA: no transform, no stacking context ────────────────────────
  if (!isNativePlatform) {
    return <div className={className}>{children}</div>;
  }

  // ── Native: full PTR layout ─────────────────────────────────────────────
  const isAnimating = phase === "refreshing" || phase === "settling";
  const isDragging = phase === "pulling" || phase === "ready";
  const isRefreshing = phase === "refreshing";
  const isReady = phase === "ready";
  const showIndicator = phase !== "idle" || pullY > 0;

  // Height of the indicator strip.
  // • During dragging: tracks pullY in real time
  // • During refreshing: locked to hold position (transition snaps from dragged height)
  // • During settling / idle: 0 (CSS height transition plays)
  const indicatorY =
    phase === "idle" || phase === "settling"
      ? 0
      : phase === "refreshing"
      ? PTR_REFRESH_HOLD
      : pullY;

  const indicatorLabel = isRefreshing
    ? "重新整理中"
    : isReady
    ? "放開即可重新整理"
    : "下拉以重新整理";

  const progress = Math.min(pullY / PTR_THRESHOLD, 1);

  // Content transform ─────────────────────────────────────────────────────
  const showTransform = pullY > 0 || isAnimating;
  const contentStyle: CSSProperties = showTransform
    ? {
        transform: `translate3d(0, ${pullY}px, 0)`,
        transition: isAnimating ? `transform ${SETTLE_DURATION}ms ease-out` : "none",
        willChange: isDragging ? "transform" : "auto",
      }
    : {};

  // Indicator height & transition ─────────────────────────────────────────
  const indicatorStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: `${indicatorY}px`,
    paddingTop: "env(safe-area-inset-top, 0px)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    transition: isAnimating ? `height ${SETTLE_DURATION}ms ease-out` : "none",
    visibility: showIndicator ? "visible" : "hidden",
  };

  return (
    // Outer: provides background colour for the revealed area; position:relative
    // anchors the absolute indicator. Does NOT apply transform → no stacking context.
    <div className={cn("relative", className)}>
      {/* Refresh indicator — lives in the space revealed above the moving content */}
      <div style={indicatorStyle} aria-live="polite">
        {showIndicator && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw
              className={cn(
                "w-4 h-4",
                isRefreshing ? "animate-spin text-orange-500" : "text-muted-foreground",
              )}
              style={!isRefreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
              aria-hidden="true"
            />
            <span className="motion-reduce:hidden">{indicatorLabel}</span>
          </div>
        )}
      </div>

      {/* Page content wrapper — this moves with the drag */}
      <div style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
