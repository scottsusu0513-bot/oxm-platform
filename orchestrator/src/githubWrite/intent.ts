import { branchAuditMetadata, type Intent } from "../branches/intent";
import { isValidSha } from "../branches/naming";
import { isPlannerApproved } from "../branches/planner";
import { validateTransition } from "../domain/taskState";
import type { RiskLevel, TaskState } from "../domain/types";
import type { NewAuditEvent, TaskPatch } from "../store/types";
import { isTrustedPullRequest, isVerifiedPushReceipt } from "./client";
import type { BranchCreation } from "./types";

/**
 * Store intents for GitHub write outcomes. Pure: the caller applies them via
 * TaskRepository / AuditRepository, which re-validate. Only client-issued
 * receipts / trusted PRs are accepted, so a worker-reported PR number can
 * never reach the task record.
 */

export interface WriteIntent {
  transition: TaskState | null;
  taskPatch: TaskPatch | null;
  audit: Omit<NewAuditEvent, "id">;
}

export function branchCreatedIntent(input: {
  currentState: TaskState;
  plan: unknown;
  creation: BranchCreation;
}): Intent<WriteIntent> {
  const { plan, creation, currentState } = input;
  if (currentState !== "routed" && currentState !== "queued") return { ok: false, reason: `cannot create a branch in state ${currentState}` };
  if (!isPlannerApproved(plan) || plan.decision !== "new_branch") return { ok: false, reason: "a planner-approved new_branch plan is required" };
  if (creation?.branch !== plan.branch || creation.taskId !== plan.taskId || creation.baseSha !== plan.baseSha || !isValidSha(creation.baseSha)) {
    return { ok: false, reason: "branch creation does not match the plan" };
  }
  return {
    ok: true,
    transition: null,
    taskPatch: { branch: plan.branch },
    audit: {
      taskId: plan.taskId,
      actor: "manager",
      event: "branch_created",
      fromState: currentState,
      toState: null,
      metadata: branchAuditMetadata({
        taskId: plan.taskId,
        branch: plan.branch,
        baseSha: plan.baseSha,
        headSha: plan.baseSha,
        prNumber: null,
        decision: plan.decision,
        reasons: [creation.alreadyExisted ? "branch already existed at planned base SHA" : "branch created at planned base SHA"],
      }),
    },
  };
}

export function branchPushedIntent(input: { currentState: TaskState; receipt: unknown }): Intent<WriteIntent> {
  const { receipt, currentState } = input;
  if (!isVerifiedPushReceipt(receipt)) return { ok: false, reason: "a verified push receipt is required" };
  if (currentState !== "running") return { ok: false, reason: `cannot record a push in state ${currentState}` };
  return {
    ok: true,
    transition: null,
    taskPatch: null,
    audit: {
      taskId: receipt.taskId,
      actor: "manager",
      event: "branch_pushed",
      fromState: currentState,
      toState: null,
      metadata: branchAuditMetadata({
        taskId: receipt.taskId,
        branch: receipt.branch,
        baseSha: receipt.baseSha,
        headSha: receipt.headSha,
        prNumber: null,
        decision: "push",
        reasons: [`fast-forward ${receipt.previousRemoteSha} -> ${receipt.headSha}`],
      }),
    },
  };
}

/** running -> pr_opened, bound to the trusted PR number from GitHub. */
export function prOpenedIntent(input: { currentState: TaskState; riskLevel: RiskLevel; pr: unknown }): Intent<WriteIntent> {
  const { pr, currentState, riskLevel } = input;
  if (!isTrustedPullRequest(pr)) return { ok: false, reason: "PR number must come from the trusted GitHub write layer" };
  const check = validateTransition(currentState, "pr_opened", { riskLevel });
  if (!check.ok) return { ok: false, reason: check.reason };
  return {
    ok: true,
    transition: "pr_opened",
    taskPatch: { branch: pr.branch, prNumber: pr.number },
    audit: {
      taskId: pr.taskId,
      actor: "manager",
      event: "pr_opened",
      fromState: currentState,
      toState: "pr_opened",
      metadata: branchAuditMetadata({
        taskId: pr.taskId,
        branch: pr.branch,
        baseSha: pr.baseSha,
        headSha: pr.headSha,
        prNumber: pr.number,
        decision: pr.draft ? "draft_pr" : "ready_pr",
        reasons: ["PR opened against main from the assigned task branch"],
      }),
    },
  };
}
