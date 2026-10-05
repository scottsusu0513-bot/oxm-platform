import { sanitizeMetadata } from "../store/sanitize";
import type { NewAuditEvent } from "../store/types";
import type {
  CodespaceIdentity,
  LifecycleDecision,
  PersistedLifecycleState,
} from "./types";

export const LIFECYCLE_AUDIT_EVENTS = [
  "codespace_start_requested",
  "codespace_start_succeeded",
  "codespace_start_failed",
  "codespace_ready",
  "codespace_keep_alive",
  "codespace_idle",
  "codespace_stop_requested",
  "codespace_stop_succeeded",
  "codespace_stop_failed",
  "codespace_unexpected_stop",
  "lifecycle_retry_scheduled",
  "lifecycle_blocked",
] as const;
export type LifecycleAuditEvent = (typeof LIFECYCLE_AUDIT_EVENTS)[number];

export function lifecycleAudit(
  event: LifecycleAuditEvent,
  identity: CodespaceIdentity,
  state: PersistedLifecycleState,
  decision: LifecycleDecision
): Omit<NewAuditEvent, "id"> {
  return {
    taskId: decision.taskIds[0] ?? "codespace-lifecycle",
    actor: "system",
    event,
    metadata: sanitizeMetadata({
      codespaceIdentifier: identity.codespaceName,
      taskIds: decision.taskIds,
      lifecycleState: state.state,
      attempt: decision.attempt,
      idleSince: state.idleSince,
      decision: decision.action,
      reasonCode: decision.reasonCode,
    }),
  };
}
