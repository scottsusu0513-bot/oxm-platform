import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  PTR_THRESHOLD as THRESHOLD,
  PTR_MAX_PULL as MAX_PULL,
  PTR_RESISTANCE as RESIST,
  PTR_DIRECTION_RATIO as DIR_LOCK_RATIO,
  computePullDistance,
  determineGestureDirection,
  shouldTriggerRefresh,
} from "@/lib/pullToRefreshLogic";

interface Options {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface PullState {
  pullY: number;             // 0..MAX_PULL (visual)
  phase: "idle" | "pulling" | "ready" | "refreshing";
}

export function usePullToRefresh({ onRefresh, disabled, containerRef }: Options): PullState {
  const [pullY, setPullY] = useState(0);
  const [phase, setPhase] = useState<PullState["phase"]>("idle");

  // All gesture state lives in refs — no stale closure issues
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const directionLockedRef = useRef<"vertical" | "horizontal" | null>(null);
  const pullYRef = useRef(0);       // mirrors pullY state for use inside event handlers
  const phaseRef = useRef<PullState["phase"]>("idle");
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled ?? false);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // Keep refs in sync with the latest props so handlers never see stale values
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { disabledRef.current = disabled ?? false; }, [disabled]);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;

    const target = containerRef?.current ?? document.documentElement;

    function resetGesture() {
      startYRef.current = null;
      startXRef.current = null;
      directionLockedRef.current = null;
    }

    function resetPull() {
      pullYRef.current = 0;
      phaseRef.current = "idle";
      setPullY(0);
      setPhase("idle");
    }

    async function triggerRefresh() {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      phaseRef.current = "refreshing";
      setPhase("refreshing");
      const visual = reducedMotion.current ? 0 : THRESHOLD;
      pullYRef.current = visual;
      setPullY(visual);
      try {
        await onRefreshRef.current();
      } finally {
        isRefreshingRef.current = false;
        resetPull();
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      // Ignore multi-touch
      if (e.touches.length > 1) return;
      if (isRefreshingRef.current || disabledRef.current) return;
      const scrollTop =
        target === document.documentElement
          ? window.scrollY
          : (target as HTMLElement).scrollTop;
      if (scrollTop > 0) return;
      startYRef.current = e.touches[0].clientY;
      startXRef.current = e.touches[0].clientX;
      directionLockedRef.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      // Cancel gesture if a second finger joins mid-drag
      if (e.touches.length > 1) {
        resetGesture();
        resetPull();
        return;
      }
      if (startYRef.current === null || isRefreshingRef.current || disabledRef.current) return;

      const deltaY = e.touches[0].clientY - startYRef.current;
      const deltaX = e.touches[0].clientX - (startXRef.current ?? e.touches[0].clientX);

      // Direction lock: first significant movement decides axis
      if (directionLockedRef.current === null) {
        const dir = determineGestureDirection(deltaY, deltaX);
        if (dir !== null) directionLockedRef.current = dir;
      }

      // If locked as horizontal, abandon gesture
      if (directionLockedRef.current === "horizontal") {
        resetGesture();
        resetPull();
        return;
      }

      // Wait until vertical lock is established
      if (directionLockedRef.current !== "vertical") return;

      // Ignore upward drag
      if (deltaY <= 0) {
        resetGesture();
        resetPull();
        return;
      }

      e.preventDefault();

      const visual = computePullDistance(deltaY);
      const newPhase: PullState["phase"] = shouldTriggerRefresh(visual) ? "ready" : "pulling";
      pullYRef.current = visual;
      phaseRef.current = newPhase;
      setPullY(visual);
      setPhase(newPhase);
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      const shouldTrigger = phaseRef.current === "ready" || shouldTriggerRefresh(pullYRef.current);
      resetGesture();
      if (shouldTrigger) {
        triggerRefresh();
      } else {
        resetPull();
      }
    };

    const onTouchCancel = () => {
      resetGesture();
      if (!isRefreshingRef.current) resetPull();
    };

    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchmove", onTouchMove, { passive: false });
    target.addEventListener("touchend", onTouchEnd, { passive: true });
    target.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("touchcancel", onTouchCancel);
    };
    // containerRef is intentionally excluded — it's a stable ref object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  return { pullY, phase };
}
