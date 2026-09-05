import { describe, expect, it } from "vitest";
import {
  decideScrollNavigationAction,
  hasExplicitScrollTarget,
  isHomeNavigationIntentState,
  HOME_NAV_INTENT_STATE,
} from "./scrollRestoration";

describe("decideScrollNavigationAction", () => {
  it("preserves scroll on initial mount / page reload", () => {
    expect(decideScrollNavigationAction({
      previousPathname: null,
      nextPathname: "/search",
      isPopStateNavigation: false,
      isInitialMount: true,
    })).toBe("preserve");
  });

  it("preserves scroll on browser back/forward (popstate), even to a different pathname", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/factories/123",
      nextPathname: "/search",
      isPopStateNavigation: true,
      isInitialMount: false,
    })).toBe("preserve");
  });

  it("preserves scroll when the pathname didn't actually change", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/search",
      nextPathname: "/search",
      isPopStateNavigation: false,
      isInitialMount: false,
    })).toBe("preserve");
  });

  it("resets to top on a genuine forward navigation to a new pathname", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/search",
      nextPathname: "/factories/123",
      isPopStateNavigation: false,
      isInitialMount: false,
    })).toBe("reset-to-top");
  });

  it("popstate takes priority over a changed pathname (never overrides native back/forward restoration)", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/factories/123",
      nextPathname: "/search",
      isPopStateNavigation: true,
      isInitialMount: false,
    })).toBe("preserve");
  });

  it("preserves scroll (defers to the page's own positioning) on an explicit-target navigation, even though the pathname changed", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/",
      nextPathname: "/announcements",
      isPopStateNavigation: false,
      isInitialMount: false,
      hasExplicitTarget: true,
    })).toBe("preserve");
  });

  it("forces reset-to-top on an explicit home-navigation intent, even on the same pathname", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/",
      nextPathname: "/",
      isPopStateNavigation: false,
      isInitialMount: false,
      isHomeNavigationIntent: true,
    })).toBe("reset-to-top");
  });

  it("home-navigation intent overrides an explicit target too (home intent takes precedence)", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/announcements",
      nextPathname: "/",
      isPopStateNavigation: false,
      isInitialMount: false,
      hasExplicitTarget: true,
      isHomeNavigationIntent: true,
    })).toBe("reset-to-top");
  });

  it("popstate is never misread as a home-navigation intent, even if history.state still carries the home marker", () => {
    expect(decideScrollNavigationAction({
      previousPathname: "/announcements",
      nextPathname: "/",
      isPopStateNavigation: true,
      isInitialMount: false,
      isHomeNavigationIntent: true,
    })).toBe("preserve");
  });
});

describe("hasExplicitScrollTarget", () => {
  it("is true when the URL carries a hash", () => {
    expect(hasExplicitScrollTarget("", "#section")).toBe(true);
  });

  it("is true when the query string carries a highlight id (Announcements.tsx / LoginPopupModal.tsx convention)", () => {
    expect(hasExplicitScrollTarget("?highlight=42", "")).toBe(true);
  });

  it("is false for a plain navigation with no hash and no highlight param", () => {
    expect(hasExplicitScrollTarget("", "")).toBe(false);
    expect(hasExplicitScrollTarget("?page=2", "")).toBe(false);
  });
});

describe("isHomeNavigationIntentState", () => {
  it("recognizes the shared HOME_NAV_INTENT_STATE marker", () => {
    expect(isHomeNavigationIntentState(HOME_NAV_INTENT_STATE)).toBe(true);
  });

  it("is false for null, undefined, or unrelated history state", () => {
    expect(isHomeNavigationIntentState(null)).toBe(false);
    expect(isHomeNavigationIntentState(undefined)).toBe(false);
    expect(isHomeNavigationIntentState({})).toBe(false);
    expect(isHomeNavigationIntentState({ navIntent: "somethingElse" })).toBe(false);
  });
});
