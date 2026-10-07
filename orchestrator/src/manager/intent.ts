import type { RiskLevel, TaskState } from "../domain/types";
import { sanitizeMetadata } from "../store/sanitize";
import type { JsonValue, NewAuditEvent } from "../store/types";

/**
 * Sanitized Manager audit intents. Nothing is written here: the caller
 * appends events via AuditRepository.append(). Metadata is a fixed whitelist
 * of ids, SHAs, enums and counters — never source code, raw logs, prompts,
 * or secrets — and is passed through store/sanitize.
 */

export const MANAGER_AUDIT_EVENTS = [
  "manager_validation_started",
  "manager_accepted",
  "manager_repair_requested",
  "manager_blocked",
  "manager_human_approval_required",
  "repair_attempt_started",
  "manager_diagnosis_issued",
  "manager_human_decision_required",
  "manager_human_decision_consumed",
  "escalation_triggered",
] as const;
export type ManagerAuditEvent = (typeof MANAGER_AUDIT_EVENTS)[number];

export interface ManagerAuditMetadataInput {
  taskId: string;
  branch: string | null;
  headSha: string | null;
  decision: string | null;
  failedEvidenceIds?: readonly string[];
  attempt: number;
  riskLevel: RiskLevel;
  reasonCodes?: readonly string[];
  triggers?: readonly string[];
  intents?: readonly string[];
}

const cap = (values: readonly string[] | undefined) => (values ?? []).slice(0, 50).map((v) => String(v).slice(0, 80));

/** Whitelisted, sanitized metadata. Unknown fields are dropped. */
export function managerAuditMetadata(m: ManagerAuditMetadataInput): { [key: string]: JsonValue } {
  return sanitizeMetadata({
    taskId: m.taskId,
    branch: m.branch,
    headSha: m.headSha,
    decision: m.decision,
    failedEvidenceIds: cap(m.failedEvidenceIds),
    attempt: m.attempt,
    riskLevel: m.riskLevel,
    reasonCodes: cap(m.reasonCodes),
    triggers: cap(m.triggers),
    intents: cap(m.intents),
  });
}

export function managerAudit(
  event: ManagerAuditEvent,
  fromState: TaskState,
  toState: TaskState | null,
  meta: ManagerAuditMetadataInput,
): Omit<NewAuditEvent, "id"> {
  return { taskId: meta.taskId, actor: "manager", event, fromState, toState, metadata: managerAuditMetadata(meta) };
}
