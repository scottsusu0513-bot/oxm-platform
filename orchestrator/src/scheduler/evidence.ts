import type { AssignedBranchPlan } from "../branches/types";
import type { RiskLevel, TaskState, WorkerKind } from "../domain/types";
import type { QaDecision } from "../github/types";
import type { TrustedPullRequest } from "../githubWrite/types";
import type { ApprovalEvidenceState, CiEvidence, ManagerEvidence, RepairCounters } from "../manager/types";
import type { WorkerResult } from "../workers/types";
import type { TrustedRunRecord } from "./types";

/**
 * Pure evidence normalization for the Manager validator. Every field comes
 * from a trusted orchestrator source: the planner-approved plan, the git-
 * verified worker result, the trusted run record (git/validation layer), the
 * trusted PR from the write client, and the QA decision from the read-only
 * QA layer. No source code, diffs, logs or prompts are involved, and the
 * validator re-normalizes everything anyway.
 */

/** CI evidence from a github/qa decision (trusted read-only layer). */
export function ciEvidenceFromQa(qa: QaDecision): CiEvidence {
  return {
    requiredChecks: qa.checks.map((c) => c.name),
    headSha: qa.headSha,
    trusted: true,
    checks: qa.checks.map((c) => ({ name: c.name, outcome: c.outcome })),
  };
}

export interface EvidenceInput {
  taskId: string;
  lineageId: string;
  taskState: TaskState;
  worker: WorkerKind;
  result: WorkerResult;
  record: TrustedRunRecord;
  allowedScope: readonly string[];
  acceptanceCriteriaIds: readonly string[];
  storedRisk: RiskLevel;
  approval: ApprovalEvidenceState;
  plan: AssignedBranchPlan;
  pr: TrustedPullRequest | null;
  qa: QaDecision | null;
  repair: RepairCounters;
}

export function buildManagerEvidence(i: EvidenceInput): ManagerEvidence {
  const ci = i.qa && i.pr && i.qa.prNumber === i.pr.number ? ciEvidenceFromQa(i.qa) : null;
  return {
    taskId: i.taskId,
    lineageId: i.lineageId,
    taskState: i.taskState,
    worker: { kind: i.worker, status: i.result.status, errorType: i.result.errorType },
    scope: { allowedScope: [...i.allowedScope], changedPaths: [...i.record.changedPaths] },
    validations: i.record.validations.map((v) => ({ ...v })),
    ci,
    acceptanceCriteriaIds: [...i.acceptanceCriteriaIds],
    acceptance: i.record.acceptance.map((a) => ({ ...a })),
    risk: { stored: i.storedRisk, observed: i.record.observedRisk, approval: i.approval },
    branch: {
      assignedBranch: i.plan.branch,
      plannedBaseSha: i.plan.baseSha,
      verifiedHeadSha: i.record.verifiedHeadSha,
      workerBranch: i.result.branch,
      workerHeadSha: i.result.headSha,
      workspaceProof: "verified",
      branchPlanDecision: i.plan.decision,
      // A moved base is caught by the write client (replan_required) before execution.
      baseFreshness: "fresh",
      // The branch planner and scheduler serialize conflicting work before dispatch.
      conflict: false,
    },
    pr: i.pr ? { number: i.pr.number, state: "open" } : null,
    repair: { attempt: i.repair.attempt, prior: i.repair.prior.map((p) => ({ ...p, failedEvidenceIds: [...p.failedEvidenceIds] })) },
  };
}
