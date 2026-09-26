// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { SearchLoadingOverlay, computeOverlayTop, useSearchLoadingPhase } from "./SearchLoadingStatus";
import { SEARCH_LOADING_LONG_MS, SEARCH_LOADING_SHOW_DELAY_MS } from "@/lib/searchLoadingState";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSearchLoadingPhase", () => {
  it("stays hidden for a search that finishes before the show delay (no flash)", () => {
    const { result, rerender } = renderHook(({ pending, key }) => useSearchLoadingPhase(pending, key), {
      initialProps: { pending: true, key: "fp-a" },
    });
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_SHOW_DELAY_MS - 50); });
    expect(result.current).toBe("hidden");
    rerender({ pending: false, key: "fp-a" });
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_LONG_MS); });
    expect(result.current).toBe("hidden");
  });

  it("shows loading for a slow search, then the long phase, and hides immediately when results arrive", () => {
    const { result, rerender } = renderHook(({ pending, key }) => useSearchLoadingPhase(pending, key), {
      initialProps: { pending: true, key: "fp-a" },
    });
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_SHOW_DELAY_MS); });
    expect(result.current).toBe("searching");
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_LONG_MS); });
    expect(result.current).toBe("long");
    rerender({ pending: false, key: "fp-a" });
    expect(result.current).toBe("hidden");
  });

  it("keyword A → B while A's loading is visible: stays in loading without flashing back, and does not inherit A's long phase", () => {
    const { result, rerender } = renderHook(({ pending, key }) => useSearchLoadingPhase(pending, key), {
      initialProps: { pending: true, key: "fp-a" },
    });
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_LONG_MS); });
    expect(result.current).toBe("long");
    rerender({ pending: true, key: "fp-b" });
    expect(result.current).toBe("searching");
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_LONG_MS - 1); });
    expect(result.current).toBe("searching");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("long");
  });

  it("keyword A → B before A's loading became visible: B still gets the no-flash delay", () => {
    const { result, rerender } = renderHook(({ pending, key }) => useSearchLoadingPhase(pending, key), {
      initialProps: { pending: true, key: "fp-a" },
    });
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_SHOW_DELAY_MS - 50); });
    rerender({ pending: true, key: "fp-b" });
    expect(result.current).toBe("hidden");
    act(() => { vi.advanceTimersByTime(SEARCH_LOADING_SHOW_DELAY_MS); });
    expect(result.current).toBe("searching");
  });
});

describe("SearchLoadingOverlay", () => {
  function renderInContainer(ui: React.ReactElement) {
    return render(<div style={{ position: "relative" }}>{ui}</div>);
  }

  it("250ms–4s: centered card with the keyword message and dots, all decorative (aria-hidden)", () => {
    const { container } = renderInContainer(<SearchLoadingOverlay keyword="螺絲" phase="searching" />);
    expect(screen.getByText("正在搜尋「螺絲」相關廠商")).toBeTruthy();
    expect(container.querySelectorAll(".oxm-loading-dot").length).toBe(3);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
    const root = container.querySelector('[data-testid="search-loading-overlay"]')!.parentElement!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.className).toContain("pointer-events-none");
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it("250ms–4s filter-only: no empty quotes", () => {
    renderInContainer(<SearchLoadingOverlay keyword="" phase="searching" />);
    expect(screen.getByText("正在搜尋符合條件的廠商")).toBeTruthy();
    expect(screen.queryByText(/「」/)).toBeNull();
  });

  it(">4s: AI title plus the detail line; a long keyword gets the compact detail on mobile only", () => {
    const { container } = renderInContainer(<SearchLoadingOverlay keyword="不鏽鋼六角法蘭螺帽" phase="long" />);
    expect(screen.getByText("正在使用 AI 搜尋")).toBeTruthy();
    expect(screen.getByText("為您擴大比對「不鏽鋼六角法蘭螺帽」相關產品與廠商").className).toContain("hidden sm:inline");
    expect(screen.getByText("為您擴大比對相關產品與廠商").className).toContain("sm:hidden");
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it(">4s filter-only: AI title and the filter detail line", () => {
    renderInContainer(<SearchLoadingOverlay keyword="" phase="long" />);
    expect(screen.getByText("正在使用 AI 搜尋")).toBeTruthy();
    expect(screen.getByText("為您擴大比對相關廠商")).toBeTruthy();
  });
});

describe("computeOverlayTop", () => {
  const card = 120;

  it("centers the card in the visible part of a results area taller than the screen", () => {
    // results area spans from 300px above the viewport to far below; header bottom 64, viewport 900
    const top = computeOverlayTop({ containerTop: -300, containerHeight: 3000, visibleTop: 64, visibleBottom: 900, cardHeight: card });
    expect(top + (-300) + card / 2).toBe((64 + 900) / 2);
  });

  it("centers within the visible slice when the results area starts mid-screen", () => {
    const top = computeOverlayTop({ containerTop: 500, containerHeight: 2000, visibleTop: 64, visibleBottom: 900, cardHeight: card });
    expect(top + 500 + card / 2).toBe((500 + 900) / 2);
  });

  it("stays inside a short results area", () => {
    expect(computeOverlayTop({ containerTop: 200, containerHeight: 224, visibleTop: 64, visibleBottom: 900, cardHeight: card })).toBe(52);
    expect(computeOverlayTop({ containerTop: 200, containerHeight: 100, visibleTop: 64, visibleBottom: 900, cardHeight: card })).toBe(0);
  });

  it("clamps to the nearest end when the results area is off screen", () => {
    expect(computeOverlayTop({ containerTop: 1200, containerHeight: 800, visibleTop: 64, visibleBottom: 900, cardHeight: card })).toBe(0);
    expect(computeOverlayTop({ containerTop: -2000, containerHeight: 800, visibleTop: 64, visibleBottom: 900, cardHeight: card })).toBe(800 - card);
  });
});
