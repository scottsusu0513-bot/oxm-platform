import { checkTaskBranchName, isValidSha } from "../branches/naming";
import { decideRuntimeRestore, isRuntimeBranch, type RuntimeBaseline, type RuntimeRestoreDecision } from "../branches/taskBase";
import { isPlannerApproved } from "../branches/planner";
import type { AssignedBranchPlan } from "../branches/types";
import type { GitInspector, GitStatus, ProcessRunner, WorkerTaskContract } from "../workers/types";
import { commitApprovalBinding, isPathInScope, type CommitApprovalEvidence } from "../workers/prompt";
import { isSafeRepoPath } from "../workers/resultParser";
import { normalizeContentIdentities, sameContentIdentities, type PathContentIdentity } from "../workers/gitIntegrity";
import { approvalAuthorizes } from "../store/repositories";
import type { Approval, IsoTimestamp } from "../store/types";
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
 * Once no task is active, restoreRuntimeWorkspace returns a clean finished
 * task-branch checkout to the exact recorded runtime baseline, so a later
 * Codespace cold start boots the runtime rather than a task branch.
 *
 * Git is invoked only through the injected ProcessRunner with fixed argv
 * arrays and the subcommands in WORKSPACE_GIT_SUBCOMMANDS. There is no
 * reset, merge, rebase, clean, force, or main/master code path.
 */

export const WORKSPACE_GIT_SUBCOMMANDS = ["fetch", "rev-parse", "switch"] as const;
export const COMMIT_GIT_SUBCOMMANDS = ["add", "diff", "ls-files", "hash-object", "commit"] as const;

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
export type CommitErrorType = "policy_violation" | "lease_conflict" | "dirty_worktree" | "verification_failed" | "git_error";
export type CommitResult = { ok: true; headSha: string } | { ok: false; error: CommitErrorType; reason: string };
export type CommitStateResult =
  | { ok: true; branch: string; headSha: string; dirtyPaths: string[]; contentIdentities: PathContentIdentity[]; gitMetadataDigest: string }
  | { ok: false; error: "lease_conflict" | "verification_failed"; reason: string };

