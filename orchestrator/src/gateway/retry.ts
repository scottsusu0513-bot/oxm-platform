import type { WorkerKind } from "../domain/types";
import type { WorkerAvailabilityState } from "../executive/workAssignment";
import type { GatewayTaskStatus } from "./types";

/**
 * Deterministic retry / remediation policy (pure).
 *
 * The GPT Manager only decides WHAT the owner means ("may I re-run it?",
 * "re-run it"); whether a re-run is allowed is decided here, from trusted
 * task state only: the terminal reason the scheduler recorded, the lineage of
 * earlier re-runs and the scheduler's trusted Worker availability. A re-run
 * never resumes the stopped task: it is a NEW task with the original trusted
 * goal (see the Gateway's retryTask).
 */

/** Why a terminal task stopped, from the scheduler's own blockingReason (anchored shapes only). */
export type FailureClass =
  | "git_safety"
  | "workspace_safety"
  | "scope"
  | "quota"
  | "auth"
  | "runtime"
  | "timeout"
  | "worker_error"
  | "budget"
  | "cancelled"
  | "approval_rejected"
  | "publish"
  | "persistence";

const TERMINAL_REASON_CLASSES: { re: RegExp; cls: FailureClass }[] = [
  { re: /^worker failure: (?:git_metadata_changed|branch_changed|branch_mismatch)$/, cls: "git_safety" },
  { re: /^worker failure: (?:dirty_worktree|git_error)$|^workspace is not at the (?:retry|checkpoint|repair) head$|^workspace preparation failed: |^branch creation failed: /, cls: "workspace_safety" },
  { re: /^worker failure: scope_violation$|^read-only task modified the workspace$|^mutability invariant violated: /, cls: "scope" },
  { re: /^worker failure: (?:quota_exhausted|rate_limited)$/, cls: "quota" },
  { re: /^worker failure: authentication_unavailable$/, cls: "auth" },
  { re: /^worker failure: (?:service_unavailable|executable_unavailable|runtime_unavailable|runtime_misconfigured)$|^codespace stopped unexpectedly while worker was running$|^worker \w+ is not executable$/, cls: "runtime" },
  { re: /^worker failure: timeout$/, cls: "timeout" },
  {
    re: /^worker failure: (?:malformed_output|process_error|worker_error|worker_failure|result_mismatch|validation_incomplete|temp_file_error|invalid_contract|policy_error)$|^worker run produced no trusted result$/,
    cls: "worker_error",
  },
  { re: /^worker execution budget exhausted$|^replan budget exhausted /, cls: "budget" },
  { re: /^cancelled by operator$/, cls: "cancelled" },
  { re: /^(?:pre_execution|commit|push|publish|pre_push|post_qa) approval rejected$/, cls: "approval_rejected" },
  { re: /^(?:trusted commit failed|push failed|PR creation failed): /, cls: "publish" },
  { re: /^orchestration persistence failed$/, cls: "persistence" },
];

/** Trusted terminal reason class, or null when the reason is missing or not one of the known shapes. */
export function terminalClass(waitReason: string | null | undefined): FailureClass | null {
  const reason = waitReason?.trim();
  if (!reason) return null;
  return TERMINAL_REASON_CLASSES.find((r) => r.re.test(reason))?.cls ?? null;
}

export type TaskOutcome = "completed" | "failed" | "cancelled" | "active";

export function outcomeOf(s: Pick<GatewayTaskStatus, "status" | "taskState">): TaskOutcome {
  if (s.status === "accepted") return "completed";
  if (s.status === "blocked" && s.taskState === "failed") return "failed";
  if (s.status === "blocked" && s.taskState === "cancelled") return "cancelled";
  return "active";
}

export type RetryEligibility =
  /** A new task with the original goal may be created now. rerun: the original had completed. */
  | { kind: "allowed"; rerun: boolean; caution: "none" | "may_repeat" | "recovery_unverified" | "unknown_cause" }
  /** The task itself has not finished: no new task (the owner continues it instead). */
  | { kind: "in_progress"; waiting: "decision" | "approval" | "availability" | "working" }
  /** An earlier re-run of this task is still active: never a concurrent duplicate. */
  | { kind: "retry_in_progress"; retryTaskId: string }
  /** The cause is still present according to trusted availability: a re-run now would fail the same way. */
  | { kind: "wait_recovery"; cause: "quota" | "auth" | "runtime"; resetAt: string | null }
  /** One part of a decomposed request cannot be re-run alone (its combined review spans the parts). */
  | { kind: "not_supported"; reason: "decomposed_part" };

export interface RetryAssessment {
  taskId: string;
  outcome: TaskOutcome;
  /** null: completed / active / cancelled-without-reason, or an unknown terminal reason. */
  failureClass: FailureClass | null;
  worker: WorkerKind | null;
  eligibility: RetryEligibility;
}

const CAUSE: Partial<Record<FailureClass, "quota" | "auth" | "runtime">> = { quota: "quota", auth: "auth", runtime: "runtime" };

export function assessRetry(input: {
  status: Pick<GatewayTaskStatus, "taskId" | "status" | "taskState" | "waitReason" | "assignedWorker">;
  /** Newest still-active task whose lineage points at this one (trusted runtime state). */
  activeRetryId: string | null;
  decomposed: boolean;
  /** Scheduler's trusted Worker availability; absent = unknown. */
  availability: Partial<Record<WorkerKind, WorkerAvailabilityState>> | null;
}): RetryAssessment {
  const s = input.status;
  const outcome = outcomeOf(s);
  const failureClass = outcome === "failed" || outcome === "cancelled" ? terminalClass(s.waitReason) : null;
  const base = { taskId: s.taskId, outcome, failureClass, worker: s.assignedWorker ?? null };
  if (outcome === "active") {
    const waiting =
      s.status === "needs_human_decision" || s.status === "blocked"
        ? "decision"
        : s.status === "needs_human_approval"
          ? "approval"
          : s.status === "waiting_worker_quota" || s.status === "waiting_worker_availability"
            ? "availability"
            : "working";
    return { ...base, eligibility: { kind: "in_progress", waiting } };
  }
  if (input.activeRetryId) return { ...base, eligibility: { kind: "retry_in_progress", retryTaskId: input.activeRetryId } };
  if (input.decomposed) return { ...base, eligibility: { kind: "not_supported", reason: "decomposed_part" } };
  if (outcome === "completed") return { ...base, eligibility: { kind: "allowed", rerun: true, caution: "none" } };
  if (outcome === "cancelled") return { ...base, eligibility: { kind: "allowed", rerun: false, caution: "none" } };
  const cause = failureClass ? CAUSE[failureClass] : undefined;
  if (cause) {
    const a = s.assignedWorker ? input.availability?.[s.assignedWorker] : undefined;
    // Unknown or not-available: never claim a re-run would work now.
    if (!a || a.status !== "available") return { ...base, eligibility: { kind: "wait_recovery", cause, resetAt: a?.resetAt ?? null } };
    // Quota recovery is observable (the scheduler tracks it); a login / runtime repair is not.
    return { ...base, eligibility: { kind: "allowed", rerun: false, caution: cause === "quota" ? "none" : "recovery_unverified" } };
  }
  const caution = failureClass === null ? "unknown_cause" : failureClass === "scope" || failureClass === "budget" ? "may_repeat" : "none";
  return { ...base, eligibility: { kind: "allowed", rerun: false, caution } };
}
