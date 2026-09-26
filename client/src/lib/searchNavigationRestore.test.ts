import { describe, expect, it } from "vitest";
import {
  MAX_RESTORE_PAGE,
  SEARCH_RESTORE_STATE_KEY,
  readSearchRestoreSnapshot,
  shouldRestoreScroll,
  withSearchRestoreSnapshot,
  withoutSearchRestoreSnapshot,
} from "./searchNavigationRestore";

const SEARCH = "?industry=%E9%87%91%E5%B1%AC&sortBy=reviews";
const snap = { search: SEARCH, mobile: false, page: 3, scrollY: 1234 };

describe("readSearchRestoreSnapshot", () => {
  it("restores page and scroll for the same search conditions and layout", () => {
    const state = withSearchRestoreSnapshot(null, snap);
    expect(readSearchRestoreSnapshot(state, SEARCH, false)).toEqual({ v: 1, ...snap });
  });

  it("ignores snapshots whose search conditions differ from the current URL", () => {
    const state = withSearchRestoreSnapshot(null, snap);
    expect(readSearchRestoreSnapshot(state, "?industry=other", false)).toBeNull();
  });

  it("ignores snapshots written in the other layout (desktop vs mobile page sizes)", () => {
    const state = withSearchRestoreSnapshot(null, snap);
    expect(readSearchRestoreSnapshot(state, SEARCH, true)).toBeNull();
  });

  it("returns null for missing or malformed state", () => {
    expect(readSearchRestoreSnapshot(null, SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot("x", SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot({ [SEARCH_RESTORE_STATE_KEY]: { ...snap, v: 2 } }, SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot({ [SEARCH_RESTORE_STATE_KEY]: { v: 1, ...snap, page: 0 } }, SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot({ [SEARCH_RESTORE_STATE_KEY]: { v: 1, ...snap, page: 2.5 } }, SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot({ [SEARCH_RESTORE_STATE_KEY]: { v: 1, ...snap, page: MAX_RESTORE_PAGE + 1 } }, SEARCH, false)).toBeNull();
    expect(readSearchRestoreSnapshot({ [SEARCH_RESTORE_STATE_KEY]: { v: 1, ...snap, scrollY: -1 } }, SEARCH, false)).toBeNull();
  });
});

describe("history.state merging", () => {
  it("keeps other keys such as App.tsx's visited marker when writing a snapshot", () => {
    const state = withSearchRestoreSnapshot({ __oxmScrollNavVisited: 7 }, snap);
    expect(state.__oxmScrollNavVisited).toBe(7);
  });

  it("drops only the stale snapshot when search conditions change", () => {
    const state = withSearchRestoreSnapshot({ __oxmScrollNavVisited: 7 }, snap);
    expect(withoutSearchRestoreSnapshot(state)).toEqual({ __oxmScrollNavVisited: 7 });
    expect(withoutSearchRestoreSnapshot(null)).toBeNull();
  });
});

describe("shouldRestoreScroll", () => {
  const base = { page: 3, currentFingerprint: "fp", dataFingerprint: "fp", isPlaceholderData: false, mobileSeedPending: false };

  it("restores once the restored page's real results are rendered", () => {
    expect(shouldRestoreScroll({ ...base, pending: { page: 3 } })).toBe(true);
  });

  it("does nothing without a pending restore (normal visits, user pagination)", () => {
    expect(shouldRestoreScroll({ ...base, pending: null })).toBe(false);
  });

  it("waits for real data, a matching fingerprint and the mobile seed", () => {
    expect(shouldRestoreScroll({ ...base, pending: { page: 3 }, isPlaceholderData: true })).toBe(false);
    expect(shouldRestoreScroll({ ...base, pending: { page: 3 }, dataFingerprint: "old" })).toBe(false);
    expect(shouldRestoreScroll({ ...base, pending: { page: 3 }, mobileSeedPending: true })).toBe(false);
  });

  it("never applies to a different page than the one being restored", () => {
    expect(shouldRestoreScroll({ ...base, page: 1, pending: { page: 3 } })).toBe(false);
  });
});
