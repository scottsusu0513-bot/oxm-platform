import { isRuntimeBaseline, type RuntimeBaseline } from "../branches/taskBase";
import type { AuditRepository } from "../store/repositories";

/**
 * Durable runtime baseline identity, kept in the same append-only audit log as
 * the Manager checkpoint. A restart on a task branch (crash or Codespace stop
 * mid-task) reads it back instead of mistaking the task branch for the runtime.
 */

export const RUNTIME_BASELINE_AUDIT_TASK = "runtime-baseline" as const;
export const RUNTIME_BASELINE_EVENT = "runtime_baseline_recorded" as const;

export function loadRecordedBaseline(audit: AuditRepository): RuntimeBaseline | null {
  const events = audit.list({ taskId: RUNTIME_BASELINE_AUDIT_TASK }).filter((e) => e.event === RUNTIME_BASELINE_EVENT);
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i].metadata as { branch?: unknown; sha?: unknown };
    const candidate = { branch: m?.branch, sha: m?.sha };
    if (isRuntimeBaseline(candidate)) return { branch: candidate.branch, sha: candidate.sha };
  }
  return null;
}

export function recordBaseline(audit: AuditRepository, id: string, baseline: RuntimeBaseline): void {
  audit.append({
    id,
    taskId: RUNTIME_BASELINE_AUDIT_TASK,
    actor: "system",
    event: RUNTIME_BASELINE_EVENT,
    metadata: { branch: baseline.branch, sha: baseline.sha },
  });
}
