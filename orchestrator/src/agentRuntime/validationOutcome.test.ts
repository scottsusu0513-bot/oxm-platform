import { describe, expect, it } from "vitest";
import type { ProcessExit } from "../workers/types";
import { attributeValidationFailure, classifyValidationExit } from "./validationOutcome";

const exit = (over: Partial<ProcessExit> = {}): ProcessExit => ({ exitCode: 1, signal: null, stdout: "", stderr: "", truncated: false, ...over });

describe("trusted validation outcome classification", () => {
  it("passed / failed_due_to_task", () => {
    expect(classifyValidationExit(exit({ exitCode: 0 }), false).status).toBe("passed");
    expect(classifyValidationExit(exit({ stdout: "client/src/Card.tsx(3,1): error TS2322: Type 'string' is not assignable" }), false).status).toBe("failed");
    expect(classifyValidationExit(exit({ stdout: " FAIL  client/src/Card.test.tsx > renders\n ELIFECYCLE  Command failed with exit code 1.\n ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL" }), false).status).toBe("failed");
    // A code error about a missing relative module is the task's, not the environment's.
    expect(classifyValidationExit(exit({ stdout: "error TS2307: Cannot find module './Chart' or its corresponding type declarations." }), false).status).toBe("failed");
    expect(classifyValidationExit(exit({ stdout: "AssertionError: expected 'Error: not found' to be 'ok'" }), false).status).toBe("failed");
  });

  it.each([
    ["sh: 1: vitest: not found"],
    ["bash: pnpm: command not found"],
    ["Internal Error: Error when performing the request to https://registry.npmjs.org/pnpm; corepack failed"],
    ["Error: Cannot find matching keyid"],
    [" ERR_PNPM_BAD_PM_VERSION  This project is configured to use v10.4.1 of pnpm"],
    ["Local package.json exists, but node_modules missing, did you mean to install?"],
    ["Error: Cannot find module 'vitest'"],
    ["getaddrinfo EAI_AGAIN registry.npmjs.org"],
    ["Refusing to run — no TEST_DATABASE_URL"],
    ["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"],
  ])("infrastructure signature %j is unavailable, not a task failure", (stderr) => {
    const c = classifyValidationExit(exit({ stderr }), false);
    expect(c.status).toBe("unavailable");
    expect(c.summary).toMatch(/could not run/);
  });

  it("not started, timed out or interrupted cannot be attributed to the task", () => {
    expect(classifyValidationExit(exit({ exitCode: null, spawnError: "ENOENT" }), false).status).toBe("unavailable");
    expect(classifyValidationExit(null, false).status).toBe("unavailable");
    expect(classifyValidationExit(null, true).status).toBe("unverified");
    expect(classifyValidationExit(exit({ exitCode: null, signal: "SIGKILL" }), false).status).toBe("unverified");
  });

  it("a failure observed while unrelated workspace changes were present is unverified", () => {
    expect(attributeValidationFailure({ status: "failed" }, 2).status).toBe("unverified");
    expect(attributeValidationFailure({ status: "failed" }, 0).status).toBe("failed");
    expect(attributeValidationFailure({ status: "passed" }, 2).status).toBe("passed");
  });
});
