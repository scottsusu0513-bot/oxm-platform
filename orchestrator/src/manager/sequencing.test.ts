import { describe, expect, it } from "vitest";
import { TASK_TRANSITIONS, validateTransition } from "../domain/taskState";
import { TASK_STATES, type TaskState } from "../domain/types";
import { qaTaskIntent } from "../github/intent";
import { nextPollStep } from "../github/qa";
import type { QaDecision } from "../github/types";
import { workerFinishIntent } from "../workers/lifecycle";
import type { WorkerErrorType, WorkerResult } from "../workers/types";
import { fakeEvidence, fakePostCiEvidence, SHA_HEAD, TASK_BRANCH } from "./fake";
import { repairStartIntent } from "./lifecycle";
import { advanceRepairCounters, repairWorkerContract } from "./repair";
import { gateQaResult, gateTransition, gateWorkerFinish } from "./sequencing";
import type { ManagerEvidence } from "./types";

function workerResult(status: WorkerResult["status"], errorType: WorkerErrorType | null): WorkerResult {
  return {
    status,
    summary: "s",
    filesChanged: ["client/src/pages/Search.tsx"],
    testsRun: [],
    checkResult: "passed",
    branch: TASK_BRANCH,
    headSha: SHA_HEAD,
    prNumber: null,
    riskObserved: { level: "green", notes: [] },
    needsApproval: false,
    fallbackRecommended: false,
    errorType,
    workerErrorCode: null,
  };
}

function finish(state: TaskState, status: WorkerResult["status"], errorType: WorkerErrorType | null) {
  const f = workerFinishIntent({ currentState: state, riskLevel: "green", taskId: "t1", runId: "run-x", result: workerResult(status, errorType), endedAt: "2026-10-04T00:00:00Z" });
  if (!f.ok) throw new Error(f.reason);
  return f;
}

const workerFailed = (errorType: WorkerErrorType, over: Partial<ManagerEvidence> = {}) =>
  fakeEvidence({ worker: { kind: "claude", status: "failure", errorType }, ...over });

function qaFailed(): { transition: TaskState | null } {
  const decision: QaDecision = { status: "failed", prNumber: 42, headSha: SHA_HEAD, reasons: ["verify failed"], checks: [{ name: "verify", outcome: "failed", observed: 1, staleShaIgnored: 0 }] };
  const q = qaTaskIntent("qa_running", "green", decision, nextPollStep(decision, 1), { attempt: 1 });
  if (!q.ok) throw new Error(q.reason);
  return q;
}

const ciFailedEvidence = (over: Partial<ManagerEvidence> = {}) => {
  const base = fakePostCiEvidence(over);
  return { ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "failed" as const }, { name: "full-test", outcome: "success" as const }] } };
};

