import { describe, expect, it } from "vitest";
import { createTrustedValidationEvidencePort } from "../agentRuntime/validation";
import { approvalNotice } from "../humanInteraction/service";
import { FIXED_GOAL_CRITERIA } from "../intake/normalize";
import { managerStep } from "../manager/lifecycle";
import { validateEvidence } from "../manager/validator";
import type { GoalReviewer } from "../planning/types";
import { formatApprovalNotice } from "../telegram/format";
import { createCodexAdapter } from "../workers/codex";
import { createFakePromptFiles, createFakeRunner, createFakeTimer } from "../workers/fake";
import { gitBlobId } from "../workers/gitIntegrity";
import type { GitInspector, GitStatus, ProcessExit, ProcessRunner, WorkerReport, WorkerTaskContract } from "../workers/types";
import { buildManagerEvidence } from "./evidence";
import { createSimulation, fakeIntake, FOREIGN_PATHS } from "./fake";
import type { GoalAcceptanceContext, TaskIntake } from "./types";

/**
 * Regression: task t261009-a536e5 (scope client/). Codex changed only
 * AnalyticsDashboardCard.tsx; meanwhile another actor edited two orchestrator/
 * files in the shared workspace, and no validation could run (pnpm/corepack
 * unavailable). The old pipeline blamed the orchestrator files on Codex
 * (scope_violation), turned the unavailable validations into task failures,
 * and repaired an already-finished UI change until the task failed.
 *
 * Worker-favoring acceptance: the foreign changes are not the Worker's, the
 * environment problem is not a task failure, AC-1..AC-3 are met and no
 * regression is confirmed — the Manager accepts the implementation, tells the
 * owner what is unverified, and nothing is published without the owner's
 * explicit approval of this exact reviewed result.
 */

const TASK = "t261009-a536e5";
const BRANCH = "agent/task-t261009-a536e5-frontend-styling";
const HEAD = "2c759a8acc9fa6cc3f1d22657efe2d6eb91d3888";
const DIGEST = "e".repeat(64);
const CARD = "client/src/components/admin/AnalyticsDashboardCard.tsx";
const [LEDGER, POLICY] = FOREIGN_PATHS;
const CRITERIA = [
  { id: "AC-1", kind: "goal" as const, text: "每小時的瀏覽人數直接顯示在對應橘色柱狀圖下方，無須滑鼠懸停。" },
  { id: "AC-2", kind: "goal" as const, text: "顯示的人數與目前該小時的懸停提示數值一致。" },
  { id: "AC-3", kind: "goal" as const, text: "人數與小時的對應清楚，文字可讀且不互相遮擋。" },
  { id: "AC-4", kind: "goal" as const, text: FIXED_GOAL_CRITERIA.change_code[0] },
  { id: "AC-5", kind: "technical" as const, text: "All required validations pass on the final working tree" },
];
const GOAL = {
  intent: "change_code" as const,
  originalRequest: "我希望人數直接放在柱狀圖下方顯示出來，這樣就一目了然了",
  interpretedObjective: "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數",
  workArea: "visual" as const,
};

/** Behaves like the prompted Manager reviewer: the diff shows AC-1..3; it cannot confirm AC-4 because no validation could run. */
function reviewer(): GoalReviewer & { calls: number } {
  const r = {
    calls: 0,
    async review(input: Parameters<GoalReviewer["review"]>[0]) {
      r.calls++;
      return {
        criteria: input.criteria.map((c) =>
          c.id === "AC-4"
            ? { id: c.id, status: "unsupported", evidence: "", reason: "validations could not run, so existing behaviour is not independently confirmed" }
            : { id: c.id, status: "satisfied", evidence: "diff renders b.visitors under each bar", reason: "" },
        ),
        ownerAnswer: "全站流量圖的每根橘色柱子下方現在會直接顯示該小時的瀏覽人數，不必再把滑鼠移上去。",
      };
    },
  };
  return r;
}

