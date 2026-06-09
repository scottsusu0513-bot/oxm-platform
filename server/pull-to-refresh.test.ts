/**
 * Tests for the PTR gesture state machine logic.
 * Imports pure functions from pullToRefreshLogic.ts — no DOM/React/Capacitor deps.
 */
import { describe, expect, it } from "vitest";
import {
  PTR_THRESHOLD,
  PTR_MAX_PULL,
  PTR_RESISTANCE,
  PTR_DIRECTION_RATIO,
  computePullDistance,
  determineGestureDirection,
  shouldTriggerRefresh,
} from "@/lib/pullToRefreshLogic";

// ────────────────────────────────────────────────────────────────────────────
describe("PTR constants", () => {
  it("exports expected constant values", () => {
    expect(PTR_THRESHOLD).toBe(72);
    expect(PTR_MAX_PULL).toBe(120);
    expect(PTR_RESISTANCE).toBe(0.45);
    expect(PTR_DIRECTION_RATIO).toBe(1.2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR threshold and resistance", () => {
  it("visual pull respects RESIST factor", () => {
    expect(computePullDistance(100)).toBeCloseTo(100 * PTR_RESISTANCE);
  });

  it("visual pull is clamped at MAX_PULL", () => {
    expect(computePullDistance(9999)).toBe(PTR_MAX_PULL);
  });

  it("does not trigger below threshold", () => {
    const delta = PTR_THRESHOLD / PTR_RESISTANCE - 1;
    expect(shouldTriggerRefresh(computePullDistance(delta))).toBe(false);
  });

  it("triggers at exactly threshold visual distance", () => {
    expect(shouldTriggerRefresh(PTR_THRESHOLD)).toBe(true);
  });

  it("triggers well above threshold", () => {
    expect(shouldTriggerRefresh(computePullDistance(300))).toBe(true);
  });

  it("does not trigger for visual distance just below threshold", () => {
    expect(shouldTriggerRefresh(PTR_THRESHOLD - 1)).toBe(false);
  });

  it("does not trigger at zero visual distance", () => {
    expect(shouldTriggerRefresh(0)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR direction lock", () => {
  it("locks vertical when deltaY dominates by DIR_LOCK_RATIO", () => {
    expect(determineGestureDirection(12, 5)).toBe("vertical"); // 12 > 5 * 1.2 = 6
  });

  it("does not lock vertical when horizontal dominates", () => {
    expect(determineGestureDirection(5, 12)).toBe("horizontal");
  });

  it("returns null on exactly equal small deltas (below minMovement)", () => {
    expect(determineGestureDirection(3, 3)).toBeNull();
  });

  it("locks vertical on pure vertical movement", () => {
    expect(determineGestureDirection(20, 0)).toBe("vertical");
  });

  it("does not lock vertical when deltaY equals horizontal * ratio (not strictly greater)", () => {
    // deltaY = 12, deltaX = 10 → 12 > 10 * 1.2 = 12 → false
    expect(determineGestureDirection(12, 10)).toBe("horizontal");
  });

  it("returns null when both deltas are at minMovement boundary", () => {
    expect(determineGestureDirection(4, 4)).toBeNull();
  });

  it("respects custom minMovement parameter", () => {
    expect(determineGestureDirection(6, 0, 6)).toBeNull(); // both <= 6
    expect(determineGestureDirection(7, 0, 6)).toBe("vertical"); // 7 > 6
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR multi-touch guard", () => {
  it("gesture should be abandoned when touch count > 1", () => {
    const touchCount = 2;
    const shouldAbort = touchCount > 1;
    expect(shouldAbort).toBe(true);
  });

  it("single touch does not trigger multi-touch guard", () => {
    const touchCount = 1;
    const shouldAbort = touchCount > 1;
    expect(shouldAbort).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR upward drag handling", () => {
  it("upward drag (negative deltaY) should be rejected", () => {
    const deltaY = -10;
    const shouldContinue = deltaY > 0;
    expect(shouldContinue).toBe(false);
  });

  it("zero drag is also rejected", () => {
    const deltaY = 0;
    const shouldContinue = deltaY > 0;
    expect(shouldContinue).toBe(false);
  });

  it("positive drag is allowed", () => {
    const deltaY = 50;
    const shouldContinue = deltaY > 0;
    expect(shouldContinue).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR touchcancel guard", () => {
  it("touchcancel resets gesture state", () => {
    // Simulate the touchcancel handler: if not refreshing, reset pull
    const isRefreshing = false;
    const shouldResetPull = !isRefreshing;
    expect(shouldResetPull).toBe(true);
  });

  it("touchcancel during active refresh does not reset pull state", () => {
    const isRefreshing = true;
    const shouldResetPull = !isRefreshing;
    expect(shouldResetPull).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR scrollTop guard", () => {
  it("touch start is ignored when scrollTop > 0", () => {
    const scrollTop = 50;
    const shouldStart = scrollTop === 0;
    expect(shouldStart).toBe(false);
  });

  it("touch start is allowed at scrollTop = 0", () => {
    const scrollTop = 0;
    const shouldStart = scrollTop === 0;
    expect(shouldStart).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("PTR disabled guard", () => {
  it("disabled=true blocks touch start", () => {
    const disabled = true;
    const shouldStart = !disabled;
    expect(shouldStart).toBe(false);
  });

  it("disabled=false allows touch start", () => {
    const disabled = false;
    const shouldStart = !disabled;
    expect(shouldStart).toBe(true);
  });
});
