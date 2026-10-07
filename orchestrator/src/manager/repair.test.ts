import { describe, expect, it } from "vitest";
import type { WorkerTaskContract } from "../workers/types";
import { fakeEvidence, fakePostCiEvidence, SHA_HEAD, SHA_OTHER, TASK_BRANCH } from "./fake";
import { advanceRepairCounters, buildRepairRequest, renderRepairBlock, REPAIR_INSTRUCTIONS, repairWorkerContract } from "./repair";
import type { ManagerEvidence } from "./types";
import { validateEvidence } from "./validator";

const failingTests = (over: Partial<ManagerEvidence> = {}) =>
  fakeEvidence({
    validations: [
      { name: "tests", requested: true, executed: true, status: "failed", trusted: true, summary: "Search.test.ts: 2 failing" },
      { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
    ],
    ...over,
  });

const contract: WorkerTaskContract = {
  taskId: "t1",
  runId: "run-0",
  category: "ui",
  actions: [{ kind: "ui_edit" }],
  objective: "Add region multi-select",
  allowedScope: ["client/src/pages/Search.tsx", "server/search/"],
  acceptanceCriteria: ["AC-1 tests pass", "AC-2 stays in scope"],
  requiredValidations: ["tests", "typecheck"],
  branch: TASK_BRANCH,
};

describe("repair requests", () => {
  it("failed validation -> structured repair request", () => {
    const r = buildRepairRequest(failingTests());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request).toMatchObject({
      kind: "repair_request",
      taskId: "t1",
      lineageId: "t1",
      branch: TASK_BRANCH,
      expectedHeadSha: SHA_HEAD,
      attempt: 1,
      maxRepairAttempts: 2,
      workerEffort: "normal",
      failedValidations: ["tests"],
      ciFailures: [],
      unverifiedAcceptanceCriteria: ["AC-1"],
      allowedScope: ["client/src/pages/Search.tsx", "server/search/"],
      rerunValidations: ["tests", "typecheck"],
      workerErrorType: null,
    });
    expect(r.request.failureSummaries).toEqual([{ evidenceId: "validation:tests", summary: "Search.test.ts: 2 failing" }]);
  });

  it("CI + acceptance failures appear by id/name", () => {
    const base = fakePostCiEvidence();
    const r = buildRepairRequest({
      ...base,
      ci: { ...base.ci!, checks: [{ name: "verify", outcome: "failed" }, { name: "full-test", outcome: "success" }] },
      acceptance: [base.acceptance[0], { criterionId: "AC-2", status: "failed", evidenceType: "ci_check", reference: "verify" }],
    });
    expect(r.ok && r.request.ciFailures).toEqual(["verify"]);
    expect(r.ok && r.request.failedAcceptanceCriteria).toEqual(["AC-2"]);
    expect(r.ok && renderRepairBlock(r.request)).toContain("CI check failures: verify.");
  });

  it("contains failure evidence and fixed instructions only — no implementation advice or code", () => {
    const r = buildRepairRequest(failingTests());
    if (!r.ok) throw new Error(r.reason);
    expect(Object.keys(r.request).sort()).toEqual(
      [
        "allowedDirtyPaths", "allowedScope", "attempt", "baseSha", "branch", "ciFailures", "expectedHeadSha", "failedAcceptanceCriteria", "failedEvidenceIds",
        "diagnosis", "failedValidations", "failureSummaries", "instructions", "kind", "lineageId", "maxRepairAttempts", "rerunValidations",
        "taskId", "unverifiedAcceptanceCriteria", "worker", "workerEffort", "workerErrorType",
      ].sort(),
    );
    expect(r.request.instructions).toBe(REPAIR_INSTRUCTIONS);
    const text = JSON.stringify(r.request);
    expect(text).not.toMatch(/suggest|patch|diff|replace .* with|```|function\s*\(|=>/i);
  });

  it("only builds for needs_repair decisions", () => {
    expect(buildRepairRequest(fakeEvidence()).ok).toBe(false);
    expect(buildRepairRequest(fakeEvidence({ scope: { allowedScope: ["a.ts"], changedPaths: ["b.ts"] } })).ok).toBe(false);
  });
});

describe("repair loop policy", () => {
  it("attempts are monotonic and the budget is bounded (no infinite retry)", () => {
    let e = failingTests();
    const attempts: number[] = [];
    let previous: Parameters<typeof buildRepairRequest>[1] = null;
    for (let i = 0; i < 10; i++) {
      const v = validateEvidence(e);
      if (v.decision !== "needs_repair") break;
      const r = buildRepairRequest(e, previous);
      if (!r.ok) throw new Error(r.reason);
      attempts.push(r.request.attempt);
      expect(r.request.branch).toBe(TASK_BRANCH);
      expect(r.request.diagnosis.cycle).toBe(r.request.attempt);
      previous = { diagnosis: r.request.diagnosis, repairOutcome: "worker success; revalidation needs_repair" };
      e = { ...e, repair: advanceRepairCounters(e.repair, r.request) };
    }
    expect(attempts).toEqual([1, 2]);
    const final = validateEvidence(e);
    expect(final.decision).toBe("needs_human_decision");
    expect(final.reasonCodes).toContain("manager_repair_cycles_exhausted");
    expect(final.reasonCodes).not.toContain("repair_budget_exhausted");
    expect(final.triggers).toContain("repeated_repair_failure");
    expect(final.intents).toEqual(["request_human_decision"]);
    expect(final.intents).not.toContain("future_deep_review_candidate"); // green: fast profile
    expect(buildRepairRequest(e, previous).ok).toBe(false);
  });

  it("final repair requests increased effort (metadata only)", () => {
    const first = buildRepairRequest(failingTests());
    if (!first.ok) throw new Error(first.reason);
    const e = failingTests({ repair: { attempt: 1, prior: [{ attempt: 0, decision: "needs_repair", failedEvidenceIds: ["validation:tests"] }] } });
    expect(buildRepairRequest(e).ok).toBe(false); // cycle 2 requires the previous diagnosis
    const r = buildRepairRequest(e, { diagnosis: first.request.diagnosis, repairOutcome: "worker success" });
    expect(r.ok && r.request.attempt).toBe(2);
    expect(r.ok && r.request.workerEffort).toBe("increased");
  });

  it("yellow repeated failure flags a future deep-review candidate (never executed)", () => {
    const e = failingTests({
      risk: { stored: "yellow", observed: "yellow", approval: "none" },
      repair: { attempt: 2, prior: [{ attempt: 0, decision: "needs_repair", failedEvidenceIds: ["validation:tests"] }, { attempt: 1, decision: "needs_repair", failedEvidenceIds: ["validation:tests"] }] },
    });
    expect(validateEvidence(e).intents).toEqual(["request_human_decision", "future_deep_review_candidate"]);
  });

  it("successful repair -> validation continues to accepted", () => {
    const e = fakeEvidence({ repair: { attempt: 1, prior: [{ attempt: 0, decision: "needs_repair", failedEvidenceIds: ["validation:tests"] }] } });
    expect(validateEvidence(e).decision).toBe("accepted");
  });

  it("inconsistent or out-of-range repair history blocks", () => {
    expect(validateEvidence(fakeEvidence({ repair: { attempt: 1, prior: [] } })).reasonCodes).toEqual(["repair_history_inconsistent"]);
    expect(validateEvidence(fakeEvidence({ repair: { attempt: 3, prior: [] } })).reasonCodes).toEqual(["repair_attempt_out_of_range"]);
    expect(() => advanceRepairCounters({ attempt: 0, prior: [] }, { attempt: 2 } as never)).toThrow();
  });

  it("repair contract stays on the same task, branch, and scope", () => {
    const r = buildRepairRequest(failingTests({ scope: { allowedScope: contract.allowedScope, changedPaths: ["client/src/pages/Search.tsx"] } }));
    if (!r.ok) throw new Error(r.reason);
    const c = repairWorkerContract(contract, r.request, "run-1");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.contract.branch).toBe(TASK_BRANCH);
    expect(c.contract.taskId).toBe("t1");
    expect(c.contract.allowedScope).toEqual(contract.allowedScope);
    expect(c.contract.allowedDirtyPaths).toEqual(["client/src/pages/Search.tsx"]);
    expect(c.contract.requiredValidations).toEqual(contract.requiredValidations);
    expect(c.contract.expectedHeadSha).toBe(SHA_HEAD);
    expect(c.contract.objective).toContain("Repair attempt 1 of 2");

    expect(repairWorkerContract({ ...contract, branch: "agent/task-t9-new" }, r.request, "run-1").ok).toBe(false);
    expect(repairWorkerContract({ ...contract, taskId: "t2" }, r.request, "run-1").ok).toBe(false);
    expect(repairWorkerContract({ ...contract, allowedScope: ["server/"] }, r.request, "run-1").ok).toBe(false);
    expect(repairWorkerContract(contract, r.request, "run-0").ok).toBe(false);
    expect(repairWorkerContract(contract, { ...r.request, branch: "agent/task-t1-other", expectedHeadSha: SHA_OTHER }, "run-1").ok).toBe(false);
    expect(repairWorkerContract(contract, { ...r.request, allowedDirtyPaths: ["server/foreign.ts"] }, "run-1").ok).toBe(false);
  });
});