describe("lifecycle sequencing gate", () => {
  it("intercepts a repairable worker failure before the terminal failed transition", () => {
    const f = finish("running", "failure", "worker_failure");
    expect(f.transition).toBe("failed"); // existing source behaviour is unchanged
    const g = gateWorkerFinish({ finish: f, evidence: workerFailed("worker_failure") });
    if (!g.ok) throw new Error(g.reason);
    expect(g.transition).toBeNull();
    expect(g.withheldTransition).toBe("failed");
    expect(g.workerAudit.toState).toBeNull();
    expect(g.manager.next).toBe("dispatch_repair");
    expect(g.manager.repairRequest).toMatchObject({ taskId: "t1", branch: TASK_BRANCH, worker: "claude", attempt: 1, workerErrorType: "worker_failure" });
  });

  it("a repairable QA failure produces a RepairRequest without forcing failed", () => {
    const q = qaFailed();
    expect(q.transition).toBe("failed");
    const g = gateQaResult({ qa: q, taskId: "t1", currentState: "qa_running", evidence: ciFailedEvidence() });
    if (!g.ok) throw new Error(g.reason);
    expect(g.transition).toBeNull();
    expect(g.withheldTransition).toBe("failed");
    expect(g.manager.repairRequest).toMatchObject({ branch: TASK_BRANCH, ciFailures: ["verify"], attempt: 1 });
  });

  it("withholds qa_passed when acceptance needs repair, so the repair stays in a QA state", () => {
    const base = fakePostCiEvidence();
    const e = { ...base, acceptance: [base.acceptance[0], { criterionId: "AC-2", status: "failed" as const, evidenceType: "human" as const, reference: "review-1" }] };
    const g = gateQaResult({ qa: { transition: "qa_passed" }, taskId: "t1", currentState: "qa_running", evidence: e });
    expect(g.ok && [g.transition, g.withheldTransition, g.manager.next]).toEqual([null, "qa_passed", "dispatch_repair"]);
  });

  it("full loop: same task + branch + worker, monotonic attempts, success after repair", () => {
    let e = workerFailed("worker_failure");
    const g1 = gateWorkerFinish({ finish: finish("running", "failure", "worker_failure"), evidence: e });
    if (!g1.ok || !g1.manager.repairRequest) throw new Error("expected repair");
    const req = g1.manager.repairRequest;
    const start = repairStartIntent({ request: req, currentState: "running", worker: "claude", runId: "run-1", model: "m", promptHash: "f".repeat(64), workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_HEAD, riskLevel: "green" });
    expect(start.ok && start.transition).toBeNull();
    const contract = repairWorkerContract(
      { taskId: "t1", runId: "run-0", category: "ui", actions: [], objective: "o", allowedScope: e.scope.allowedScope, acceptanceCriteria: ["a"], requiredValidations: ["tests"], branch: TASK_BRANCH },
      req,
      "run-1",
    );
    expect(contract.ok && contract.contract.branch).toBe(TASK_BRANCH);

    // Repair run succeeds: the worker source proposes no transition; the Manager accepts.
    e = fakeEvidence({ repair: advanceRepairCounters(e.repair, req) });
    const g2 = gateWorkerFinish({ finish: finish("running", "success", null), evidence: e });
    expect(g2.ok && [g2.transition, g2.manager.validation.decision, g2.manager.next]).toEqual([null, "accepted", "open_pr"]);
  });

  it("two failed Manager-guided repairs escalate to needs_human_decision and withhold the failed intent", () => {
    let e = workerFailed("worker_failure");
    const transitions: (TaskState | null)[] = [];
    const attempts: number[] = [];
    let previousDiagnosis: Parameters<typeof gateWorkerFinish>[0]["previousDiagnosis"] = null;
    for (let i = 0; i < 6; i++) {
      const g = gateWorkerFinish({ finish: finish("running", "failure", "worker_failure"), evidence: e, previousDiagnosis });
      if (!g.ok) throw new Error(g.reason);
      transitions.push(g.transition);
      if (!g.manager.repairRequest) {
        expect(g.manager.validation.decision).toBe("needs_human_decision");
        expect(g.manager.next).toBe("escalate_human_decision");
        expect(g.manager.validation.reasonCodes).toContain("manager_repair_cycles_exhausted");
        expect(g.manager.audit.map((a) => a.event)).toContain("manager_human_decision_required");
        expect(g.workerAudit.toState).toBeNull();
        expect(g.withheldTransition).toBe("failed");
        break;
      }
      expect(g.manager.repairRequest.branch).toBe(TASK_BRANCH);
      attempts.push(g.manager.repairRequest.attempt);
      previousDiagnosis = { diagnosis: g.manager.repairRequest.diagnosis, repairOutcome: "worker failure/worker_failure" };
      e = { ...e, repair: advanceRepairCounters(e.repair, g.manager.repairRequest) };
    }
    expect(attempts).toEqual([1, 2]);
    expect(transitions).toEqual([null, null, null]);
  });

  it("QA failure after two Manager-guided cycles escalates to a human instead of failing", () => {
    const prior = [
      { attempt: 0, decision: "needs_repair" as const, failedEvidenceIds: ["ci:verify"] },
      { attempt: 1, decision: "needs_repair" as const, failedEvidenceIds: ["ci:verify"] },
    ];
    const g = gateQaResult({ qa: qaFailed(), taskId: "t1", currentState: "qa_running", evidence: ciFailedEvidence({ repair: { attempt: 2, prior } }) });
    expect(g.ok && [g.transition, g.manager.next, g.withheldTransition]).toEqual([null, "escalate_human_decision", "failed"]);
  });

  it("non-repairable policy/scope violations are never converted into repairs", () => {
    const scope = gateWorkerFinish({ finish: finish("running", "failure", "scope_violation"), evidence: workerFailed("scope_violation") });
    expect(scope.ok && [scope.transition, scope.manager.repairRequest, scope.manager.validation.decision]).toEqual(["failed", null, "blocked"]);

    const dirty = gateWorkerFinish({ finish: finish("running", "failure", "dirty_worktree"), evidence: workerFailed("dirty_worktree") });
    expect(dirty.ok && [dirty.transition, dirty.manager.repairRequest]).toEqual(["failed", null]);

    // Worker "succeeded" but changed paths outside scope: blocked/stop, no repair, and no transition invented.
    const out = gateWorkerFinish({ finish: finish("running", "success", null), evidence: fakeEvidence({ scope: { allowedScope: ["a.ts"], changedPaths: ["b.ts"] } }) });
    expect(out.ok && [out.transition, out.manager.next, out.manager.repairRequest]).toEqual([null, "stop", null]);
  });

  it("stale base withholds failed and asks for a replan instead", () => {
    const e = workerFailed("worker_failure", { branch: { ...fakeEvidence().branch, baseFreshness: "stale" } });
    const g = gateWorkerFinish({ finish: finish("running", "failure", "worker_failure"), evidence: e });
    expect(g.ok && [g.transition, g.withheldTransition, g.manager.next]).toEqual([null, "failed", "replan_branch"]);
  });

  it("a repair cannot be requested once past QA (no backwards transition)", () => {
    const base = fakePostCiEvidence({ taskState: "qa_passed" });
    const e = { ...base, acceptance: [base.acceptance[0], { criterionId: "AC-2", status: "failed" as const, evidenceType: "human" as const, reference: "r" }] };
    const g = gateTransition({ source: { taskId: "t1", fromState: "qa_passed", transition: null }, evidence: e });
    expect(g.ok && [g.manager.validation.decision, g.manager.validation.reasonCodes, g.manager.repairRequest]).toEqual(["blocked", ["acceptance_failed", "repair_state_unavailable"], null]);
  });

  it("cancellation is always honoured; mismatched or contradictory input is refused", () => {
    const c = gateWorkerFinish({ finish: finish("running", "cancelled", "cancelled"), evidence: fakeEvidence({ worker: { kind: "claude", status: "cancelled", errorType: "cancelled" } }) });
    expect(c.ok && c.transition).toBe("cancelled");
    expect(gateTransition({ source: { taskId: "t2", fromState: "running", transition: "failed" }, evidence: workerFailed("worker_failure") }).ok).toBe(false);
    expect(gateTransition({ source: { taskId: "t1", fromState: "qa_running", transition: "failed" }, evidence: workerFailed("worker_failure") }).ok).toBe(false);
    expect(gateTransition({ source: { taskId: "t1", fromState: "running", transition: "failed" }, evidence: fakeEvidence() }).ok).toBe(false);
  });

  it("the gate only ever applies null or the source's own transition", () => {
    const cases: [TaskState | null, ManagerEvidence][] = [
      ["failed", workerFailed("worker_failure")],
      ["failed", workerFailed("scope_violation")],
      [null, fakeEvidence()],
      ["cancelled", fakeEvidence({ worker: { kind: "claude", status: "cancelled", errorType: "cancelled" } })],
    ];
    for (const [proposed, e] of cases) {
      const g = gateTransition({ source: { taskId: "t1", fromState: "running", transition: proposed }, evidence: e });
      if (!g.ok) throw new Error(g.reason);
      expect([null, proposed]).toContain(g.transition);
    }
  });
});

