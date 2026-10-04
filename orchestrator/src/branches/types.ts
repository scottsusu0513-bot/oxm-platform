/**
 * Phase 2C.5 Branch Planner — types.
 *
 * Branch strategy is decided by the Manager/Orchestrator only, through the
 * deterministic planner in planner.ts. Workers never choose, create, or
 * switch branches, and nothing a worker reports can become a branch name.
 * Pure type/constant definitions: no I/O, env, network, or nondeterminism.
 */
import type { TaskCategory, TaskState } from "../domain/types";
import type { PullRequestState } from "../github/types";

/** The only base branch task branches are planned from and PRs target. */
export const BASE_BRANCH = "main" as const;
export type BaseBranch = typeof BASE_BRANCH;

/** Every task branch name starts with this prefix (see naming.ts). */
export const TASK_BRANCH_PREFIX = "agent/task-" as const;

export const BRANCH_DECISIONS = ["new_branch", "reuse_branch", "queue", "reject"] as const;
export type BranchDecisionKind = (typeof BRANCH_DECISIONS)[number];

/** Normalized record of in-flight work, suitable for future Manager use. */
export interface ActiveWork {
  taskId: string;
  /** Root task id of the logical task/epic this work belongs to (taskId when standalone). */
  lineageId: string;
  branch: string;
  /** Repo-relative paths; a trailing "/" marks a directory prefix. */
  expectedPaths: readonly string[];
  state: TaskState;
  prNumber: number | null;
  prState: PullRequestState | null;
  workerRunning: boolean;
  baseSha: string;
}

/** Remote state of a branch that might be reused; supplied by the orchestrator, never a worker. */
export interface ExistingBranchState {
  name: string;
  headSha: string;
  /** SHA the branch was originally created from. */
  baseSha: string;
  /** Lineage recorded when the branch was created by the orchestrator. */
  lineageId: string;
  prNumber: number | null;
  prState: PullRequestState | null;
  /** Paths changed on the branch relative to its base. */
  changedPaths: readonly string[];
  workerRunning: boolean;
}

export interface BranchLineage {
  /** Root task id; the branch is named after it. */
  rootTaskId: string;
  /** Root task title; slug source for the branch name. */
  title: string;
}

export interface BranchPlanRequest {
  taskId: string;
  category: TaskCategory;
  /** Human title; used only to derive a sanitized slug. */
  title: string;
  /** Repo-relative paths the task expects to change (trailing "/" = directory). */
  expectedPaths: readonly string[];
  baseBranch: string;
  /** Current base (main) SHA the plan binds to. */
  baseSha: string;
  /** Set when the task continues an existing logical task/epic. */
  lineage?: BranchLineage;
  /** Known remote state of the lineage branch, if one exists. */
  existingBranch?: ExistingBranchState | null;
  /** Reuse of an existing branch must be explicitly authorized by the Manager. */
  allowReuse?: boolean;
  /** A branch explicitly asked for (e.g. by an operator); must equal the derived name. */
  requestedBranch?: string;
}

export interface BranchPlanContext {
  active: readonly ActiveWork[];
  /** Overrides DEFAULT_HIGH_CONFLICT_PATHS (see overlap.ts). */
  highConflictPaths?: readonly string[];
}

export interface QueueBlocker {
  taskId: string;
  branch: string;
  reason: string;
}

interface PlanBase {
  taskId: string;
  lineageId: string;
  /** Deterministically ordered, human-readable reasons. */
  reasons: string[];
}

export interface NewBranchPlan extends PlanBase {
  decision: "new_branch";
  branch: string;
  baseBranch: BaseBranch;
  baseSha: string;
  expectedPaths: string[];
}

export interface ReuseBranchPlan extends PlanBase {
  decision: "reuse_branch";
  branch: string;
  baseBranch: BaseBranch;
  /** The branch's original base SHA. */
  baseSha: string;
  /** Remote head the branch must still be at when work is pushed. */
  headSha: string;
  prNumber: number | null;
  expectedPaths: string[];
}

export interface QueuePlan extends PlanBase {
  decision: "queue";
  blockedBy: QueueBlocker[];
}

export interface RejectPlan extends PlanBase {
  decision: "reject";
}

export type BranchPlan = NewBranchPlan | ReuseBranchPlan | QueuePlan | RejectPlan;
/** A plan that assigns a branch to the task. */
export type AssignedBranchPlan = NewBranchPlan | ReuseBranchPlan;
