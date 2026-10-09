import { isProtectedBranch } from "../domain/risk";
import { checkTaskBranchName, isValidSha } from "./naming";

/**
 * Runtime baseline and task base resolution (pure).
 *
 * The Agent runtime runs from the code checked out in the fixed workspace,
 * and the container postStartCommand boots whatever is checked out there. A
 * task branch is that checkout while a task is active (and after a crash or
 * stop), so it must never be older than the runtime that created it:
 *
 *   - the runtime baseline is the non-task, non-protected branch + HEAD SHA the
 *     runtime was started from (recorded durably, so a restart on a task branch
 *     keeps the identity);
 *   - new task branches start from main only when main already contains the
 *     baseline; when the baseline is strictly ahead of main they start from the
 *     baseline; a diverged baseline fails closed (neither choice is safe).
 */

export interface RuntimeBaseline {
  branch: string;
  sha: string;
}

/** GitHub compare status of `head` relative to `base` (null: a commit is unknown to the remote). */
export type CommitRelation = "ahead" | "behind" | "identical" | "diverged";

const RUNTIME_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}$/;

/** A branch the runtime may run from and the workspace may return to: never main/master or a task branch. */
export function isRuntimeBranch(branch: unknown): branch is string {
  if (typeof branch !== "string" || !RUNTIME_BRANCH_RE.test(branch)) return false;
  if (branch === "HEAD" || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock") || branch.includes("@{")) return false;
  // Case variants too: refs can collide on case-insensitive filesystems.
  if (isProtectedBranch(branch) || /^(refs\/heads\/)?(main|master)$/i.test(branch)) return false;
  return !checkTaskBranchName(branch).ok;
}

export function isRuntimeBaseline(value: unknown): value is RuntimeBaseline {
  const v = value as RuntimeBaseline;
  return typeof v === "object" && v !== null && isRuntimeBranch(v.branch) && isValidSha(v.sha);
}

export type BaselineResolution =
  | { ok: true; baseline: RuntimeBaseline; record: boolean }
  | { ok: false; code: "runtime_baseline_unknown" | "runtime_baseline_unsafe_branch"; reason: string };

/**
 * Started on a runtime branch: that branch/HEAD is the baseline (recorded when new).
 * Started on a task branch (crash / stop mid-task, or a legacy checkout): the
 * recorded baseline is kept. Anything else fails closed.
 */
export function establishRuntimeBaseline(current: { branch: string; headSha: string }, recorded: RuntimeBaseline | null): BaselineResolution {
  if (isRuntimeBranch(current.branch) && isValidSha(current.headSha)) {
    const baseline = { branch: current.branch, sha: current.headSha };
    return { ok: true, baseline, record: !recorded || recorded.branch !== baseline.branch || recorded.sha !== baseline.sha };
  }
  if (checkTaskBranchName(current.branch).ok) {
    if (isRuntimeBaseline(recorded)) return { ok: true, baseline: { branch: recorded.branch, sha: recorded.sha }, record: false };
    return { ok: false, code: "runtime_baseline_unknown", reason: "runtime started on a task branch and no runtime baseline was recorded" };
  }
  return { ok: false, code: "runtime_baseline_unsafe_branch", reason: "runtime must start from a non-protected runtime branch or a task branch" };
}

/** Why no task base could be chosen; `code` is safe to show and audit. */
export class TaskBaseError extends Error {
  constructor(
    readonly code: "main_unavailable" | "baseline_invalid" | "baseline_diverged" | "baseline_unpublished",
    message: string,
  ) {
    super(message);
    this.name = "TaskBaseError";
  }
}

/**
 * The commit a new task branch starts from. `relation` is compare(main → baseline).
 * Throws (fail closed) when the base cannot include both main and the runtime.
 */
export function resolveTaskBaseSha(input: { mainSha: string | null; baseline: RuntimeBaseline | null; relation: CommitRelation | null }): string {
  if (!isValidSha(input.mainSha)) throw new TaskBaseError("main_unavailable", "main head is unavailable");
  const baseline = input.baseline;
  if (!baseline || baseline.sha === input.mainSha) return input.mainSha;
  if (!isValidSha(baseline.sha)) throw new TaskBaseError("baseline_invalid", "runtime baseline SHA is invalid");
  switch (input.relation) {
    case "ahead":
      return baseline.sha;
    case "behind":
    case "identical":
      return input.mainSha;
    case "diverged":
      throw new TaskBaseError("baseline_diverged", "runtime baseline diverged from main; refusing to plan a task branch that drops runtime or main commits");
    default:
      throw new TaskBaseError("baseline_unpublished", "runtime baseline commit is not available on the remote");
  }
}

export type RuntimeRestoreDecision =
  | { action: "return"; branch: string; sha: string }
  | {
      action: "stay";
      reason: "no_baseline" | "already_on_runtime" | "not_on_task_branch" | "task_active" | "dirty_worktree" | "unsafe_runtime_branch" | "runtime_branch_missing" | "runtime_branch_moved";
    };

/**
 * Whether the idle workspace should leave a finished task branch for the runtime
 * branch. Only a clean task-branch checkout with no active task is ever moved,
 * and only onto the exact recorded baseline.
 */
export function decideRuntimeRestore(input: {
  status: { branch: string; dirtyPaths: readonly string[] };
  baseline: RuntimeBaseline | null;
  /** True while any non-terminal task owns a branch, lease, worker, or side effect. */
  taskActive: boolean;
  /** Local refs/heads/<baseline.branch>, null when absent. */
  localBaselineSha: string | null;
}): RuntimeRestoreDecision {
  const { status, baseline } = input;
  if (!baseline) return { action: "stay", reason: "no_baseline" };
  if (!isRuntimeBaseline(baseline)) return { action: "stay", reason: "unsafe_runtime_branch" };
  if (status.branch === baseline.branch) return { action: "stay", reason: "already_on_runtime" };
  if (!checkTaskBranchName(status.branch).ok) return { action: "stay", reason: "not_on_task_branch" };
  if (input.taskActive) return { action: "stay", reason: "task_active" };
  if (status.dirtyPaths.length > 0) return { action: "stay", reason: "dirty_worktree" };
  if (input.localBaselineSha === null) return { action: "stay", reason: "runtime_branch_missing" };
  if (input.localBaselineSha !== baseline.sha) return { action: "stay", reason: "runtime_branch_moved" };
  return { action: "return", branch: baseline.branch, sha: baseline.sha };
}