describe("taskState invariants", () => {
  it("no unapproved backwards edge into running from PR/QA states", () => {
    for (const s of ["pr_opened", "qa_running", "qa_passed"] as const) {
      expect(TASK_TRANSITIONS[s]).not.toContain("running");
      expect(validateTransition(s, "running", { riskLevel: "green" }).ok).toBe(false);
    }
    expect(validateTransition("awaiting_approval", "running", { riskLevel: "green" }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "running", { riskLevel: "green", approvalPhase: "commit_publish", approved: true }).ok).toBe(true);
  });

  it("transition table snapshot", () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATES].sort());
    expect(TASK_TRANSITIONS).toMatchObject({
      // running -> complete is guarded: read-only, non-red tasks only (see the test below).
      running: ["awaiting_approval", "pr_opened", "complete", "failed", "cancelled"],
      pr_opened: ["qa_running", "failed", "cancelled"],
      qa_running: ["awaiting_approval", "qa_passed", "failed", "cancelled"],
      qa_passed: ["awaiting_approval", "complete", "failed", "cancelled"],
      complete: [],
      failed: [],
      cancelled: [],
    });
  });

  it("running -> complete is only for a read-only task (red: only after pre-execution approval)", () => {
    expect(validateTransition("running", "complete", { riskLevel: "green" }).ok).toBe(false);
    expect(validateTransition("running", "complete", { riskLevel: "yellow", readOnly: false }).ok).toBe(false);
    expect(validateTransition("running", "complete", { riskLevel: "red", readOnly: true }).ok).toBe(false);
    expect(validateTransition("running", "complete", { riskLevel: "red", readOnly: false, preExecutionApproved: true }).ok).toBe(false);
    expect(validateTransition("running", "complete", { riskLevel: "red", readOnly: true, preExecutionApproved: true }).ok).toBe(true);
    expect(validateTransition("running", "complete", { riskLevel: "green", readOnly: true }).ok).toBe(true);
    expect(validateTransition("running", "complete", { riskLevel: "yellow", readOnly: true }).ok).toBe(true);
  });
});
