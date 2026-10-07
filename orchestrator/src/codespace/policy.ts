import type {
  LifecycleDecision,
  LifecyclePolicy,
  LifecycleWorkload,
  PersistedLifecycleState,
  TrustedCodespaceStatus,
} from "./types";

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = Object.freeze({
  autoStart: true,
  autoStop: true,
  idleGraceMinutes: 10,
  startupTimeoutMinutes: 10,
  maxStartAttempts: 2,
  maxStopAttempts: 2,
  keepAliveForRepair: true,
  maxConcurrentLifecycleOps: 1,
});

const unique = (xs: readonly string[]) => Array.from(new Set(xs)).sort();
const elapsedMinutes = (from: string, now: string) =>
  (Date.parse(now) - Date.parse(from)) / 60_000;

export function hasUsefulWork(
  work: LifecycleWorkload,
  policy: LifecyclePolicy
): boolean {
  if (work.statusQueryOnly) return false;
  return (
    work.runnableTaskIds.length > 0 ||
    work.imminentTaskIds.length > 0 ||
    work.workerRunningTaskIds.length > 0 ||
    work.activeWorkspaceLease ||
    work.orchestrationActive ||
    (policy.keepAliveForRepair && work.repairPendingTaskIds.length > 0)
  );
}

export function decideLifecycle(input: {
  state: PersistedLifecycleState;
  observed: TrustedCodespaceStatus;
  work: LifecycleWorkload;
  policy: LifecyclePolicy;
  now: string;
}): LifecycleDecision {
  const { state, observed, work, policy, now } = input;
  const useful = hasUsefulWork(work, policy);
  const tasks = unique([
    ...work.runnableTaskIds,
    ...work.imminentTaskIds,
    ...work.repairPendingTaskIds,
    ...work.workerRunningTaskIds,
  ]);
  const out = (
    action: LifecycleDecision["action"],
    lifecycleState: LifecycleDecision["state"],
    reasonCode: string,
    attempt = 0
  ): LifecycleDecision => ({
    action,
    state: lifecycleState,
    reasonCode,
    taskIds: tasks,
    idleSince: state.idleSince,
    attempt,
  });

  if (observed === "starting") {
    const started =
      state.pendingOperation?.kind === "start"
        ? state.pendingOperation.requestedAt
        : null;
    if (
      started &&
      elapsedMinutes(started, now) >= policy.startupTimeoutMinutes
    ) {
      return state.startAttempts >= policy.maxStartAttempts
        ? out(
            "blocked",
            "failed",
            "startup_timeout_attempts_exhausted",
            state.startAttempts
          )
        : out(
            "wait_ready",
            "failed",
            "startup_timeout_retry_pending",
            state.startAttempts
          );
    }
    return out(
      "wait_ready",
      "starting",
      "codespace_starting",
      state.startAttempts
    );
  }
  if (observed === "stopping")
    return out(
      "wait_ready",
      "stopping",
      "codespace_stopping",
      state.stopAttempts
    );

  if (observed === "available") {
    if (useful)
      return out(
        work.workerRunningTaskIds.length > 0 || work.orchestrationActive
          ? "keep_alive"
          : "no_op",
        work.workerRunningTaskIds.length > 0 || work.orchestrationActive
          ? "busy"
          : "available",
        "useful_work_present"
      );
    if (!policy.autoStop)
      return out("keep_alive", "idle", "auto_stop_disabled");
    if (state.idleSince === null)
      return out("keep_alive", "idle", "idle_grace_started");
    if (elapsedMinutes(state.idleSince, now) < policy.idleGraceMinutes)
      return out("keep_alive", "idle", "idle_grace_active");
    if (state.stopAttempts >= policy.maxStopAttempts)
      return out(
        "blocked",
        "failed",
        "stop_attempts_exhausted",
        state.stopAttempts
      );
    return out(
      "stop",
      "stopping",
      "idle_grace_elapsed",
      state.stopAttempts + 1
    );
  }

  if (
    observed === "stopped" ||
    observed === "failed" ||
    observed === "unknown"
  ) {
    if (!useful)
      return out(
        "no_op",
        observed === "failed"
          ? "failed"
          : observed === "unknown"
            ? "unknown"
            : "stopped",
        "no_useful_work"
      );
    if (!policy.autoStart)
      return out(
        "blocked",
        "stopped",
        "auto_start_disabled",
        state.startAttempts
      );
    if (state.startAttempts >= policy.maxStartAttempts)
      return out(
        "blocked",
        "failed",
        "start_attempts_exhausted",
        state.startAttempts
      );
    return out(
      "start",
      "starting",
      observed === "failed" ? "retry_start" : "runnable_work_waiting",
      state.startAttempts + 1
    );
  }
  return out("blocked", "failed", "unrecognized_lifecycle_state");
}
/**
 * Portable, string-level check for a workspace / repository root. It does not
 * assume any host layout (Codespaces /workspaces, GitHub Actions
 * /home/runner/work, a temporary directory): the root must be absolute,
 * already normalized (no empty, "." or ".." segments, no trailing slash) and
 * never the filesystem root. Existence and symlink resolution are checked by
 * the runtime that actually touches the filesystem.
 */
export function isSafeWorkspaceRoot(path: string): boolean {
  if (typeof path !== "string" || path.length < 2 || path.length > 4096) return false;
  if (!path.startsWith("/") || path.endsWith("/") || /[\0\r\n]/.test(path)) return false;
  return path
    .slice(1)
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
