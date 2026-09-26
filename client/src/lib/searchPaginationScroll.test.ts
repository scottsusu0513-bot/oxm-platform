import { describe, expect, it } from "vitest";
import { computeResultsScrollTop, shouldScrollToResultsTop } from "./searchPaginationScroll";

const FP = "fp-a";
const base = { page: 3, currentFingerprint: FP, dataFingerprint: FP, isPlaceholderData: false };

describe("shouldScrollToResultsTop", () => {
  it("scrolls once the clicked page's real data is showing", () => {
    expect(shouldScrollToResultsTop({ ...base, pending: { page: 3, fingerprint: FP } })).toBe(true);
  });

  it("never scrolls without a user pagination click (back/forward, filters, first load)", () => {
    expect(shouldScrollToResultsTop({ ...base, pending: null })).toBe(false);
  });

  it("waits while the previous page is still shown as placeholder data", () => {
    expect(shouldScrollToResultsTop({ ...base, pending: { page: 3, fingerprint: FP }, isPlaceholderData: true })).toBe(false);
  });

  it("rapid clicks: only the latest target page can trigger the scroll", () => {
    expect(shouldScrollToResultsTop({ ...base, page: 4, pending: { page: 3, fingerprint: FP } })).toBe(false);
  });

  it("abandons the scroll if search conditions changed after the click", () => {
    expect(shouldScrollToResultsTop({ ...base, page: 1, currentFingerprint: "fp-b", dataFingerprint: "fp-b", pending: { page: 1, fingerprint: FP } })).toBe(false);
  });

  it("ignores a response whose fingerprint does not match the current search", () => {
    expect(shouldScrollToResultsTop({ ...base, dataFingerprint: "fp-old", pending: { page: 3, fingerprint: FP } })).toBe(false);
    expect(shouldScrollToResultsTop({ ...base, dataFingerprint: undefined, pending: { page: 3, fingerprint: FP } })).toBe(false);
  });
});

describe("computeResultsScrollTop", () => {
  it("places the results top just below the measured sticky header", () => {
    expect(computeResultsScrollTop({ elementTop: -1500, scrollY: 2400, headerBottom: 64, gap: 16 })).toBe(820);
  });

  it("never returns a negative position", () => {
    expect(computeResultsScrollTop({ elementTop: 10, scrollY: 0, headerBottom: 64, gap: 16 })).toBe(0);
  });
});
