// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnalyticsRouteTracker } from "./AnalyticsRouteTracker";

const route = vi.hoisted(() => ({ path: "/", search: "utm_source=facebook", mutate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => [route.path], useSearch: () => route.search }));
vi.mock("@/lib/trpc", () => ({ trpc: { analyticsV2: { trackEvent: { useMutation: () => ({ mutate: route.mutate }) } } } }));
vi.mock("@/lib/platform", () => ({ getAnalyticsPlatform: () => "web" }));
afterEach(cleanup);

it("records navigation once under StrictMode, preserving visits back and refresh while ignoring query-only changes and internal routes", () => {
  const tracker = <StrictMode><AnalyticsRouteTracker /></StrictMode>;
  const view = render(tracker);
  expect(route.mutate).toHaveBeenCalledTimes(1);
  expect(route.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/", isLandingPage: true, utmSource: "facebook" }));
  route.path = "/search";
  route.search = "q=metal";
  view.rerender(tracker);
  // New element is needed to exercise hook updates rather than React's element identity bailout.
  view.rerender(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(2);
  route.search = "q=plastic";
  view.rerender(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(2);
  route.path = "/";
  view.rerender(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(3);
  route.path = "/admin/analytics";
  view.rerender(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(3);
  route.path = "/";
  view.rerender(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(4);
  view.unmount();
  render(<StrictMode><AnalyticsRouteTracker /></StrictMode>);
  expect(route.mutate).toHaveBeenCalledTimes(5);
});
