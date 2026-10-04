import { checkTaskBranchName, isValidSha } from "../branches/naming";
import { isPlannerApproved } from "../branches/planner";
import type { AssignedBranchPlan } from "../branches/types";
import type { GitInspector, GitStatus, ProcessRunner, WorkerTaskContract } from "../workers/types";
import { expectedRemoteHead } from "./flow";
import type { WorkspaceLease, WorkspaceLeaseRegistry } from "./lease";
import { PUSH_REMOTE } from "./transport";
import type { BranchCreation } from "./types";

/**
 * Orchestrator-side local workspace activation. The worker stays
 * branch-passive: only this module moves the working tree, and only onto the
 * planner-assigned task branch at the exact SHA the plan accepted.
 *
 *   approved plan + held lease → clean/allowed-dirty, non-detached tree →
 *   fetch exactly refs/heads/<branch> (non-force) → remote head == expected →
 *   local branch absent: create it at the expected SHA / present: must already
 *   be at the expected SHA → switch (never with --force/--discard-changes) →
 *   verify branch + HEAD → PreparedWorkspace (frozen, registered).
 *
 * Git is invoked only through the injected ProcessRunner with fixed argv
 * arrays and the subcommands in WORKSPACE_GIT_SUBCOMMANDS. There is no
 * reset, merge, rebase, clean, force, or main/master code path.
 */

export const WORKSPACE_GIT_SUBCOMMANDS = ["fetch", "rev-parse", "switch"] as const;

export const PREPARE_ERRORS = [
  "policy_violation",
  "lease_conflict",
  "detached_head",
  "dirty_worktree",
  "branch_missing",
  "remote_moved",
  "local_diverged",
  "verification_failed",
  "git_error",
] as const;
export type PrepareErrorType = (typeof PREPARE_ERRORS)[number];

export type PrepareResult = { ok: true; prepared: PreparedWorkspace } | { ok: false; error: PrepareErrorType; reason: string };

/** Proof that the workspace was put on the assigned branch at the expected SHA. Issued only here. */
export interface PreparedWorkspace {
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly taskId: string;
  readonly branch: string;
  readonly headSha: string;
  readonly allowedDirtyPaths: readonly string[];
}

const prepared = new WeakSet<object>();

export function isPreparedWorkspace(value: unknown): value is PreparedWorkspace {
  return typeof value === "object" && value !== null && prepared.has(value);
}

// ---- argv builders (each validates its inputs and returns a fixed template)

function assertTaskBranch(branch: string): void {
  const name = checkTaskBranchName(branch);
  if (!name.ok) throw new Error(`refusing workspace git op: ${name.reason}`);
}

/** Non-force fetch of exactly one task branch into its remote-tracking ref (no "+", no tags). */
export function buildFetchArgs(branch: string): string[] {
  assertTaskBranch(branch);
  return ["fetch", "--no-tags", "--no-recurse-submodules", PUSH_REMOTE, `refs/heads/${branch}:refs/remotes/${PUSH_REMOTE}/${branch}`];
}

export function buildResolveArgs(ref: "local" | "remote", branch: string): string[] {
  assertTaskBranch(branch);
  const full = ref === "local" ? `refs/heads/${branch}` : `refs/remotes/${PUSH_REMOTE}/${branch}`;
  return ["rev-parse", "--verify", "--quiet", `${full}^{commit}`];
}

/** Creates the local task branch at an explicit SHA (fails if it already exists). */
export function buildCreateSwitchArgs(branch: string, sha: string): string[] {
  assertTaskBranch(branch);
  if (!isValidSha(sha)) throw new Error("refusing workspace git op: invalid SHA");
  return ["switch", "--no-track", "--create", branch, sha];
}

/** Switches to an existing local task branch; refuses (git default) if local changes would be lost. */
export function buildSwitchArgs(branch: string): string[] {
  assertTaskBranch(branch);
  return ["switch", "--no-guess", branch];
}

export interface WorkspaceDeps {
  runner: ProcessRunner;
  git: GitInspector;
  repoRoot: string;
  leases: WorkspaceLeaseRegistry;
}

export interface PrepareInput {
  plan: unknown;
  lease: unknown;
  /** Required for new_branch plans: the client's creation result for this plan. */
  creation?: BranchCreation | null;
  /** Pre-existing dirty paths that are explicitly part of this task (same policy as the worker). */
  allowedDirtyPaths?: readonly string[];
}

const fail = (error: PrepareErrorType, reason: string) => ({ ok: false as const, error, reason });

export function dirtyViolations(status: GitStatus, allowed: readonly string[]): string[] {
  const ok = new Set(allowed);
  return status.dirtyPaths.filter((p) => !ok.has(p));
}