describe("regression t261009-a536e5 — production components (Codex adapter → trusted validation → Manager validator)", () => {
  const contract: WorkerTaskContract = {
    taskId: TASK,
    runId: `${TASK}-run-1`,
    category: "frontend_styling",
    actions: [{ kind: "code_edit" }, { kind: "run_tests" }, { kind: "run_check" }, { kind: "open_pr" }],
    changedPaths: ["client/"],
    storedRiskLevel: "green",
    objective: GOAL.interpretedObjective,
    allowedScope: ["client/"],
    acceptanceCriteria: CRITERIA.map((c) => c.text),
    requiredValidations: ["tests", "typecheck", "smoke"],
    branch: BRANCH,
    expectedHeadSha: HEAD,
    gitMetadataDigest: DIGEST,
  };
  const before: GitStatus = { branch: BRANCH, headSha: HEAD, dirtyPaths: [] };
  const after: GitStatus = { branch: BRANCH, headSha: HEAD, dirtyPaths: [CARD, LEDGER, POLICY] };
  /** Shared workspace: the orchestrator/ files appear while Codex runs (another actor). */
  function sharedGit(): GitInspector {
    let statusCalls = 0;
    return {
      status: async () => structuredClone(statusCalls++ === 0 ? before : after),
      changedPathsSince: async () => [CARD, LEDGER, POLICY],
      contentIdentities: async (paths) => Array.from(new Set(paths)).sort().map((path) => ({ path, mode: "100644" as const, blob: gitBlobId(Buffer.from(`wt:${path}`)) })),
      metadataDigest: async () => DIGEST,
    };
  }
  const codexReport = (over: Partial<WorkerReport> = {}): WorkerReport => ({
    status: "success",
    summary: "每小時柱狀圖下方常駐顯示 b.visitors；pnpm@10.4.1 無法解析，驗證未能執行。",
    filesChanged: [CARD],
    testsRun: [
      { command: "pnpm test", outcome: "not_run" },
      { command: "pnpm vitest run orchestrator/src/e2e/fixture.test.ts", outcome: "not_run" },
    ],
    checkResult: "not_run",
    branch: BRANCH,
    headSha: HEAD,
    prNumber: null,
    riskObserved: { level: "green", notes: ["專案指定 pnpm@10.4.1，但指定版本解析失敗"] },
    needsApproval: false,
    fallbackRecommended: false,
    errorType: null,
    ...over,
  });
  async function runCodex(report: WorkerReport) {
    const adapter = createCodexAdapter(
      { repoRoot: "/workspaces/oxm-platform", timeoutMs: 60_000 },
      { runner: createFakeRunner(() => ({ exit: { stdout: JSON.stringify(report) } })), git: sharedGit(), promptFiles: createFakePromptFiles(), timer: createFakeTimer(), policyRuntime: { verify: async () => ({ ok: true }) } },
    );
    return adapter.start({ contract, now: "2026-10-09T09:24:20.000Z" }).result;
  }
  /** The validation environment of the incident: pnpm/corepack and the tools could not run. */
  const brokenEnvironment: ProcessRunner = {
    spawn(spec) {
      const cmd = [spec.command, ...spec.args].join(" ");
      const stderr =
        cmd === "pnpm test"
          ? "Internal Error: Error when performing the request to https://registry.npmjs.org/pnpm/-/pnpm-10.4.1.tgz; for troubleshooting help, see corepack issues: getaddrinfo EAI_AGAIN registry.npmjs.org"
          : cmd === "pnpm check"
            ? "sh: 1: tsc: not found"
            : " ERR_PNPM_BAD_PM_VERSION  This project is configured to use v10.4.1 of pnpm";
      const exit: ProcessExit = { exitCode: 1, signal: null, stdout: "", stderr, truncated: false };
      return { exit: Promise.resolve(exit), kill() {} };
    },
  };
  const goal: GoalAcceptanceContext = { mode: "change", title: "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數", objective: GOAL.interpretedObjective, goal: GOAL, criteria: CRITERIA };

  it("Codex is responsible only for its own in-scope delta; the concurrent orchestrator/ edits are not a scope violation", async () => {
    const result = await runCodex(codexReport());
    expect(result).toMatchObject({ status: "success", errorType: null, filesChanged: [CARD] });
    expect(result.workspaceAttribution).toEqual({ preExisting: [], unattributed: [LEDGER, POLICY] });
    // The same run under the Worker's environment-blocked protocol is still a completed change, not a failure.
    const envOnly = await runCodex(codexReport({ status: "failure", errorType: "validation_unavailable" }));
    expect(envOnly).toMatchObject({ status: "success", errorType: null, filesChanged: [CARD] });
  });

  it("validation infrastructure failure is unavailable, AC-1..AC-3 are met, and the Manager accepts the implementation (no repair, no block)", async () => {
    const result = await runCodex(codexReport());
    const review = reviewer();
    const port = createTrustedValidationEvidencePort({ git: sharedGit(), runner: brokenEnvironment, repoRoot: "/workspaces/oxm-platform", timeoutMs: 1_000, reviewer: review, diff: async () => `+++ b/${CARD}\n+<span>{b.visitors}</span>` });
    const record = await port.record({ taskId: TASK, runId: contract.runId, contract, result, lease: {} as never, goal });
    expect(record.changedPaths).toEqual([CARD]);
    expect(record.foreignPaths).toEqual([LEDGER, POLICY]);
    expect(record.validations.map((v) => [v.name, v.status])).toEqual([["tests", "unavailable"], ["typecheck", "unavailable"], ["smoke", "unavailable"]]);
    expect(record.acceptance.filter((a) => a.status === "satisfied").map((a) => a.criterionId)).toEqual(["AC-1", "AC-2", "AC-3"]);
    expect(record.acceptance.find((a) => a.criterionId === "AC-4")).toMatchObject({ status: "unknown", confirmedFailureOnly: true });
    expect(record.acceptance.find((a) => a.criterionId === "AC-5")).toMatchObject({ status: "unknown", confirmedFailureOnly: true });
    expect(record.managerAnswer).toMatch(/直接顯示/);

    const evidence = buildManagerEvidence({
      taskId: TASK,
      lineageId: TASK,
      taskState: "running",
      worker: "codex",
      result,
      record,
      allowedScope: ["client/"],
      acceptanceCriteriaIds: CRITERIA.map((c) => c.id),
      storedRisk: "green",
      approval: "none",
      plan: { taskId: TASK, lineageId: TASK, branch: BRANCH, baseBranch: "main", baseSha: HEAD, decision: "new_branch", expectedPaths: ["client/"], reasons: [] } as never,
      pr: null,
      qa: null,
      repair: { attempt: 0, prior: [] },
    });
    const v = validateEvidence(evidence);
    expect(v.decision).toBe("accepted");
    expect(v.findings).toEqual([]);
    expect(v.reasonCodes).not.toContain("scope_violation");
    expect(v.advisories.map((a) => a.evidenceId).sort()).toEqual(["acceptance:AC-4", "acceptance:AC-5", "validation:smoke", "validation:tests", "validation:typecheck"]);
    const step = managerStep({ evidence });
    expect(step.ok && step.next).toBe("open_pr"); // = ask the owner for publish approval; never publish by itself
  });

  it("a validation that really ran and failed on the task's change still goes to repair", async () => {
    const result = await runCodex(codexReport());
    const failing: ProcessRunner = {
      spawn: (spec) => ({ exit: Promise.resolve({ exitCode: [spec.command, ...spec.args].join(" ") === "pnpm check" ? 2 : 0, signal: null, stdout: "client/src/components/admin/AnalyticsDashboardCard.tsx(12,3): error TS2322", stderr: "", truncated: false }), kill() {} }),
    };
    // Clean workspace (no foreign changes): the failure is attributable to the task.
    const clean: GitInspector = { ...sharedGit(), status: async () => ({ branch: BRANCH, headSha: HEAD, dirtyPaths: [CARD] }), changedPathsSince: async () => [CARD] };
    const record = await createTrustedValidationEvidencePort({ git: clean, runner: failing, repoRoot: "/w", timeoutMs: 1_000, reviewer: reviewer(), diff: async () => "" }).record({ taskId: TASK, runId: contract.runId, contract, result: { ...result, workspaceAttribution: undefined }, lease: {} as never, goal });
    expect(record.validations.find((v) => v.name === "typecheck")?.status).toBe("failed");
    expect(record.acceptance.find((a) => a.criterionId === "AC-5")?.status).toBe("failed");
  });
});

