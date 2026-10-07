import { describe, expect, it } from "vitest";
import { taskBranchName } from "../branches/naming";
import { MAIN_SHA, sha } from "../scheduler/fake";
import { createFakeSmokeEnvironment } from "./fakeEnvironment";
import { runSmokeHarness, smokeTaskId } from "./harness";
import { SMOKE_FIXTURE_PATH } from "./types";

async function run(
  overrides: Partial<Parameters<typeof createFakeSmokeEnvironment>[0]> = {},
) {
  const smokeRunId = overrides.smokeRunId ?? "phase-2c-12-test";
  const env = createFakeSmokeEnvironment({ smokeRunId, ...overrides });
  const report = await runSmokeHarness(env, {
    smokeRunId,
    maxQaPolls: 6,
    waitForQa: false,
  });
  return { env, report };
}

describe("Phase 2C.12 fake end-to-end smoke", () => {
  it("runs gateway → intake → lifecycle → planner → workspace → Codex → push → PR → QA → Manager acceptance", async () => {
    const { env, report } = await run();
    expect(report).toMatchObject({
      intakeResult: "accepted",
      risk: "green",
      priority: "normal",
      worker: "codex",
      fallbackWorker: null,
      workerRuntimeAvailable: true,
      workerInvocationCount: 1,
      filesChanged: [SMOKE_FIXTURE_PATH],
      prNumber: 100,
      prState: "open",
      managerDecision: "accepted",
      repairCount: 0,
      finalStatus: "accepted",
    });
    expect(report.taskId).toBe(smokeTaskId("phase-2c-12-test"));
    expect(report.branch).toMatch(/^agent\/task-e2e-smoke-phase-2c-12-test-/);
    expect(report.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.validations).toEqual([
      expect.objectContaining({ name: "smoke", status: "passed", trusted: true }),
    ]);
    expect(report.ciChecks.map((check) => [check.name, check.outcome])).toEqual([
      ["verify", "success"],
      ["full-test", "success"],
    ]);
    expect(report.codespaceLifecycleDecisions.some((decision) => decision.action === "no_op")).toBe(true);
    expect(env.simulation.loop.task(smokeTaskId("phase-2c-12-test"))?.budget.activatedCapabilities).toEqual(
      expect.arrayContaining([
        "scheduler",
        "branch_planner",
        "workspace_lease",
        "worker",
        "github_write",
        "github_qa",
        "validator",
      ]),
    );
    const pr = env.simulation.remote.prs.get(100) as unknown as { title: string; body: string };
    expect(pr.title).toBe("chore: agent e2e smoke");
    expect(pr.body).toContain("Test-only");
    expect(pr.body).toContain("No production behavior change");
    expect(pr.body).toContain("Do not merge automatically");
  });

  it("reruns on a new deterministic smoke branch when the legacy branch exists on an older base", async () => {
    const oldHead = sha(0x4343);
    const legacyBranch = taskBranchName("e2e-smoke", "chore: agent e2e smoke", "ui");
    const { env, report } = await run({
      smokeRunId: "phase-2c-12-rerun",
      legacyBranchHead: oldHead,
    });

    expect(report.finalStatus).toBe("accepted");
    expect(report.workerInvocationCount).toBe(1);
    expect(report.branch).not.toBe(legacyBranch);
    expect(env.simulation.remote.refs.get(legacyBranch)).toBe(oldHead);
    expect(env.simulation.remote.refs.get("main")).toBe(MAIN_SHA);
    expect(env.simulation.remote.calls.some((call) => /force|DELETE/i.test(call))).toBe(false);
  });

  it("fails closed after a worker failure when repair is disabled", async () => {
    const { report } = await run({ worker: ["failure"], maxRepairAttempts: 0 });
    expect(report).toMatchObject({
      finalStatus: "blocked",
      managerDecision: "blocked",
      workerInvocationCount: 1,
      prNumber: null,
    });
  });

  it("surfaces a runtime policy failure after waiting for the worker result", async () => {
    const { report } = await run({ worker: ["policy_error"] });
    expect(report).toMatchObject({
      finalStatus: "blocked",
      failureCode: "policy_error",
      managerDecision: "blocked",
      workerInvocationCount: 1,
      headSha: null,
      filesChanged: [],
      prNumber: null,
    });
    expect(report.failureReason).toContain("worker_policy_error");
    expect(report.validations).toEqual([
      expect.objectContaining({ name: "smoke", executed: false, status: "missing", trusted: true }),
    ]);
  });

  it("keeps git_metadata_changed as the reported failure when evidence recording then throws (live smoke #6)", async () => {
    const { report } = await run({ worker: ["git_metadata_changed"] });
    expect(report).toMatchObject({
      finalStatus: "blocked",
      failureCode: "git_metadata_changed",
      failureReason: "worker failure: git_metadata_changed",
      managerDecision: "blocked",
      workerInvocationCount: 1,
      headSha: null,
      prNumber: null,
    });
    expect(report.failureReason).not.toContain("orchestration error");
  });

  it("surfaces QA failure and never accepts it", async () => {
    const { report } = await run({ ci: ["fail"], maxRepairAttempts: 0 });
    expect(report.finalStatus).toBe("qa_failed");
    expect(report.managerDecision).toBe("blocked");
    expect(report.ciChecks.find((check) => check.name === "full-test")?.outcome).toBe("failed");
  });

  it("rejects stale-SHA success observations", async () => {
    const { report } = await run({ staleQa: true, maxRepairAttempts: 0 });
    expect(report.finalStatus).toBe("waiting_for_ci");
    expect(report.managerDecision).toBeNull();
    expect(report.ciChecks.every((check) => check.outcome === "missing")).toBe(true);
    expect(report.ciChecks.every((check) => check.staleShaIgnored > 0)).toBe(true);
  });

  it("deduplicates the same smoke idempotency binding", async () => {
    const smokeRunId = "duplicate-run";
    const env = createFakeSmokeEnvironment({ smokeRunId });
    const first = await runSmokeHarness(env, { smokeRunId, maxQaPolls: 2, waitForQa: false });
    const second = await runSmokeHarness(env, { smokeRunId, maxQaPolls: 2, waitForQa: false });
    expect(first.finalStatus).toBe("accepted");
    expect(second.intakeResult).toBe("duplicate");
    expect(second.taskId).toBe(first.taskId);
    expect(second.workerInvocationCount).toBe(1);
    expect(env.simulation.remote.prs.size).toBe(1);
  });

  it("does not dispatch when lifecycle readiness is unavailable", async () => {
    const { report } = await run({ lifecycleAvailable: false });
    expect(report.finalStatus).toBe("blocked");
    expect(report.workerInvocationCount).toBe(0);
    expect(report.branch).toBeNull();
    expect(report.codespaceLifecycleDecisions.at(-1)?.reasonCode).toContain("disabled");
  });

  it("reuses an equivalent open PR rather than creating another", async () => {
    const { env, report } = await run({ existingPrNumber: 77 });
    expect(report.finalStatus).toBe("accepted");
    expect(report.prNumber).toBe(77);
    expect(env.simulation.remote.prs.size).toBe(1);
    expect(env.simulation.remote.calls.some((call) => call.startsWith("REUSE pr"))).toBe(true);
  });

  it("honors a bounded Manager repair request on the same worker and branch", async () => {
    const { env, report } = await run({ worker: ["failure", "success"] });
    expect(report).toMatchObject({
      finalStatus: "accepted",
      managerDecision: "accepted",
      repairCount: 1,
      workerInvocationCount: 2,
    });
    expect(new Set(env.simulation.workerCalls.map((call) => call.kind))).toEqual(new Set(["codex"]));
    expect(new Set(env.simulation.workerCalls.map((call) => call.branch)).size).toBe(1);
  });

  it("surfaces an unexpected approval requirement instead of claiming success", async () => {
    const { report } = await run({ worker: ["risk_red"] });
    expect(report.finalStatus).toBe("needs_human_approval");
    expect(report.managerDecision).toBe("needs_human_approval");
    expect(report.prNumber).toBeNull();
  });
});
