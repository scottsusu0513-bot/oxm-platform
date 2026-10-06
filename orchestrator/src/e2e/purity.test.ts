import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ProcessExit, ProcessRunner, ProcessSpec } from "../workers/types";
import { createFakeSmokeEnvironment } from "./fakeEnvironment";
import { runSmokeHarness, smokeTaskDefinition, smokeTaskId } from "./harness";
import { checkLiveSafety } from "./liveAdapters";
import { formatSmokeReport } from "./report";
import type { LiveSmokeConfig } from "./types";
import { LIVE_CONFIRMATION, SMOKE_FIXTURE_PATH } from "./types";

const ok = (stdout = ""): ProcessExit => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  truncated: false,
});

function safetyRunner(branch: string) {
  const calls: ProcessSpec[] = [];
  const runner: ProcessRunner = {
    spawn(spec) {
      calls.push(spec);
      let result = ok();
      if (spec.command === "git" && spec.args[0] === "rev-parse") result = ok(`${branch}\n`);
      else if (spec.command === "gh" && spec.args[0] === "repo")
        result = ok(JSON.stringify({ nameWithOwner: "oxm/oxm-platform" }));
      else if (spec.command === "gh" && spec.args[0] === "api")
        result = ok(
          JSON.stringify({
            name: "oxm-space",
            state: "Available",
            repository: { full_name: "oxm/oxm-platform" },
          }),
        );
      else if (spec.command === "codex") result = ok("codex-cli 1.0.0\n");
      return { exit: Promise.resolve(result), kill() {} };
    },
  };
  return { runner, calls };
}

const config = (): LiveSmokeConfig => ({
  live: true,
  confirmation: LIVE_CONFIRMATION,
  repoRoot: "/workspaces/oxm-platform",
  expectedRepository: { owner: "oxm", repo: "oxm-platform" },
  codespaceName: "oxm-space",
  expectedCodespaceName: "oxm-space",
  workspacePath: "/workspaces/oxm-platform",
  workerTimeoutMs: 60_000,
  maxQaPolls: 1,
  mergeEnabled: false,
  deployEnabled: false,
  forcePushEnabled: false,
  productionDbEnabled: false,
  ci: false,
});

