import type { ManagerEvidence } from "./types";

/**
 * Deterministic evidence fixtures for tests. The default record is fully
 * valid for a green task that has just finished its worker run (state
 * "running", before a PR exists).
 */

export const SHA_BASE = "a".repeat(40);
export const SHA_HEAD = "b".repeat(40);
export const SHA_OTHER = "c".repeat(40);
export const TASK_BRANCH = "agent/task-t1-search-filter";

export function fakeEvidence(overrides: Partial<ManagerEvidence> = {}): ManagerEvidence {
  return {
    taskId: "t1",
    lineageId: "t1",
    taskState: "running",
    worker: { kind: "claude", status: "success", errorType: null },
    scope: { allowedScope: ["client/src/pages/Search.tsx", "server/search/"], changedPaths: ["client/src/pages/Search.tsx", "server/search/filter.ts"] },
    validations: [
      { name: "tests", requested: true, executed: true, status: "passed", trusted: true },
      { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
    ],
    ci: null,
    acceptanceCriteriaIds: ["AC-1", "AC-2"],
    acceptance: [
      { criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" },
      { criterionId: "AC-2", status: "satisfied", evidenceType: "scope", reference: "scope" },
    ],
    risk: { stored: "green", observed: "green", approval: "none" },
    branch: {
      assignedBranch: TASK_BRANCH,
      plannedBaseSha: SHA_BASE,
      verifiedHeadSha: SHA_HEAD,
      workerBranch: TASK_BRANCH,
      workerHeadSha: SHA_HEAD,
      workspaceProof: "verified",
      branchPlanDecision: "new_branch",
      baseFreshness: "fresh",
      conflict: false,
    },
    pr: null,
    repair: { attempt: 0, prior: [] },
    ...overrides,
  };
}

/** Valid evidence for a task whose PR exists and whose required CI passed on the exact head. */
export function fakePostCiEvidence(overrides: Partial<ManagerEvidence> = {}): ManagerEvidence {
  return fakeEvidence({
    taskState: "qa_running",
    pr: { number: 42, state: "open" },
    ci: {
      requiredChecks: ["full-test", "verify"],
      headSha: SHA_HEAD,
      trusted: true,
      checks: [
        { name: "verify", outcome: "success" },
        { name: "full-test", outcome: "success" },
      ],
    },
    ...overrides,
  });
}
