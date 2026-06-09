import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  PTR_THRESHOLD as THRESHOLD,
  PTR_MAX_PULL as MAX_PULL,
  PTR_RESISTANCE as RESIST,
  PTR_DIRECTION_RATIO as DIR_LOCK_RATIO,
  PTR_REFRESH_HOLD,
  PTR_SETTLE_MS,
  computePullDistance,
  determineGestureDirection,
  shouldTriggerRefresh,
} from "@/lib/pullToRefreshLogic";

export type PullPhase = "idle" | "pulling" | "ready" | "refreshing" | "settling";

interface Options {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface PullState {
  pullY: number;             // 0..MAX_PULL (visual position)
  phase: PullPhase;
}

export function usePullToRefresh({ onRefresh, disabled, containerRef }: Options): PullState {
  const [pullY, setPullY] = useState(0);
  const [phase, setPhase] = useState<PullPhase>("idle");

  // All gesture state lives in refs — no stale closure issues
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const directionLockedRef = useRef<"vertical" | "horizontal" | null>(null);
  const pullYRef = useRef(0);
  const phaseRef = useRef<PullPhase>("idle");
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled ?? false);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

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

    // Animate pullY back to 0 with a CSS transition, then go idle.
    // onDone is called after the transition completes (used to unblock new gestures).
    function settle(onDone?: () => void) {
      phaseRef.current = "settling";
      pullYRef.current = 0;
      setPullY(0);
      setPhase("settling");
      const delay = reducedMotion.current ? 50 : PTR_SETTLE_MS + 50;
      setTimeout(() => {
        if (phaseRef.current === "settling") {
          phaseRef.current = "idle";
          setPhase("idle");
        }
        onDone?.();
      }, delay);
    }

    async function triggerRefresh() {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      // Snap content to hold position (with CSS transition from layout)
      const holdY = reducedMotion.current ? 0 : PTR_REFRESH_HOLD;
      phaseRef.current = "refreshing";
      pullYRef.current = holdY;
      setPullY(holdY);
      setPhase("refreshing");
      try {
        await onRefreshRef.current();
      } catch {
        // refresh failure: still settle cleanly
      } finally {
        settle(() => {
          isRefreshingRef.current = false;
        });
      }
    }

    const onTouchStart = (e: TouchEvent) => {
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
      if (e.touches.length > 1) {
        resetGesture();
        settle();
        return;
      }
      if (startYRef.current === null || isRefreshingRef.current || disabledRef.current) return;

      const deltaY = e.touches[0].clientY - startYRef.current;
      const deltaX = e.touches[0].clientX - (startXRef.current ?? e.touches[0].clientX);

      if (directionLockedRef.current === null) {
        const dir = determineGestureDirection(deltaY, deltaX);
        if (dir !== null) directionLockedRef.current = dir;
      }

      if (directionLockedRef.current === "horizontal") {
        resetGesture();
        settle();
        return;
      }

      if (directionLockedRef.current !== "vertical") return;

      if (deltaY <= 0) {
        resetGesture();
        settle();
        return;
      }

      e.preventDefault();

      const visual = computePullDistance(deltaY);
      const newPhase: PullPhase = shouldTriggerRefresh(visual) ? "ready" : "pulling";
      pullYRef.current = visual;
      phaseRef.current = newPhase;
      setPullY(visual);
      setPhase(newPhase);
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      const shouldRefresh = phaseRef.current === "ready" || shouldTriggerRefresh(pullYRef.current);
      resetGesture();
      if (shouldRefresh) {
        triggerRefresh();
      } else {
        settle();
      }
    };

    const onTouchCancel = () => {
      resetGesture();
      if (!isRefreshingRef.current) settle();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  return { pullY, phase };
}

// Re-export constants used by usePullToRefresh so consumers don't need two imports
export { THRESHOLD as PTR_THRESHOLD, MAX_PULL as PTR_MAX_PULL, RESIST, DIR_LOCK_RATIO };