export async function prepareAssignedWorkspace(input: PrepareInput, deps: WorkspaceDeps): Promise<PrepareResult> {
  // --- policy (pure)
  const plan = input?.plan;
  if (!isPlannerApproved(plan)) return fail("policy_violation", "branch plan was not produced by the deterministic planner");
  const name = checkTaskBranchName(plan.branch);
  if (!name.ok) return fail("policy_violation", name.reason);
  const lease = input.lease;
  if (!deps.leases.holds(lease)) return fail("lease_conflict", "workspace lease is not held");
  if (lease.taskId !== plan.taskId || lease.branch !== plan.branch || lease.lineageId !== plan.lineageId) {
    return fail("lease_conflict", "workspace lease belongs to a different task/branch");
  }
  if (plan.decision === "new_branch") {
    const c = input.creation;
    if (!c || c.taskId !== plan.taskId || c.branch !== plan.branch || c.baseSha !== plan.baseSha) {
      return fail("policy_violation", "new branch must be created (and match the plan) before workspace preparation");
    }
  }
  const expected = expectedRemoteHead(plan);
  const allowedDirty = [...(input.allowedDirtyPaths ?? [])];

  const git = async (args: string[], allowMissing = false): Promise<string | null> => {
    if (!(WORKSPACE_GIT_SUBCOMMANDS as readonly string[]).includes(args[0])) throw new Error("git subcommand not allowed");
    const res = await deps.runner.spawn({ command: "git", args, cwd: deps.repoRoot }).exit;
    if (res.truncated) throw new Error("git output truncated");
    if (res.exitCode !== 0) {
      if (allowMissing && res.exitCode === 1 && res.stdout.trim() === "") return null;
      throw new Error(`git ${args[0]} failed`);
    }
    return res.stdout.trim();
  };

  try {
    // --- working tree preflight
    const before = await deps.git.status();
    if (before.branch === "HEAD") return fail("detached_head", "workspace is on a detached HEAD");
    const dirty = dirtyViolations(before, allowedDirty);
    if (dirty.length) return fail("dirty_worktree", `${dirty.length} unrelated dirty path(s) present`);

    // --- remote state of exactly this branch
    try {
      await git(buildFetchArgs(plan.branch));
    } catch {
      return fail("branch_missing", "assigned branch could not be fetched from the remote (missing or non-fast-forward)");
    }
    const remote = await git(buildResolveArgs("remote", plan.branch), true);
    if (remote === null) return fail("branch_missing", "assigned branch has no remote-tracking ref after fetch");
    if (remote !== expected) {
      return fail("remote_moved", `remote ${plan.branch} is at ${remote}, plan accepted ${expected}; re-plan required`);
    }

    // --- local branch: create at expected SHA, or require it already there
    const local = await git(buildResolveArgs("local", plan.branch), true);
    if (local === null) {
      await git(buildCreateSwitchArgs(plan.branch, expected));
    } else {
      if (local !== expected) {
        return fail("local_diverged", `local ${plan.branch} is at ${local}, expected ${expected}; refusing to move it`);
      }
      if (before.branch !== plan.branch) await git(buildSwitchArgs(plan.branch));
    }

    // --- verify
    const after = await deps.git.status();
    if (after.branch !== plan.branch) return fail("verification_failed", "workspace is not on the assigned branch after preparation");
    if (after.headSha !== expected) return fail("verification_failed", "workspace HEAD is not the expected SHA after preparation");
    const dirtyAfter = dirtyViolations(after, allowedDirty);
    if (dirtyAfter.length) return fail("verification_failed", "unexpected dirty paths after preparation");

    const result: PreparedWorkspace = Object.freeze({
      workspaceId: lease.workspaceId,
      leaseId: lease.leaseId,
      taskId: plan.taskId,
      branch: plan.branch,
      headSha: expected,
      allowedDirtyPaths: Object.freeze(allowedDirty),
    });
    prepared.add(result);
    return { ok: true, prepared: result };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "non-Error";
    return fail("git_error", `workspace git operation failed (${kind}); failing closed`);
  }
}

export type PreconditionResult = { ok: true; contract: WorkerTaskContract } | { ok: false; reason: string };

/**
 * Pure gate before workerStartIntent / adapter.start(): the contract must be
 * bound to a prepared workspace (branch + expectedHeadSha), the lease must
 * still be held, and the live tree must be exactly on that branch/HEAD with
 * only allowed dirty paths. Returns the contract with expectedHeadSha set so
 * the worker's own preflight re-checks HEAD and fails closed.
 */
export function checkWorkerPreconditions(input: {
  prepared: unknown;
  plan: unknown;
  contract: WorkerTaskContract;
  status: GitStatus;
  leases: WorkspaceLeaseRegistry;
  lease: unknown;
}): PreconditionResult {
  const { prepared: p, plan, contract, status } = input;
  if (!isPreparedWorkspace(p)) return { ok: false, reason: "workspace was not prepared by the orchestrator" };
  if (!isPlannerApproved(plan)) return { ok: false, reason: "branch plan was not produced by the deterministic planner" };
  const assigned: AssignedBranchPlan = plan;
  if (p.taskId !== assigned.taskId || p.branch !== assigned.branch) return { ok: false, reason: "prepared workspace does not match the plan" };
  if (!input.leases.holds(input.lease) || (input.lease as WorkspaceLease).leaseId !== p.leaseId) {
    return { ok: false, reason: "workspace lease is no longer held by this task" };
  }
  if (contract.taskId !== p.taskId || contract.branch !== p.branch) return { ok: false, reason: "contract is not bound to the prepared branch" };
  if (contract.expectedHeadSha !== undefined && contract.expectedHeadSha !== p.headSha) {
    return { ok: false, reason: "contract expects a different HEAD than the prepared workspace" };
  }
  if (status.branch === "HEAD") return { ok: false, reason: "workspace is on a detached HEAD" };
  if (status.branch !== p.branch) return { ok: false, reason: "workspace is not on the assigned branch" };
  if (status.headSha !== p.headSha) return { ok: false, reason: "workspace HEAD moved since preparation" };
  if (dirtyViolations(status, contract.allowedDirtyPaths ?? p.allowedDirtyPaths).length) {
    return { ok: false, reason: "unrelated dirty paths present" };
  }
  return { ok: true, contract: { ...contract, expectedHeadSha: p.headSha } };
}
