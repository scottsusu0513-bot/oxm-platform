/**
 * NativePullToRefreshLayout
 *
 * On Capacitor native: hook drives contentRef transform and indicatorRef opacity
 * directly via DOM — zero React state per drag frame, no page re-render per pixel.
 * indicator has a fixed height (no layout/reflow during dragging).
 *
 * On web / PWA: renders a plain <div> with the same className — no stacking context.
 */
import { Capacitor } from "@capacitor/core";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PTR_REFRESH_HOLD } from "@/lib/pullToRefreshLogic";
import type { PullPhase, PullToRefreshHandle } from "@/hooks/usePullToRefresh";

const isNativePlatform = Capacitor.isNativePlatform();

// Fixed height — never changes at runtime, so no layout triggered during drag
const INDICATOR_HEIGHT = PTR_REFRESH_HOLD + 24; // 84px

interface Props extends Pick<PullToRefreshHandle, "contentRef" | "indicatorRef" | "iconRef"> {
  phase: PullPhase;
  children: React.ReactNode;
  className?: string;
}

export function NativePullToRefreshLayout({
  contentRef,
  indicatorRef,
  iconRef,
  phase,
  children,
  className,
}: Props) {
  // Web / PWA: identical to original plain wrapper
  if (!isNativePlatform) {
    return <div className={className}>{children}</div>;
  }

  const isRefreshing = phase === "refreshing";
  const isReady = phase === "ready";
  const indicatorLabel = isRefreshing
    ? "重新整理中"
    : isReady
    ? "放開即可重新整理"
    : "下拉以重新整理";

  return (
    // Outer: carries page background so revealed area matches page colour; no transform
    <div className={cn("relative", className)}>

      {/* Indicator — fixed height, no inline style changes during drag (opacity via ref) */}
      <div
        ref={indicatorRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: INDICATOR_HEIGHT,
          paddingTop: "env(safe-area-inset-top, 0px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          opacity: 0, // hook updates this via ref — no React re-render
        }}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {/* iconRef wrapper: JS rotates this div during drag; animate-spin takes over when refreshing */}
          <div ref={iconRef} style={{ display: "inline-flex", willChange: "transform" }}>
            <RefreshCw
              className={cn(
                "w-4 h-4",
                isRefreshing ? "animate-spin text-orange-500" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
          </div>
          <span className="motion-reduce:hidden">{indicatorLabel}</span>
        </div>
      </div>

      {/* Content wrapper — transform driven imperatively by hook via contentRef */}
      <div
        ref={contentRef}
        style={{
          WebkitBackfaceVisibility: "hidden",
          backfaceVisibility: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
