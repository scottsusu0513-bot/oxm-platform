import { afterEach, expect, it, vi } from "vitest";
import { getVisitorId } from "./analyticsVisitor";
afterEach(() => vi.unstubAllGlobals());
it("retains one visitor identity when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("storage unavailable"); } });
  const id = getVisitorId();
  expect(id).toMatch(/^anon-/);
  expect(getVisitorId()).toBe(id);
  expect(getVisitorId()).toBe(id);
});
