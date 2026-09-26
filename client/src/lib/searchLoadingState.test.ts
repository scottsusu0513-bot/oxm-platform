import { describe, expect, it } from "vitest";
import {
  SEARCH_LOADING_LONG_MS,
  SEARCH_LOADING_SHOW_DELAY_MS,
  MOBILE_LONG_MESSAGE_KEYWORD_MAX_CHARS,
  getSearchLoadingCompactMessage,
  getSearchLoadingLines,
  getSearchLoadingMessage,
  getSearchLoadingPhase,
  isActiveSearchPending,
} from "./searchLoadingState";

describe("getSearchLoadingPhase", () => {
  it("never shows loading when nothing is pending", () => {
    expect(getSearchLoadingPhase(false, 0)).toBe("hidden");
    expect(getSearchLoadingPhase(false, 10_000)).toBe("hidden");
  });

  it("does not flash for fast searches under the show delay", () => {
    expect(getSearchLoadingPhase(true, 0)).toBe("hidden");
    expect(getSearchLoadingPhase(true, SEARCH_LOADING_SHOW_DELAY_MS - 1)).toBe("hidden");
  });

  it("shows loading for slow searches and switches to the long message later", () => {
    expect(getSearchLoadingPhase(true, SEARCH_LOADING_SHOW_DELAY_MS)).toBe("searching");
    expect(getSearchLoadingPhase(true, SEARCH_LOADING_LONG_MS - 1)).toBe("searching");
    expect(getSearchLoadingPhase(true, SEARCH_LOADING_LONG_MS)).toBe("long");
  });
});

describe("getSearchLoadingMessage", () => {
  it("250ms–4s: standard search message naming the active keyword, without AI wording", () => {
    expect(getSearchLoadingMessage("  螺帽 ", "searching")).toBe("正在搜尋「螺帽」相關廠商");
    expect(getSearchLoadingMessage("螺帽", "searching")).not.toMatch(/AI/);
  });

  it("250ms–4s: filter-only message instead of an empty keyword", () => {
    expect(getSearchLoadingMessage("", "searching")).toBe("正在搜尋符合條件的廠商");
    expect(getSearchLoadingMessage("   ", "searching")).toBe("正在搜尋符合條件的廠商");
  });

  it(">4s: AI search message with the keyword", () => {
    expect(getSearchLoadingMessage(" 螺帽 ", "long")).toBe("正在使用 AI 搜尋，為您擴大比對「螺帽」相關產品與廠商");
  });

  it(">4s: AI search message for filter-only searches", () => {
    expect(getSearchLoadingMessage("", "long")).toBe("正在使用 AI 搜尋，為您擴大比對相關廠商");
  });
});

describe("getSearchLoadingCompactMessage (mobile)", () => {
  it("only replaces the >4s message when the keyword is long", () => {
    const longKw = "不鏽鋼六角法蘭螺帽";
    expect(longKw.length).toBeGreaterThan(MOBILE_LONG_MESSAGE_KEYWORD_MAX_CHARS);
    expect(getSearchLoadingCompactMessage(longKw, "long")).toBe("正在使用 AI 搜尋，為您擴大比對相關產品與廠商");
    expect(getSearchLoadingCompactMessage("螺帽", "long")).toBeNull();
    expect(getSearchLoadingCompactMessage("", "long")).toBeNull();
    expect(getSearchLoadingCompactMessage(longKw, "searching")).toBeNull();
  });
});

describe("getSearchLoadingLines (central loading card)", () => {
  it("250ms–4s: single title line", () => {
    expect(getSearchLoadingLines("螺帽", "searching")).toEqual({ title: "正在搜尋「螺帽」相關廠商", detail: null, compactDetail: null });
    expect(getSearchLoadingLines("", "searching").title).toBe("正在搜尋符合條件的廠商");
  });

  it(">4s: AI title with a keyword / filter-only detail line and a mobile compact detail for long keywords", () => {
    expect(getSearchLoadingLines("螺帽", "long")).toEqual({ title: "正在使用 AI 搜尋", detail: "為您擴大比對「螺帽」相關產品與廠商", compactDetail: null });
    expect(getSearchLoadingLines("", "long")).toEqual({ title: "正在使用 AI 搜尋", detail: "為您擴大比對相關廠商", compactDetail: null });
    expect(getSearchLoadingLines("不鏽鋼六角法蘭螺帽", "long").compactDetail).toBe("為您擴大比對相關產品與廠商");
  });
});

describe("isActiveSearchPending", () => {
  const base = { isLoading: false, isFetching: false, dataFingerprint: "fp-b", currentFingerprint: "fp-b" };

  it("is pending on the very first load", () => {
    expect(isActiveSearchPending({ ...base, isLoading: true, dataFingerprint: undefined })).toBe(true);
  });

  it("is pending while placeholder data still belongs to the previous search (keyword A → B)", () => {
    expect(isActiveSearchPending({ ...base, isFetching: true, dataFingerprint: "fp-a" })).toBe(true);
  });

  it("stops as soon as the active search's own response is shown", () => {
    expect(isActiveSearchPending({ ...base, isFetching: false })).toBe(false);
  });

  it("does not treat a page change (same fingerprint) or background refetch as a new search", () => {
    expect(isActiveSearchPending({ ...base, isFetching: true })).toBe(false);
  });

  it("a stale response for an older search never clears the pending state of the active one", () => {
    expect(isActiveSearchPending({ ...base, isFetching: true, dataFingerprint: "fp-older" })).toBe(true);
  });
});
