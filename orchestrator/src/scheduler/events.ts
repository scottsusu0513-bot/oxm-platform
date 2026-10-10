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
  "worker_selected",
  "worker_fallback_selected",
  "worker_unavailable",
  "worker_started",
  "worker_completed",
  "codex_worker_started",
  "codex_worker_completed",
  "codex_worker_failed",
  "repair_requested",
  "repair_completed",
  "infrastructure_retry_requested",
  "goal_review_unavailable",
  "human_decision_requested",
  "human_decision_accepted",
  "human_decision_rejected",
  "branch_push_requested",
  "pr_create_requested",
  "qa_wait",
  "manager_accepted",
  "manager_blocked",
  "human_approval_requested",
  "worker_quota_exhausted",
  "worker_availability_wait",
  "worker_availability_resumed",
  "worker_handoff",
  "worker_handback",
  "human_guidance_constraint_recorded",
  "manager_diagnosis_accepted",
  "manager_diagnosis_refused",
  "combined_review_accepted",
  "combined_review_rejected",
  "owner_constraint_unmet",
  // Fallback audit of a failed evidence record: typed code + classified Git metadata (never only an Error name).
  "evidence_record_failed",
  // Implementation accepted; publication waits for re-established trusted Git evidence.
  "publication_evidence_refresh_required",
  // Trusted Git metadata re-binding before a follow-up run: accepted (baseline moved) / refused.
  "git_metadata_rebound",
  "git_metadata_rebind_refused",
] as const;
export type OrchestrationAuditEvent = (typeof ORCHESTRATION_AUDIT_EVENTS)[number];

export interface OrchestrationAuditMetadata {
  taskId: string;
  priority?: string;
  worker?: string | null;
  fallbackFrom?: string | null;
  reasonCode?: string | null;
  risk?: string | null;
  branch?: string | null;
  headSha?: string | null;
  attempt?: number;
  dependencyIds?: readonly string[];
  queueReason?: string | null;
  outcome?: string;
  activatedCapabilities?: readonly string[];
  /** Typed evidence-recorder error code (evidence_record_failed). */
  evidenceError?: string | null;
  /** Primary Worker error when a secondary evidence failure happened. */
  primaryError?: string | null;
  /** Classified Git metadata delta: component ids, classes, entry labels and config key NAMES only. */
  gitMetadata?: AuditGitMetadata | null;
}

export interface AuditGitMetadata {
  window: string;
  publicationTrust: string;
  workerViolation: boolean;
  summary: string;
  changes: { component: string; classification: string; change: string; entries: string[]; keys: string[]; reason: string }[];
}

const cap = (values: readonly string[] | undefined) => (values ?? []).slice(0, 50).map((v) => String(v).slice(0, 80));
const short = (v: string | null | undefined) => (v == null ? null : String(v).replace(/\s+/g, " ").slice(0, 200));

export function orchestrationAuditMetadata(m: OrchestrationAuditMetadata): {
  [key: string]: JsonValue;
} {
  return sanitizeMetadata({
    layer: "orchestration",
    taskId: m.taskId,
    priority: m.priority ?? null,
    worker: m.worker ?? null,
    fallbackFrom: m.fallbackFrom ?? null,
    reasonCode: m.reasonCode ?? null,
    risk: m.risk ?? null,
    branch: m.branch ?? null,
    headSha: m.headSha ?? null,
    attempt: m.attempt ?? 0,
    dependencyIds: cap(m.dependencyIds),
    queueReason: short(m.queueReason),
    outcome: m.outcome ?? null,
    activatedCapabilities: cap(m.activatedCapabilities),
    ...(m.evidenceError !== undefined ? { evidenceError: short(m.evidenceError) } : {}),
    ...(m.primaryError !== undefined ? { primaryError: short(m.primaryError) } : {}),
    ...(m.gitMetadata
      ? {
          gitMetadata: {
            window: short(m.gitMetadata.window),
            publicationTrust: short(m.gitMetadata.publicationTrust),
            workerViolation: m.gitMetadata.workerViolation === true,
            summary: short(m.gitMetadata.summary),
            changes: m.gitMetadata.changes.slice(0, 25).map((c) => ({
              component: short(c.component),
              classification: short(c.classification),
              change: short(c.change),
              entries: cap(c.entries).slice(0, 10),
              keys: cap(c.keys).slice(0, 10),
              reason: short(c.reason),
            })),
          },
        }
      : {}),
  });
}

const ACTOR: Partial<Record<OrchestrationAuditEvent, AuditActor>> = {
  manager_accepted: "manager",
  manager_blocked: "manager",
  repair_requested: "manager",
  human_approval_requested: "manager",
  human_decision_requested: "manager",
  human_decision_accepted: "manager",
  human_decision_rejected: "manager",
};

export function orchestrationAudit(event: OrchestrationAuditEvent, fromState: TaskState | null, toState: TaskState | null, meta: OrchestrationAuditMetadata): Omit<NewAuditEvent, "id"> {
  return {
    taskId: meta.taskId,
    actor: ACTOR[event] ?? "system",
    event,
    fromState,
    toState,
    metadata: orchestrationAuditMetadata(meta),
  };
}

/** Events that only (re)run the scheduler. */
export const SCHEDULING_EVENTS: readonly OrchestrationEventType[] = ["scheduler_tick", "dependency_completed", "workspace_available"];

export function isSchedulingEvent(e: OrchestrationEvent): boolean {
  return SCHEDULING_EVENTS.includes(e.type);
}
