import { isProtectedBranch } from "../domain/risk";
import { isTerminalState } from "../domain/taskState";
import { TASK_CATEGORIES } from "../domain/types";
import { checkTaskBranchName, isValidBranchTaskId, isValidSha, taskBranchName } from "./naming";
import { DEFAULT_HIGH_CONFLICT_PATHS, findOverlaps, highConflictHits, normalizePathSet } from "./overlap";
import {
  BASE_BRANCH,
  type ActiveWork,
  type AssignedBranchPlan,
  type BranchPlan,
  type BranchPlanContext,
  type BranchPlanRequest,
  type QueueBlocker,
} from "./types";

/**
 * Deterministic branch planner. Same request + context → same plan.
 *
 * Order of evaluation (first match wins):
 *   1. reject  — malformed request, protected/foreign branch requested,
 *                invalid base, duplicate dispatch, lineage mismatch,
 *                branch name owned by another lineage, stale/unsafe reuse.
 *   2. queue   — a worker is running on the lineage branch, or the expected
 *                paths overlap (exact, directory, or high-conflict) with any
 *                other active lineage.
 *   3. reuse_branch — explicit allowReuse + same lineage + open/no PR +
 *                no unrelated work on the branch.
 *   4. new_branch — no branch exists yet for this lineage.
 *
 * Plans returned with a branch assignment are frozen and registered, so the
 * GitHub write layer can verify a plan really came from this planner.
 */

const approvedPlans = new WeakSet<object>();

