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

// Kept for backward compat (PullToRefreshIndicator still imports it)
export interface PullState {
  pullY: number;
  phase: PullPhase;
}

interface Options {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface PullToRefreshHandle {
  contentRef: React.RefObject<HTMLDivElement | null>;
  indicatorRef: React.RefObject<HTMLDivElement | null>;
  iconRef: React.RefObject<HTMLDivElement | null>;
  phase: PullPhase;
}

export function usePullToRefresh({ onRefresh, disabled, containerRef }: Options): PullToRefreshHandle {
  const [phase, setPhase] = useState<PullPhase>("idle");

  // DOM refs — hook drives these imperatively; no React state per drag frame
  const contentRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<HTMLDivElement | null>(null);

  // Gesture state — all in refs to avoid stale closures
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const directionLockedRef = useRef<"vertical" | "horizontal" | null>(null);
  const pullYRef = useRef(0);
  const pendingPullYRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<PullPhase>("idle");
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled ?? false);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { disabledRef.current = disabled ?? false; }, [disabled]);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;

    const target = containerRef?.current ?? document.documentElement;

    function cancelPendingFrame() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }

    function cancelPendingSettle() {
      if (settleTimeoutRef.current !== null) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
    }

    function resetGesture() {
      startYRef.current = null;
      startXRef.current = null;
      directionLockedRef.current = null;
    }

    // Runs inside RAF — only touches compositor properties (transform, opacity)
    function applyDragFrame(v: number) {
      const content = contentRef.current;
      const indicator = indicatorRef.current;
      const icon = iconRef.current;
      if (content) content.style.transform = `translate3d(0, ${v}px, 0)`;
      if (indicator) indicator.style.opacity = String(Math.min(v / 10, 1));
      if (icon) icon.style.transform = `rotate(${Math.min(v / THRESHOLD, 1) * 360}deg)`;
    }

    function scheduleFrame() {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        applyDragFrame(pendingPullYRef.current);
      });
    }

    function settle(onDone?: () => void) {
      // Guard: already idle with no transform — nothing to animate
      if (phaseRef.current === "idle" && pullYRef.current === 0) {
        onDone?.();
        return;
      }
      cancelPendingFrame();
      cancelPendingSettle();

      phaseRef.current = "settling";
      pullYRef.current = 0;
      setPhase("settling");

      const DURATION = reducedMotion.current ? 50 : PTR_SETTLE_MS;
      const content = contentRef.current;
      const indicator = indicatorRef.current;
      const icon = iconRef.current;

      if (icon) icon.style.transform = "";
      if (content) {
        content.style.willChange = "transform";
        content.style.transition = `transform ${DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        content.style.transform = "translate3d(0, 0px, 0)";
      }
      if (indicator) {
        indicator.style.transition = `opacity ${DURATION}ms ease-out`;
        indicator.style.opacity = "0";
      }

      settleTimeoutRef.current = setTimeout(() => {
        settleTimeoutRef.current = null;
        if (content) {
          content.style.transition = "";
          content.style.transform = "";
          content.style.willChange = "auto";
        }
        if (indicator) indicator.style.transition = "";
        if (phaseRef.current === "settling") {
          phaseRef.current = "idle";
          setPhase("idle");
        }
        onDone?.();
      }, DURATION + 150);
    }

    async function triggerRefresh() {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      cancelPendingFrame();

      const content = contentRef.current;
      const icon = iconRef.current;
      const holdY = reducedMotion.current ? 0 : PTR_REFRESH_HOLD;
      const DURATION = reducedMotion.current ? 50 : PTR_SETTLE_MS;

      // Clear JS rotation so CSS animate-spin can take over after setPhase
      if (icon) icon.style.transform = "";
      phaseRef.current = "refreshing";
      pullYRef.current = holdY;
      setPhase("refreshing");

      if (content) {
        content.style.willChange = "transform";
        content.style.transition = `transform ${DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        content.style.transform = `translate3d(0, ${holdY}px, 0)`;
      }

      try {
        await onRefreshRef.current();
      } catch {
        // settle cleanly even on error
      } finally {
        settle(() => { isRefreshingRef.current = false; });
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      if (isRefreshingRef.current || disabledRef.current) return;
      // Never arm the gesture for a touch that starts on an element opted
      // out via [data-ptr-ignore] (e.g. FloatingBackButton). Without this,
      // a tap near the top of the screen — where scrollTop is 0 and this
      // gesture is armed — only needs ~4px of natural finger jitter to lock
      // "vertical" and call preventDefault() on touchmove, which makes the
      // browser suppress the tap's click entirely on top of visibly
      // dragging the (fixed-position, but DOM-nested) button down with the
      // transformed content. The result: the first tap silently does
      // nothing but nudge the button, and only the second, jitter-free tap
      // actually fires the click.
      const touchTarget = e.target;
      if (touchTarget instanceof Element && touchTarget.closest("[data-ptr-ignore]")) return;
      const scrollTop =
        target === document.documentElement
          ? window.scrollY
          : (target as HTMLElement).scrollTop;
      if (scrollTop > 0) return;

      // Interrupt any in-progress settle so new gesture starts clean
      cancelPendingSettle();
      const content = contentRef.current;
      const indicator = indicatorRef.current;
      if (content) {
        content.style.transition = "";
        content.style.transform = "";
        content.style.willChange = "";
      }
      if (indicator) {
        indicator.style.transition = "";
        indicator.style.opacity = "0";
      }
      if (phaseRef.current === "settling") {
        phaseRef.current = "idle";
        setPhase("idle");
      }

      pullYRef.current = 0;
      pendingPullYRef.current = 0;
      startYRef.current = e.touches[0].clientY;
      startXRef.current = e.touches[0].clientX;
      directionLockedRef.current = null;
      // Pre-promote to GPU layer before first move event
      if (content) content.style.willChange = "transform";
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
      pullYRef.current = visual;
      pendingPullYRef.current = visual;
      scheduleFrame(); // batches DOM update into next RAF — no React setState here

      // setState only when crossing threshold, not on every pixel
      const newPhase: PullPhase = shouldTriggerRefresh(visual) ? "ready" : "pulling";
      if (newPhase !== phaseRef.current) {
        phaseRef.current = newPhase;
        setPhase(newPhase);
      }
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      // Flush pending RAF for accurate final position before deciding
      cancelPendingFrame();
      applyDragFrame(pullYRef.current);

      const shouldRefresh = phaseRef.current === "ready" || shouldTriggerRefresh(pullYRef.current);
      resetGesture();
      if (shouldRefresh) {
        triggerRefresh();
      } else {
        settle();
      }
    };

    const onTouchCancel = () => {
      cancelPendingFrame();
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
      cancelPendingFrame();
      cancelPendingSettle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative]);

  return { contentRef, indicatorRef, iconRef, phase };
}

// Re-export constants so consumers don't need two imports
export { THRESHOLD as PTR_THRESHOLD, MAX_PULL as PTR_MAX_PULL, RESIST, DIR_LOCK_RATIO };
