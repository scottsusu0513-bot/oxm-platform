import type { AuditRepository } from "../store/repositories";
import type { RiskLevel, TaskCategory, WorkerKind } from "../domain/types";
import type { PriorityClass } from "../scheduler/types";

export type IntakeAuditEvent =
  | "intake_received"
  | "intake_rejected"
  | "clarification_required"
  | "task_created"
  | "duplicate_request"
  | "idempotency_conflict"
  | "task_enqueued"
  | "task_paused"
  | "task_cancel_requested"
  | "task_status_read"
  | "risk_signals_detected";

export function createIntakeAuditor(input: {
  audit: AuditRepository;
  nextId: () => string;
}) {
  return (
    event: IntakeAuditEvent,
    data: {
      taskId: string;
      requestId?: string;
      category?: TaskCategory;
      risk?: RiskLevel;
      priority?: PriorityClass;
      worker?: WorkerKind | null;
      reasonCodes?: readonly string[];
      sourceType?: string;
      classificationPath?: string;
      llmClassifierCalls?: number;
      activatedIntakeCapabilities?: readonly string[];
      cancellationRequested?: boolean;
    }
  ) =>
    input.audit.append({
      id: input.nextId(),
      taskId: data.taskId,
      actor: "manager",
      event,
      metadata: data,
    });
}