describe("regression t261009-a536e5 — Manager Loop: accept, report honestly, publish only on the owner's explicit approval", () => {
  const intake = (): TaskIntake =>
    fakeIntake(
      { taskId: TASK, category: "frontend_styling", actions: [{ kind: "code_edit" }, { kind: "run_tests" }, { kind: "run_check" }, { kind: "open_pr" }], expectedPaths: ["client/"] },
      { allowedScope: ["client/"], goal: GOAL, acceptanceCriteria: CRITERIA, requiredValidations: ["tests", "typecheck", "smoke"], title: "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數" },
    );

  async function scenario() {
    const sim = createSimulation({ worker: { [TASK]: ["shared_workspace_validation_unavailable"] }, goalReviewer: reviewer(), autoApproveCommits: false });
    await sim.create(intake());
    return sim;
  }

  it("no repair, no scope violation: the implementation is accepted and waits for the owner's publish approval", async () => {
    const sim = await scenario();
    expect(sim.workerCalls).toHaveLength(1); // the finished UI change is never sent back for repair
    const task = sim.loop.task(TASK)!;
    expect(task).toMatchObject({ state: "awaiting_approval", status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.commits).toHaveLength(0); // nothing published yet
    expect(sim.audit.some((e) => e.event === "repair_requested" || e.event === "manager_blocked")).toBe(false);
    expect(sim.trustedRecords[0].changedPaths).toEqual(["client/index.ts"]);
    expect(sim.trustedRecords[0].foreignPaths).toEqual([LEDGER, POLICY]);
  });

  it("the owner is told, in the Manager's voice, what changed, what is unverified, what is excluded, and that nothing is published yet", async () => {
    const sim = await scenario();
    const pending = (await sim.loop.pendingApproval(TASK))!;
    expect(pending.evidence).toMatchObject({ changedPaths: ["client/index.ts"], excludedPaths: [LEDGER, POLICY], managerDecision: "accepted", authorization: { merge: false, deploy: false } });
    const notice = approvalNotice(
      {
        approvalRequestId: "ap-1",
        taskId: TASK,
        kind: "commit_publish",
        phase: "commit_publish",
        risk: pending.risk,
        action: pending.requestedAction,
        bindingTarget: pending.bindingShaOrActionId,
        requestedAt: pending.requestedAt,
        expiresAt: "2026-10-10T09:00:00.000Z",
        status: "pending",
        reasonSummary: "",
        commitEvidence: pending.evidence!,
      },
      "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數",
      "全站流量圖的每根橘色柱子下方現在會直接顯示該小時的瀏覽人數。",
    )!;
    expect(notice).toMatchObject({ voice: "manager", validationsNotPassed: [], validationsUnverified: ["smoke", "tests", "typecheck"], excludedPaths: [LEDGER, POLICY] });
    const text = formatApprovalNotice(notice);
    expect(text).toMatch(/^全站流量圖的每根橘色柱子下方/);
    expect(text).toContain("目前尚未發布，等待你批准");
    expect(text).toContain("client/index.ts");
    expect(text).toMatch(/smoke、tests、typecheck 因環境問題/);
    expect(text).toContain("不會包含在這次發布中");
    expect(text).toContain("不會合併，也不會部署");
  });

  it("publication happens only after an explicit approval bound to this exact reviewed result; foreign changes are never committed", async () => {
    const sim = await scenario();
    // A stale/other approval (e.g. bound to a result without the excluded paths) authorizes nothing.
    sim.approve(TASK, "commit_publish", { bindingShaOrActionId: "commit-publish:" + "0".repeat(64) });
    await sim.send({ type: "approval_granted", taskId: TASK, phase: "commit_publish" });
    expect(sim.commits).toHaveLength(0);
    expect(sim.loop.task(TASK)).toMatchObject({ approvalPhase: "commit_publish" });
    // The owner's explicit approval of the reviewed result: one trusted commit of the task-owned delta only.
    sim.approve(TASK, "commit_publish");
    await sim.send({ type: "approval_granted", taskId: TASK, phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    expect(sim.loop.task(TASK)?.blockingReason ?? null).toBe(null);
    expect(sim.loop.task(TASK)?.state).toBe("pr_opened");
  });

  it("a new dirty path the owner did not see (inside the scope, or outside it but not excluded) after approval blocks publication", async () => {
    for (const file of ["client/src/other-actor.tsx", "server/other-actor.ts"]) {
      const sim = await scenario();
      sim.approve(TASK, "commit_publish");
      sim.mutateWorkspace(TASK, { files: { [file]: "export const wip = 1;\n" } });
      await sim.send({ type: "approval_granted", taskId: TASK, phase: "commit_publish" });
      expect(sim.commits, file).toEqual([]);
      expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr")), file).toEqual([]);
    }
  });

  it("a genuine task-owned failure still repairs: Manager-loop control (no shared-workspace noise)", async () => {
    const sim = createSimulation({ worker: { [TASK]: ["validation_failed", "ok"] }, goalReviewer: reviewer(), autoApproveCommits: false });
    await sim.create(intake());
    expect(sim.workerCalls.length).toBeGreaterThanOrEqual(2);
    expect(sim.audit.some((e) => e.event === "repair_requested" || e.event === "manager_diagnosis_issued")).toBe(true);
  });
});
