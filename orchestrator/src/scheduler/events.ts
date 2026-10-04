import type { TaskState } from "../domain/types";
import { sanitizeMetadata } from "../store/sanitize";
import type { AuditActor, JsonValue, NewAuditEvent } from "../store/types";
import type { OrchestrationEvent, OrchestrationEventType } from "./types";

/**
 * Sanitized orchestration audit intents. Metadata is a fixed whitelist of
 * ids, SHAs, enums and counters, passed through store/sanitize — never
 * source code, raw prompts, raw logs, or secrets. Nothing is written here;
 * the loop hands each intent to the injected audit port.
 */

export const ORCHESTRATION_AUDIT_EVENTS = [
  "task_queued",
  "task_dispatched",
  "dependency_wait",
  "conflict_wait",
  "workspace_wait",
  "worker_started",
  "worker_completed",
  "repair_requested",
  "repair_completed",
  "branch_push_requested",
  "pr_create_requested",
  "qa_wait",
  "manager_accepted",
  "manager_blocked",
  "human_approval_requested",
] as const;
export type OrchestrationAuditEvent = (typeof ORCHESTRATION_AUDIT_EVENTS)[number];

export interface OrchestrationAuditMetadata {
  taskId: string;
  priority?: string;
  worker?: string | null;
  branch?: string | null;
  headSha?: string | null;
  attempt?: number;
  dependencyIds?: readonly string[];
  queueReason?: string | null;
  outcome?: string;
  activatedCapabilities?: readonly string[];
}

const cap = (values: readonly string[] | undefined) => (values ?? []).slice(0, 50).map((v) => String(v).slice(0, 80));
const short = (v: string | null | undefined) => (v == null ? null : String(v).replace(/\s+/g, " ").slice(0, 200));

export function orchestrationAuditMetadata(m: OrchestrationAuditMetadata): { [key: string]: JsonValue } {
  return sanitizeMetadata({
    layer: "orchestration",
    taskId: m.taskId,
    priority: m.priority ?? null,
    worker: m.worker ?? null,
    branch: m.branch ?? null,
    headSha: m.headSha ?? null,
    attempt: m.attempt ?? 0,
    dependencyIds: cap(m.dependencyIds),
    queueReason: short(m.queueReason),
    outcome: m.outcome ?? null,
    activatedCapabilities: cap(m.activatedCapabilities),
  });
}

const ACTOR: Partial<Record<OrchestrationAuditEvent, AuditActor>> = {
  manager_accepted: "manager",
  manager_blocked: "manager",
  repair_requested: "manager",
  human_approval_requested: "manager",
};

export function orchestrationAudit(
  event: OrchestrationAuditEvent,
  fromState: TaskState | null,
  toState: TaskState | null,
  meta: OrchestrationAuditMetadata,
): Omit<NewAuditEvent, "id"> {
  return { taskId: meta.taskId, actor: ACTOR[event] ?? "system", event, fromState, toState, metadata: orchestrationAuditMetadata(meta) };
}

/** Events that only (re)run the scheduler. */
export const SCHEDULING_EVENTS: readonly OrchestrationEventType[] = ["scheduler_tick", "dependency_completed", "workspace_available"];

export function isSchedulingEvent(e: OrchestrationEvent): boolean {
  return SCHEDULING_EVENTS.includes(e.type);
}
