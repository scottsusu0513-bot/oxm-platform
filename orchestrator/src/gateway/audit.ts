import type { AuditRepository } from "../store/repositories";
import type { GatewayAuditSink } from "./types";

/** Adapter into the existing sanitized append-only audit repository. */
export function createGatewayAuditSink(input: {
  audit: AuditRepository;
  nextId: () => string;
}): GatewayAuditSink {
  return {
    record(event) {
      input.audit.append({
        id: input.nextId(),
        taskId: event.taskId ?? event.requestId,
        actor: event.principalId ? "human" : "system",
        event: event.event,
        metadata: {
          principalId: event.principalId,
          requestId: event.requestId,
          action: event.action,
          outcome: event.outcome,
          reasonCode: event.reasonCode,
          approvalKind: event.approvalKind,
          approvalPhase: event.approvalPhase,
          bindingReference: event.bindingReference,
        },
      });
    },
  };
}