describe("Phase 2C.12 smoke purity and safety", () => {
  describe("smoke task identity", () => {
    it("normalizes uppercase, spaces, slashes, unicode, and special characters", () => {
      expect(smokeTaskId("  Release / RÜN ✨ -- Alpha_BETA!  ")).toBe(
        "e2e-smoke-release-r-n-alpha-beta-a7c4c6c667ff",
      );
    });

    it("bounds very long readable prefixes without changing the digest", () => {
      expect(smokeTaskId("abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
        "e2e-smoke-abcdefghijklmnopqrstuvwx-011fc2994e39",
      );
    });

    it("distinguishes raw run ids whose sanitized prefixes collide", () => {
      const slash = smokeTaskId("same/prefix");
      const spaces = smokeTaskId("same prefix");

      expect(slash).toMatch(/^e2e-smoke-same-prefix-/);
      expect(spaces).toMatch(/^e2e-smoke-same-prefix-/);
      expect(slash).not.toBe(spaces);
    });

    it.each(["", "✨☃☂"])('falls back to "run" for an empty/all-invalid prefix (%j)', (runId) => {
      expect(smokeTaskId(runId)).toMatch(/^e2e-smoke-run-[a-f0-9]{12}$/);
    });

    it("contains only conservative characters and remains bounded", () => {
      const taskId = smokeTaskId("---THIS is/a very long ÜNTRUSTED operator value!!!");

      expect(taskId).toMatch(/^[a-z0-9-]+$/);
      expect(taskId.length).toBeLessThanOrEqual(47);
    });
  });

  it("keeps fake mode offline", async () => {
    const smokeRunId = "offline-test";
    const env = createFakeSmokeEnvironment({ smokeRunId });
    const report = await runSmokeHarness(env, { smokeRunId, maxQaPolls: 2, waitForQa: false });
    expect(report.finalStatus).toBe("accepted");
    expect(env.networkCalls).toEqual([]);
  });

  it.each(["main", "master"])("rejects live mode on protected branch %s before writes", async (branch) => {
    const fake = safetyRunner(branch);
    const result = await checkLiveSafety(config(), fake.runner);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "non_production_branch")?.ok).toBe(false);
    expect(fake.calls.some((call) => call.args.includes("push") || call.args.includes("POST"))).toBe(false);
  });

  it("cannot enable merge, deploy, force push, production DB, or CI execution", async () => {
    const fake = safetyRunner("agent/phase2c-e2e-smoke");
    const unsafe = {
      ...config(),
      mergeEnabled: true,
      deployEnabled: true,
      forcePushEnabled: true,
      productionDbEnabled: true,
      ci: true,
    } as unknown as LiveSmokeConfig;
    const result = await checkLiveSafety(unsafe, fake.runner);
    expect(result.ok).toBe(false);
    for (const name of [
      "not_ci",
      "production_db_disabled",
      "merge_disabled",
      "deploy_disabled",
      "force_push_disabled",
    ]) {
      expect(result.checks.find((check) => check.name === name)?.ok).toBe(false);
    }
  });

  it("freezes the exact test-only scope and targeted validation", () => {
    const task = smokeTaskDefinition("scope-test");
    expect(task.expectedScope).toEqual([SMOKE_FIXTURE_PATH]);
    expect(Object.isFrozen(task.expectedScope)).toBe(true);
    expect(task.requiredValidations).toEqual(["smoke"]);
    expect(task.instruction).toContain('"OXM_AGENT_E2E_SMOKE=scope-test\\n"');
    expect(task.instruction).toContain("one LF byte (0x0a), not optional");
    expect(task.instruction).not.toMatch(/production (?:database|deploy).*\b(?:write|run|execute)\b/i);
  });

  it("sanitizes credential-shaped values and exposes no raw output or prompts", async () => {
    const smokeRunId = "sanitized-report";
    const env = createFakeSmokeEnvironment({ smokeRunId });
    const report = await runSmokeHarness(env, { smokeRunId, maxQaPolls: 2, waitForQa: false });
    report.failureReason = "Bearer ghp_abcdefghijklmnop";
    const output = formatSmokeReport(report);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("ghp_abcdefghijklmnop");
    expect(output).not.toMatch(/rawPrompt|stdout|stderr|sourceBlob|token/i);
  });

  it("uses planner, WorkerAdapter registry, trusted PR, exact-head QA, and has no merge path", async () => {
    const smokeRunId = "boundary-test";
    const env = createFakeSmokeEnvironment({ smokeRunId });
    const report = await runSmokeHarness(env, { smokeRunId, maxQaPolls: 2, waitForQa: false });
    const snapshot = env.simulation.loop.task(smokeTaskId(smokeRunId))!;
    expect(snapshot.budget.activatedCapabilities).toEqual(
      expect.arrayContaining(["branch_planner", "worker", "github_write", "github_qa"]),
    );
    expect(env.simulation.workerCalls).toHaveLength(1);
    expect(report.prNumber).toBe(100);
    expect(report.ciChecks.every((check) => check.outcome === "success")).toBe(true);
    expect(env.simulation.remote.refs.get("main")).toBe(report.baseSha);
    expect(env.simulation.remote.calls.some((call) => /merge|force|DELETE/i.test(call))).toBe(false);
  });

  it("does not import production DB code or expose merge/close/delete APIs", async () => {
    const source = await readFile(new URL("./liveAdapters.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:server\/db|drizzle)/);
    expect(source).not.toMatch(/\.mergePullRequest|\.closePullRequest|\.deleteBranch/);
    expect(source).not.toMatch(/git[^\n]*--force/);
  });
});
