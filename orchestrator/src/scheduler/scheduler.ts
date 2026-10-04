import { DEFAULT_HIGH_CONFLICT_PATHS, findOverlaps, highConflictHits, normalizePathSet } from "../branches/overlap";
import { dependencyState, type DependencyState } from "./dependencies";
import { orderQueue } from "./queue";
import type { ScheduleDecision, SchedulerInput, SchedulerTaskView } from "./types";

/**
 * Pure, deterministic dispatch decision. Same input → same decisions.
 *
 * Only tasks in TaskState "queued" that are not in flight are candidates
 * (red tasks reach "queued" only through their pre-execution approval).
 * Candidates are visited in queue order; each one either dispatches or
 * waits with an explicit reason. A ready-but-waiting candidate *reserves*
 * its workspace and paths, so a lower-priority task that conflicts with it
 * cannot jump ahead and starve it.
 *
 * Path conflicts reuse the branch planner's overlap policy (exact, directory
 * and high-conflict files). Same-lineage overlap is also treated as a
 * conflict: lineage reuse is decided by the branch planner at dispatch time,
 * and the planner queues while a worker is running on the lineage branch.
 * The branch planner and the lease registry remain authoritative: a
 * "dispatch" here is only a candidate for planBranch + lease acquisition.
 */

interface Reservation {
  taskId: string;
  workspaceId: string;
  paths: string[];
}

export function decideSchedule(input: SchedulerInput): ScheduleDecision[] {
  const { policy } = input;
  const byId = new Map(input.tasks.map((t) => [t.taskId, t]));
  const statusOf = (id: string) => byId.get(id)?.status ?? null;
  const hc = normalizePathSet(policy.highConflictPaths ?? DEFAULT_HIGH_CONFLICT_PATHS);
  const highConflict = hc.ok ? hc.paths : [];

  const decisions: ScheduleDecision[] = [];
  const decide = (t: SchedulerTaskView, action: ScheduleDecision["action"], reason: string, waitingOn: string[] = []) =>
    decisions.push({ taskId: t.taskId, action, reason, waitingOn: Array.from(new Set(waitingOn)).sort() });

  const reservations: Reservation[] = [];
  let active = 0;
  for (const t of input.tasks) {
    if (!t.inFlight) continue;
    active++;
    const p = normalizePathSet(t.expectedPaths);
    reservations.push({ taskId: t.taskId, workspaceId: t.workspaceId, paths: p.ok ? p.paths : [] });
  }

  const candidates: SchedulerTaskView[] = [];
  for (const t of input.tasks) {
    if (t.inFlight) continue;
    if (t.status === "accepted") decide(t, "completed", "task accepted");
    else if (t.status === "blocked") decide(t, "blocked", "task blocked");
    else if (t.state === "queued") candidates.push(t);
  }

  const deps = new Map<string, DependencyState>(candidates.map((t) => [t.taskId, dependencyState(t.dependsOn, statusOf)]));
  const ready = (id: string) => deps.get(id)?.state === "satisfied";
  const maxActive = Number.isInteger(policy.maxConcurrentTasks) && policy.maxConcurrentTasks > 0 ? policy.maxConcurrentTasks : 1;

  for (const t of orderQueue(candidates, ready)) {
    const dep = deps.get(t.taskId) as DependencyState;
    if (dep.state === "failed") {
      decide(t, "blocked", dep.reason, dep.on);
      continue;
    }
    if (dep.state === "waiting") {
      decide(t, "wait_dependency", `waiting on ${dep.on.join(", ")}`, dep.on);
      continue;
    }
    if (t.worker === null) {
      decide(t, "keep_queued", "no eligible worker routed");
      continue;
    }
    if (!policy.executableWorkers.includes(t.worker)) {
      decide(t, "keep_queued", `worker ${t.worker} is not executable in this phase`);
      continue;
    }
    if (t.workerExecutions >= t.maxWorkerExecutions) {
      decide(t, "blocked", "worker execution budget exhausted");
      continue;
    }
    const paths = normalizePathSet(t.expectedPaths);
    if (!paths.ok || paths.paths.length === 0) {
      decide(t, "blocked", "expected paths are missing or unsafe");
      continue;
    }
    const mine: Reservation = { taskId: t.taskId, workspaceId: t.workspaceId, paths: paths.paths };

    const holder = input.workspaceHolder(t.workspaceId);
    const wsBlockers = [
      ...(holder !== null && holder !== t.taskId ? [holder] : []),
      ...reservations.filter((r) => r.workspaceId === t.workspaceId).map((r) => r.taskId),
    ];
    if (wsBlockers.length > 0) {
      decide(t, "wait_workspace", `workspace ${t.workspaceId} is in use`, wsBlockers);
      reservations.push(mine);
      continue;
    }

    const myHc = highConflictHits(mine.paths, highConflict);
    const conflicts = reservations
      .filter((r) => findOverlaps(mine.paths, r.paths).length > 0 || (myHc.length > 0 && highConflictHits(r.paths, highConflict).length > 0))
      .map((r) => r.taskId);
    if (conflicts.length > 0) {
      decide(t, "wait_branch_conflict", `expected paths conflict with ${Array.from(new Set(conflicts)).sort().join(", ")}`, conflicts);
      reservations.push(mine);
      continue;
    }

    if (active >= maxActive) {
      decide(t, "keep_queued", `max concurrency ${maxActive} reached`);
      reservations.push(mine);
      continue;
    }

    decide(t, "dispatch", "ready");
    reservations.push(mine);
    active++;
  }
  return decisions;
}
