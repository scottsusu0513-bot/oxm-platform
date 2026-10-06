import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SMOKE_FIXTURE_PATH } from "./types";

describe("agent e2e smoke fixture", () => {
  it("contains one deterministic, non-production smoke marker", async () => {
    const value = await readFile(resolve(process.cwd(), SMOKE_FIXTURE_PATH), "utf8");
    expect(value).toMatch(/^OXM_AGENT_E2E_SMOKE=[a-z0-9][a-z0-9-]*\r?\n$(?![\s\S])/);
  });
});
