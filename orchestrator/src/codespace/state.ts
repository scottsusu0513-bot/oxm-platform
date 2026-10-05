import { sanitizeMetadata } from "../store/sanitize";
import type { AuditRepository } from "../store/repositories";
import type {
  LifecycleStateRepository,
  PersistedLifecycleState,
} from "./types";

export function initialLifecycleState(
  codespaceName: string
): PersistedLifecycleState {
  return {
    version: 1,
    codespaceName,
    state: "unknown",
    lastTrustedStatus: "unknown",
    pendingOperation: null,
    startAttempts: 0,
    stopAttempts: 0,
    idleSince: null,
    lastActivityAt: null,
    lastDecision: null,
    lastReasonCode: null,
    operationIdempotencyKey: null,
  };
}

function copy(value: PersistedLifecycleState): PersistedLifecycleState {
  return structuredClone(
    sanitizeMetadata({ value }).value
  ) as unknown as PersistedLifecycleState;
}

export function createMemoryLifecycleStateRepository(
  initial?: PersistedLifecycleState
): LifecycleStateRepository {
  let value = initial ? copy(initial) : null;
  return {
    load: name => (value?.codespaceName === name ? copy(value) : null),
    save: next => {
      value = copy(next);
    },
  };
}

export function createAuditLifecycleStateRepository(input: {
  audit: AuditRepository;
  nextId: () => string;
  streamTaskId?: string;
}): LifecycleStateRepository {
  const taskId = input.streamTaskId ?? "codespace-lifecycle";
  return {
    load(name) {
      const last = input.audit
        .list({ taskId })
        .filter(
          e =>
            e.event === "codespace_lifecycle_checkpoint" &&
            e.metadata.codespaceName === name
        )
        .at(-1);
      return last?.metadata.state
        ? (structuredClone(
            last.metadata.state
          ) as unknown as PersistedLifecycleState)
        : null;
    },
    save(state) {
      input.audit.append({
        id: input.nextId(),
        taskId,
        actor: "system",
        event: "codespace_lifecycle_checkpoint",
        metadata: { codespaceName: state.codespaceName, state: copy(state) },
      });
    },
  };
}
