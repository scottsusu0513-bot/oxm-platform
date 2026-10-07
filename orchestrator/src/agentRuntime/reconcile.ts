import { isTerminalState } from "../domain/taskState";
import type { TaskState } from "../domain/types";
import type { OrchestrationStatus } from "../scheduler/types";

/**
 * Startup consistency check between the two durable records the runtime
 * keeps: the journaled intake/runtime repositories and the Manager
 * checkpoint. They are saved separately, so a crash between the two saves can
 * leave them disagreeing. Disagreement always fails closed; only the two
 * cases with a conservative, deterministic fix (stop work that never ran /
 * honour a cancellation) are marked recoverable.
 */
export type ReconcileIssue =
  | { kind: "checkpoint_task_without_runtime_record"; taskId: string; recoverable: false }
  | { kind: "runtime_task_not_in_checkpoint"; taskId: string; recoverable: true; action: "cancel_runtime_record" }
  | { kind: "runtime_cancelled_but_manager_active"; taskId: string; recoverable: true; action: "cancel_in_manager" };

export interface ReconcileInput {
  checkpointTasks: readonly { taskId: string; status: OrchestrationStatus; state: TaskState }[];
  runtimeTasks: readonly { taskId: string; state: TaskState | null; hasIntakeRecord: boolean }[];
}

export function reconcileRuntimeState(input: ReconcileInput): { ok: boolean; issues: ReconcileIssue[] } {
  const issues: ReconcileIssue[] = [];
  const runtime = new Map(input.runtimeTasks.map((t) => [t.taskId, t]));
  const checkpoint = new Map(input.checkpointTasks.map((t) => [t.taskId, t]));
  for (const t of input.checkpointTasks) {
    const r = runtime.get(t.taskId);
    if (!r || r.state === null || !r.hasIntakeRecord) {
      issues.push({ kind: "checkpoint_task_without_runtime_record", taskId: t.taskId, recoverable: false });
      continue;
    }
    const managerActive = t.status !== "accepted" && t.status !== "blocked";
    if (r.state === "cancelled" && managerActive) issues.push({ kind: "runtime_cancelled_but_manager_active", taskId: t.taskId, recoverable: true, action: "cancel_in_manager" });
  }
  for (const r of input.runtimeTasks) {
    if (checkpoint.has(r.taskId)) continue;
    if (r.state !== null && isTerminalState(r.state)) continue;
    issues.push({ kind: "runtime_task_not_in_checkpoint", taskId: r.taskId, recoverable: true, action: "cancel_runtime_record" });
  }
  issues.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));
  return { ok: issues.length === 0, issues };
}

export function describeIssues(issues: readonly ReconcileIssue[]): string[] {
  return issues.map((i) =>
    i.kind === "checkpoint_task_without_runtime_record"
      ? `${i.taskId}: Manager checkpoint has the task but the runtime/intake record is missing (manual review required)`
      : i.kind === "runtime_task_not_in_checkpoint"
        ? `${i.taskId}: intake accepted the task but the Manager checkpoint never recorded it (recoverable with --reconcile: cancel the never-started runtime record)`
        : `${i.taskId}: task was cancelled but the Manager checkpoint is still active (recoverable with --reconcile: cancel it in the Manager)`,
  );
}