/** True only for new_branch / reuse_branch plans produced by planBranch(). */
export function isPlannerApproved(plan: unknown): plan is AssignedBranchPlan {
  return typeof plan === "object" && plan !== null && approvedPlans.has(plan);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export function planBranch(req: BranchPlanRequest, ctx: BranchPlanContext): BranchPlan {
  const taskId = typeof req?.taskId === "string" ? req.taskId : "";
  const lineageId = req?.lineage?.rootTaskId ?? taskId;
  const reject = (...reasons: string[]): BranchPlan => deepFreeze({ decision: "reject", taskId, lineageId, reasons });

  // --- 1. request validation
  if (!isValidBranchTaskId(taskId)) return reject("invalid task id");
  if (!(TASK_CATEGORIES as readonly string[]).includes(req.category)) return reject("unknown task category");
  if (req.baseBranch !== BASE_BRANCH) {
    return reject(`unsupported base branch ${JSON.stringify(String(req.baseBranch))}; only ${BASE_BRANCH} is supported`);
  }
  if (!isValidSha(req.baseSha)) return reject("invalid base SHA (expected 40 lowercase hex)");
  if (!Array.isArray(req.expectedPaths) || req.expectedPaths.length === 0) {
    return reject("expected changed paths are required for conflict planning");
  }
  const paths = normalizePathSet(req.expectedPaths);
  if (!paths.ok) return reject(`unsafe expected path (${paths.reason})`);
  const hcSet = normalizePathSet(ctx.highConflictPaths ?? DEFAULT_HIGH_CONFLICT_PATHS);
  if (!hcSet.ok) return reject(`invalid high-conflict configuration (${hcSet.reason})`);
  if (req.lineage && !isValidBranchTaskId(req.lineage.rootTaskId)) return reject("invalid lineage root task id");

  const branch = taskBranchName(lineageId, req.lineage?.title ?? req.title, req.category);

  if (req.requestedBranch !== undefined) {
    if (isProtectedBranch(String(req.requestedBranch))) return reject("protected branch requested");
    if (req.requestedBranch !== branch) return reject("requested branch does not match the deterministic task branch");
  }
  const nameCheck = checkTaskBranchName(branch);
  if (!nameCheck.ok) return reject(nameCheck.reason);

  // --- active work normalization (malformed entries fail closed)
  const active: (ActiveWork & { paths: string[] })[] = [];
  for (const w of ctx.active ?? []) {
    if (isTerminalState(w.state)) continue;
    const wp = normalizePathSet(Array.isArray(w.expectedPaths) ? w.expectedPaths : []);
    if (!wp.ok || wp.paths.length === 0) {
      return reject(`active task ${w.taskId} has invalid or unknown expected paths; cannot plan safely`);
    }
    active.push({ ...w, paths: wp.paths });
  }
  active.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));

  if (active.some((w) => w.taskId === taskId)) return reject("task is already active (duplicate dispatch)");
  for (const w of active) {
    if (w.branch === branch && w.lineageId !== lineageId) return reject(`branch ${branch} is owned by another lineage`);
    if (w.lineageId === lineageId && w.branch !== branch) return reject(`lineage ${lineageId} is already on a different branch`);
  }

  // --- existing branch (reuse candidate) validation
  const existing = req.existingBranch ?? null;
  const lineageActive = active.filter((w) => w.lineageId === lineageId);
  if (existing) {
    if (existing.name !== branch) return reject("existing branch does not match the deterministic lineage branch");
    if (existing.lineageId !== lineageId) return reject("task/branch lineage mismatch");
    if (!isValidSha(existing.headSha) || !isValidSha(existing.baseSha)) return reject("existing branch has invalid SHA state");
    if (existing.prState === "merged" || existing.prState === "closed") {
      return reject(`existing branch PR is ${existing.prState}; stale context must not be reused`);
    }
    if (existing.prState === "open" && !(Number.isInteger(existing.prNumber) && (existing.prNumber as number) > 0)) {
      return reject("existing branch has an open PR without a valid PR number");
    }
    if (req.allowReuse !== true) return reject("branch already exists and reuse was not explicitly authorized");
  } else if (lineageActive.length > 0) {
    return reject("lineage branch is active but its remote state is unknown; supply existingBranch to reuse");
  }

  // --- 2. queue on unsafe concurrency
  const blockers: QueueBlocker[] = [];
  if (existing?.workerRunning || lineageActive.some((w) => w.workerRunning)) {
    blockers.push({ taskId: lineageActive.find((w) => w.workerRunning)?.taskId ?? lineageId, branch, reason: "worker already running on lineage branch" });
  }
  const myHc = highConflictHits(paths.paths, hcSet.paths);
  for (const w of active) {
    if (w.lineageId === lineageId) continue;
    const overlaps = findOverlaps(paths.paths, w.paths);
    if (overlaps.length > 0) {
      const shown = overlaps.slice(0, 5).map(([a, b]) => (a === b ? a : `${a} ~ ${b}`));
      blockers.push({ taskId: w.taskId, branch: w.branch, reason: `path overlap: ${shown.join(", ")}` });
      continue;
    }
    const theirHc = highConflictHits(w.paths, hcSet.paths);
    if (myHc.length > 0 && theirHc.length > 0) {
      blockers.push({
        taskId: w.taskId,
        branch: w.branch,
        reason: `both touch high-conflict files (${myHc.join(", ")} / ${theirHc.join(", ")})`,
      });
    }
  }
  if (blockers.length > 0) {
    return deepFreeze({
      decision: "queue",
      taskId,
      lineageId,
      blockedBy: blockers,
      reasons: blockers.map((b) => `blocked by ${b.taskId}: ${b.reason}`),
    });
  }

  // --- 3. reuse
  if (existing) {
    const covered = [...paths.paths, ...lineageActive.flatMap((w) => w.paths)];
    const branchPaths = normalizePathSet(existing.changedPaths);
    if (!branchPaths.ok) return reject(`existing branch has unsafe changed paths (${branchPaths.reason})`);
    const unrelated = branchPaths.paths.filter((p) => findOverlaps([p], covered).length === 0);
    if (unrelated.length > 0) {
      return reject(`existing branch contains unrelated work: ${unrelated.slice(0, 5).join(", ")}`);
    }
    const plan = deepFreeze({
      decision: "reuse_branch" as const,
      taskId,
      lineageId,
      branch,
      baseBranch: BASE_BRANCH,
      baseSha: existing.baseSha,
      headSha: existing.headSha,
      prNumber: existing.prState === "open" ? existing.prNumber : null,
      expectedPaths: paths.paths,
      reasons: [`reusing lineage ${lineageId} branch at ${existing.headSha}`],
    });
    approvedPlans.add(plan);
    return plan;
  }

  // --- 4. new branch
  const plan = deepFreeze({
    decision: "new_branch" as const,
    taskId,
    lineageId,
    branch,
    baseBranch: BASE_BRANCH,
    baseSha: req.baseSha,
    expectedPaths: paths.paths,
    reasons: [`new branch from ${BASE_BRANCH}@${req.baseSha}; no conflicting active work`],
  });
  approvedPlans.add(plan);
  return plan;
}