/** Proof that the workspace was put on the assigned branch at the expected SHA. Issued only here. */
export interface PreparedWorkspace {
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly taskId: string;
  readonly branch: string;
  readonly headSha: string;
  readonly allowedDirtyPaths: readonly string[];
  /** Trusted Git metadata baseline captured after preparation; the Worker must leave it unchanged. */
  readonly gitMetadataDigest: string;
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

function assertRuntimeBranch(branch: string): void {
  if (!isRuntimeBranch(branch)) throw new Error("refusing workspace git op: not a runtime branch");
}

export function buildResolveRuntimeArgs(branch: string): string[] {
  assertRuntimeBranch(branch);
  return ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`];
}

/** Returns an idle workspace to the runtime branch; refuses (git default) if local changes would be lost. */
export function buildRuntimeSwitchArgs(branch: string): string[] {
  assertRuntimeBranch(branch);
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
const commitFail = (error: CommitErrorType, reason: string) => ({ ok: false as const, error, reason });

export function dirtyViolations(status: GitStatus, allowed: readonly string[]): string[] {
  const ok = new Set(allowed);
  return status.dirtyPaths.filter((p) => !ok.has(p));
}

/** Runs one WORKSPACE_GIT_SUBCOMMANDS command; `allowMissing` maps an empty exit-1 (rev-parse --quiet) to null. */
function workspaceGit(deps: Pick<WorkspaceDeps, "runner" | "repoRoot">) {
  return async (args: string[], allowMissing = false): Promise<string | null> => {
    if (!(WORKSPACE_GIT_SUBCOMMANDS as readonly string[]).includes(args[0])) throw new Error("git subcommand not allowed");
    const res = await deps.runner.spawn({ command: "git", args, cwd: deps.repoRoot }).exit;
    if (res.truncated) throw new Error("git output truncated");
    if (res.exitCode !== 0) {
      if (allowMissing && res.exitCode === 1 && res.stdout.trim() === "") return null;
      throw new Error(`git ${args[0]} failed`);
    }
    return res.stdout.trim();
  };
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

  const git = workspaceGit(deps);

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
    const gitMetadataDigest = await deps.git.metadataDigest();

    const result: PreparedWorkspace = Object.freeze({
      workspaceId: lease.workspaceId,
      leaseId: lease.leaseId,
      taskId: plan.taskId,
      branch: plan.branch,
      headSha: expected,
      allowedDirtyPaths: Object.freeze(allowedDirty),
      gitMetadataDigest,
    });
    prepared.add(result);
    return { ok: true, prepared: result };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "non-Error";
    return fail("git_error", `workspace git operation failed (${kind}); failing closed`);
  }
}

/** Trusted packaging of a validated Worker edit. The Worker cannot write Git metadata. */
export async function commitValidatedChanges(
  input: {
    plan: unknown;
    lease: unknown;
    evidence: CommitApprovalEvidence;
    approval: Approval;
    at: IsoTimestamp;
  },
  deps: WorkspaceDeps,
): Promise<CommitResult> {
  const plan = input?.plan;
  if (!isPlannerApproved(plan)) return commitFail("policy_violation", "branch plan was not produced by the deterministic planner");
  const name = checkTaskBranchName(plan.branch);
  if (!name.ok) return commitFail("policy_violation", name.reason);
  const evidence = input.evidence;
  if (!isValidSha(evidence.expectedHeadSha)) return commitFail("policy_violation", "expected HEAD is not a valid SHA");
  if (evidence.taskId !== plan.taskId || evidence.branch !== plan.branch) {
    return commitFail("policy_violation", "commit approval evidence belongs to another task/branch");
  }
  const authorized = approvalAuthorizes(input.approval, {
    taskId: plan.taskId,
    kind: "commit_publish",
    bindingShaOrActionId: commitApprovalBinding(evidence),
    at: input.at,
  });
  if (!authorized.ok || input.approval.requestedAction !== evidence.action) {
    return commitFail("policy_violation", "approval does not authorize this exact trusted commit state");
  }
  if (
    evidence.authorization?.commit !== true ||
    evidence.authorization.normalPush !== true ||
    evidence.authorization.openOrReusePr !== true ||
    evidence.authorization.merge !== false ||
    evidence.authorization.deploy !== false
  ) return commitFail("policy_violation", "commit approval contains invalid authority limits");
  const lease = input.lease;
  if (!deps.leases.holds(lease)) return commitFail("lease_conflict", "workspace lease is not held");
  if (lease.taskId !== plan.taskId || lease.branch !== plan.branch || lease.lineageId !== plan.lineageId) {
    return commitFail("lease_conflict", "workspace lease belongs to a different task/branch");
  }
  const paths = Array.from(new Set(evidence.changedPaths)).sort();
  if (paths.length === 0 || paths.some((path) => !isSafeRepoPath(path) || !isPathInScope(path, evidence.allowedScope))) {
    return commitFail("policy_violation", "validated changed paths are empty, unsafe, or outside allowedScope");
  }
  const approvedContent = normalizeContentIdentities(evidence.contentIdentities ?? []);
  if (
    approvedContent.length !== paths.length ||
    approvedContent.some((id, i) => id.path !== paths[i] || (id.mode === "absent") !== (id.blob === null) || (id.blob !== null && !/^[0-9a-f]{40}$/.test(id.blob)))
  ) {
    return commitFail("policy_violation", "approved content identities do not cover exactly the validated paths");
  }
  if (typeof evidence.gitMetadataDigest !== "string" || !/^[0-9a-f]{64}$/.test(evidence.gitMetadataDigest)) {
    return commitFail("policy_violation", "approval is not bound to a Git metadata baseline");
  }
  const samePaths = (actual: readonly string[]) => {
    const normalized = Array.from(new Set(actual)).sort();
    return normalized.length === paths.length && normalized.every((path, index) => path === paths[index]);
  };
  const run = async (args: string[]): Promise<string> => {
    if (!(COMMIT_GIT_SUBCOMMANDS as readonly string[]).includes(args[0])) throw new Error("git subcommand not allowed");
    const result = await deps.runner.spawn({ command: "git", args, cwd: deps.repoRoot }).exit;
    if (result.exitCode !== 0 || result.truncated) throw new Error(`git ${args[0]} failed`);
    return result.stdout;
  };
  /** Approved bytes and Git metadata must be exactly what the human approved; drift makes the approval stale. */
  const verifyApprovedState = async (): Promise<CommitResult | null> => {
    if ((await deps.git.metadataDigest()) !== evidence.gitMetadataDigest) {
      return commitFail("verification_failed", "Git metadata changed after approval; approval is stale");
    }
    if (!sameContentIdentities(await deps.git.contentIdentities(paths), approvedContent)) {
      return commitFail("verification_failed", "working-tree content changed after approval; approval is stale");
    }
    return null;
  };
  try {
    const before = await deps.git.status();
    if (before.branch !== plan.branch || before.headSha !== evidence.expectedHeadSha) {
      return commitFail("verification_failed", "workspace branch or HEAD moved before trusted commit");
    }
    if (!samePaths(before.dirtyPaths)) return commitFail("dirty_worktree", "working tree contains foreign, missing, or unowned dirty paths");
    const stale = await verifyApprovedState();
    if (stale) return stale;

    const alreadyStaged = (await run(["diff", "--cached", "--no-renames", "--name-only", "-z", "--"])).split("\0").filter(Boolean);
    if (alreadyStaged.length !== 0) return commitFail("dirty_worktree", "workspace contains pre-existing staged paths");
    await run(["add", "--", ...paths]);
    const staged = (await run(["diff", "--cached", "--no-renames", "--name-only", "-z", "--"])).split("\0").filter(Boolean);
    if (!samePaths(staged)) return commitFail("dirty_worktree", "staged paths do not exactly match the validated paths");

    // The index must hold exactly the approved bytes: present paths staged as Git would hash the
    // approved file (filters included), absent paths removed. Symlinks are stored verbatim.
    const index = new Map<string, string>();
    for (const entry of (await run(["ls-files", "--stage", "-z", "--", ...paths])).split("\0").filter(Boolean)) {
      const m = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.+)$/.exec(entry);
      if (!m || m[3] !== "0" || index.has(m[4])) return commitFail("verification_failed", "index entry for an approved path is malformed or conflicted");
      index.set(m[4], m[2]);
    }
    const files = approvedContent.filter((id) => id.mode === "100644" || id.mode === "100755").map((id) => id.path);
    const hashed = files.length ? (await run(["hash-object", "--", ...files])).split(/\r?\n/).filter(Boolean) : [];
    if (hashed.length !== files.length) return commitFail("verification_failed", "could not hash approved files");
    const expectedIndex = new Map(files.map((path, i) => [path, hashed[i]]));
    for (const id of approvedContent) if (id.mode === "120000") expectedIndex.set(id.path, id.blob as string);
    if (index.size !== expectedIndex.size || Array.from(expectedIndex).some(([path, blob]) => index.get(path) !== blob)) {
      return commitFail("verification_failed", "staged content does not match the approved bytes");
    }
    const staleAfterStage = await verifyApprovedState();
    if (staleAfterStage) return staleAfterStage;

    // No pathspec: commit exactly the verified index (a pathspec would re-read the working tree).
    await run(["commit", "--no-verify", "--message", `chore(agent): apply task ${plan.taskId}`]);

    const after = await deps.git.status();
    const committedPaths = await deps.git.changedPathsSince(evidence.expectedHeadSha);
    if (after.branch !== plan.branch || after.headSha === evidence.expectedHeadSha || !isValidSha(after.headSha)) {
      return commitFail("verification_failed", "trusted commit did not advance the assigned branch HEAD");
    }
    if (after.dirtyPaths.length !== 0 || !samePaths(committedPaths)) {
      return commitFail("verification_failed", "trusted commit did not contain exactly the validated paths");
    }
    return { ok: true, headSha: after.headSha };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "non-Error";
    return commitFail("git_error", `trusted commit operation failed (${kind}); failing closed`);
  }
}

/** Read-only trusted state used before presenting and after granting approval. */
export async function observeCommitState(lease: unknown, deps: WorkspaceDeps): Promise<CommitStateResult> {
  if (!deps.leases.holds(lease)) return { ok: false, error: "lease_conflict", reason: "workspace lease is not held" };
  try {
    const status = await deps.git.status();
    const dirtyPaths = Array.from(new Set(status.dirtyPaths)).sort();
    return {
      ok: true,
      branch: status.branch,
      headSha: status.headSha,
      dirtyPaths,
      contentIdentities: normalizeContentIdentities(await deps.git.contentIdentities(dirtyPaths)),
      gitMetadataDigest: await deps.git.metadataDigest(),
    };
  } catch {
    return { ok: false, error: "verification_failed", reason: "trusted workspace state is unavailable" };
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
  /** Live Git metadata digest; must equal the baseline captured at preparation. */
  metadataDigest: string;
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
  if (input.metadataDigest !== p.gitMetadataDigest) return { ok: false, reason: "Git metadata changed since preparation" };
  if (contract.gitMetadataDigest !== undefined && contract.gitMetadataDigest !== p.gitMetadataDigest) {
    return { ok: false, reason: "contract expects a different Git metadata baseline" };
  }
  return { ok: true, contract: { ...contract, expectedHeadSha: p.headSha, gitMetadataDigest: p.gitMetadataDigest } };
}

export type RuntimeRestoreResult =
  | { ok: true; decision: RuntimeRestoreDecision }
  | { ok: false; error: "verification_failed" | "git_error"; reason: string };

/**
 * Moves an idle, clean task-branch checkout back onto the runtime baseline
 * branch (only when it is exactly at the recorded baseline SHA). The caller
 * states whether any task is active; this re-reads Git and never forces.
 */
export async function restoreRuntimeWorkspace(
  input: { baseline: RuntimeBaseline | null; taskActive: boolean },
  deps: Pick<WorkspaceDeps, "runner" | "git" | "repoRoot">,
): Promise<RuntimeRestoreResult> {
  const git = workspaceGit(deps);
  try {
    const status = await deps.git.status();
    const baseline = input.baseline;
    const localBaselineSha = baseline && isRuntimeBranch(baseline.branch) ? await git(buildResolveRuntimeArgs(baseline.branch), true) : null;
    const decision = decideRuntimeRestore({ status, baseline, taskActive: input.taskActive, localBaselineSha });
    if (decision.action !== "return") return { ok: true, decision };
    await git(buildRuntimeSwitchArgs(decision.branch));
    const after = await deps.git.status();
    if (after.branch !== decision.branch || after.headSha !== decision.sha || after.dirtyPaths.length !== 0) {
      return { ok: false, error: "verification_failed", reason: "workspace is not on the clean runtime baseline after restore" };
    }
    return { ok: true, decision };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "non-Error";
    return { ok: false, error: "git_error", reason: `runtime restore git operation failed (${kind}); workspace left as is` };
  }
}
