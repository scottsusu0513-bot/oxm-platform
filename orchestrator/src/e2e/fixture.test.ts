import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSmokeFixtureContent, smokeFixtureContent, SMOKE_FIXTURE_PATH } from "./types";

describe("agent e2e smoke fixture", () => {
  it("contains one deterministic, non-production smoke marker", async () => {
    const value = await readFile(resolve(process.cwd(), SMOKE_FIXTURE_PATH), "utf8");
    expect(isSmokeFixtureContent(value)).toBe(true);
  });

  it("defines the exact one-line newline-terminated content contract", () => {
    expect(smokeFixtureContent("phase-2c-12-test")).toBe("OXM_AGENT_E2E_SMOKE=phase-2c-12-test\n");
    expect(isSmokeFixtureContent("OXM_AGENT_E2E_SMOKE=phase-2c-12-test\n")).toBe(true);
    expect(isSmokeFixtureContent("OXM_AGENT_E2E_SMOKE=phase-2c-12-test")).toBe(false);
    expect(isSmokeFixtureContent("OXM_AGENT_E2E_SMOKE=phase-2c-12-test\r\n")).toBe(true);
    expect(isSmokeFixtureContent("OXM_AGENT_E2E_SMOKE=phase-2c-12-test\n\n")).toBe(false);
  });
});
