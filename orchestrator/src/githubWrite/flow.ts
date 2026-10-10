import { isValidSha } from "../branches/naming";
import { isPlannerApproved } from "../branches/planner";
import type { AssignedBranchPlan } from "../branches/types";
import type { WorkerResult, WorkerTaskContract } from "../workers/types";

/**
 * Pure glue between the branch plan, the Claude Code worker, and the write
 * client. Intended flow (no Manager loop yet):
 *
 *   classify/risk → planBranch → createTaskBranch (new_branch) →
 *   acquire workspace lease → prepareAssignedWorkspace (workspace.ts) →
 *   assignWorkerBranch → checkWorkerPreconditions (binds expectedHeadSha) →
 *   workerStartIntent → worker edits without writing Git metadata → trusted
 *   evidence validation → Manager acceptance → commit/publish approval →
 *   trusted workspace commit → pushInputFromWorkerResult →
 *   pushTaskBranch → openPullRequest → prOpenedIntent → Phase 2C.3 QA polling.
 *
 * A successful worker run without a PR stays valid (task remains `running`)
 * until the trusted write layer has opened the PR.
 */

export type FlowResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** Injects the planner-assigned branch into a worker contract; the contract cannot choose its own. */
export function assignWorkerBranch(
  contract: Omit<WorkerTaskContract, "branch"> & { branch?: unknown },
  plan: unknown,
): FlowResult<{ contract: WorkerTaskContract }> {
  if (!isPlannerApproved(plan)) return { ok: false, reason: "branch must come from a planner-approved plan" };
  if (contract.taskId !== plan.taskId) return { ok: false, reason: "contract task does not match the branch plan" };
  if (contract.branch !== undefined && contract.branch !== plan.branch) {
    return { ok: false, reason: "contract requested a branch other than the assigned one" };
  }
  return { ok: true, contract: { ...contract, branch: plan.branch } as WorkerTaskContract };
}

/** The remote head an assigned branch must still be at before the next push. */
export function expectedRemoteHead(plan: AssignedBranchPlan): string {
  return plan.decision === "reuse_branch" ? plan.headSha : plan.baseSha;
}

/**
 * Derives push input after trusted commit packaging. Only the git-verified
 * branch/headSha are used; the worker's prNumber is never read.
 */
export function pushInputFromWorkerResult(
  plan: unknown,
  result: WorkerResult,
): FlowResult<{ localHeadSha: string; expectedRemoteSha: string }> {
  if (!isPlannerApproved(plan)) return { ok: false, reason: "a planner-approved plan is required" };
  if (result.status !== "success" || result.errorType !== null) return { ok: false, reason: "only successful worker runs are pushed" };
  // The Worker's own check report is advisory (the trusted validation layer and the owner's approval
  // decide); only a check the Worker itself saw FAIL contradicts publishing.
  if (result.checkResult === "failed") return { ok: false, reason: "validations did not pass" };
  if (result.branch !== plan.branch) return { ok: false, reason: "worker result is for a different branch" };
  if (!isValidSha(result.headSha)) return { ok: false, reason: "worker result has no verified HEAD SHA" };
  return { ok: true, localHeadSha: result.headSha, expectedRemoteSha: expectedRemoteHead(plan) };
}
