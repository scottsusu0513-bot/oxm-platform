import { validateTransition } from "../domain/taskState";
import type { RiskLevel, TaskState } from "../domain/types";
import { sanitizeMetadata } from "../store/sanitize";
import type { JsonValue, NewAuditEvent, TaskPatch } from "../store/types";
import { isPlannerApproved } from "./planner";
import type { BranchPlan } from "./types";

/**
 * Pure mapping from a branch plan to task-state/audit *intents*. Nothing is
 * written: the caller applies transitions through TaskRepository.transition()
 * (which re-validates via domain/taskState) and audit events through
 * AuditRepository.append(). Metadata is limited to taskId/branch/SHAs/PR
 * number/decision/reasons and is sanitized.
 */

export type Intent<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface BranchAuditMetadataInput {
  taskId: string;
  branch: string | null;
  baseSha: string | null;
  headSha: string | null;
  prNumber: number | null;
  decision: string;
  reasons: readonly string[];
  blockedBy?: readonly string[];
}

/** Whitelisted, sanitized branch audit metadata. Unknown fields are dropped. */
export function branchAuditMetadata(m: BranchAuditMetadataInput): { [key: string]: JsonValue } {
  return sanitizeMetadata({
    taskId: m.taskId,
    branch: m.branch,
    baseSha: m.baseSha,
    headSha: m.headSha,
    prNumber: m.prNumber,
    decision: m.decision,
    reasons: m.reasons.slice(0, 20).map((r) => String(r).slice(0, 300)),
    ...(m.blockedBy ? { blockedBy: m.blockedBy.slice(0, 20) } : {}),
  });
}

export interface BranchPlanIntent {
  auditEvent: "branch_planned" | "branch_reused" | "branch_queued" | "branch_rejected";
  transition: TaskState | null;
  taskPatch: TaskPatch | null;
  audit: Omit<NewAuditEvent, "id">;
}

/** Planning happens before dispatch, while the task is routed or queued. */
const PLANNABLE_STATES: readonly TaskState[] = ["routed", "queued"];

export function branchPlanIntent(input: { currentState: TaskState; riskLevel: RiskLevel; plan: BranchPlan }): Intent<BranchPlanIntent> {
  const { plan, currentState, riskLevel } = input;
  if (!PLANNABLE_STATES.includes(currentState)) return { ok: false, reason: `cannot plan a branch in state ${currentState}` };
  if ((plan.decision === "new_branch" || plan.decision === "reuse_branch") && !isPlannerApproved(plan)) {
    return { ok: false, reason: "branch plan was not produced by the deterministic planner" };
  }

  let auditEvent: BranchPlanIntent["auditEvent"];
  let transition: TaskState | null = null;
  let taskPatch: TaskPatch | null = null;
  switch (plan.decision) {
    case "new_branch":
      auditEvent = "branch_planned";
      taskPatch = { branch: plan.branch };
      break;
    case "reuse_branch":
      auditEvent = "branch_reused";
      taskPatch = { branch: plan.branch, ...(plan.prNumber !== null ? { prNumber: plan.prNumber } : {}) };
      break;
    case "queue":
      auditEvent = "branch_queued";
      if (currentState === "routed") transition = "queued";
      break;
    case "reject":
      auditEvent = "branch_rejected";
      break;
    default:
      return { ok: false, reason: "unknown branch plan decision" };
  }
  if (transition) {
    const check = validateTransition(currentState, transition, { riskLevel });
    if (!check.ok) return { ok: false, reason: check.reason };
  }
  const assigned = plan.decision === "new_branch" || plan.decision === "reuse_branch" ? plan : null;
  return {
    ok: true,
    auditEvent,
    transition,
    taskPatch,
    audit: {
      taskId: plan.taskId,
      actor: "manager",
      event: auditEvent,
      fromState: currentState,
      toState: transition,
      metadata: branchAuditMetadata({
        taskId: plan.taskId,
        branch: assigned?.branch ?? null,
        baseSha: assigned?.baseSha ?? null,
        headSha: assigned?.decision === "reuse_branch" ? assigned.headSha : null,
        prNumber: assigned?.decision === "reuse_branch" ? assigned.prNumber : null,
        decision: plan.decision,
        reasons: plan.reasons,
        blockedBy: plan.decision === "queue" ? plan.blockedBy.map((b) => b.taskId) : undefined,
      }),
    },
  };
}
