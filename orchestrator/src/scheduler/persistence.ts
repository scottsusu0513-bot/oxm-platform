import type { AuditRepository } from "../store/repositories";
import { sanitizeMetadata } from "../store/sanitize";
import type { OrchestrationCheckpoint, OrchestrationPersistencePort } from "./types";

export const ORCHESTRATION_CHECKPOINT_EVENT = "orchestration_checkpoint";

export function serializeCheckpoint(checkpoint: OrchestrationCheckpoint): OrchestrationCheckpoint {
  const sanitized = sanitizeMetadata({ checkpoint }).checkpoint;
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new Error("[scheduler] checkpoint sanitizer rejected state");
  }
  return structuredClone(sanitized) as unknown as OrchestrationCheckpoint;
}

export function deserializeCheckpoint(value: unknown): OrchestrationCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("[scheduler] malformed checkpoint");
  const c = value as Partial<OrchestrationCheckpoint>;
  if (c.version !== 1 || !Number.isInteger(c.sequence) || !Array.isArray(c.tasks)) {
    throw new Error("[scheduler] unsupported checkpoint");
  }
  return structuredClone(c) as OrchestrationCheckpoint;
}

/** Stores versioned checkpoints inside the existing append-only audit schema. */
export function createAuditCheckpointRepository(input: {
  audit: AuditRepository;
  nextId: () => string;
  streamTaskId?: string;
}): OrchestrationPersistencePort {
  const taskId = input.streamTaskId ?? "scheduler";
  return {
    save(checkpoint) {
      const state = serializeCheckpoint(checkpoint);
      input.audit.append({
        id: input.nextId(),
        taskId,
        actor: "system",
        event: ORCHESTRATION_CHECKPOINT_EVENT,
        metadata: { checkpoint: state },
      });
    },
    load() {
      const events = input.audit.list({ taskId }).filter((e) => e.event === ORCHESTRATION_CHECKPOINT_EVENT);
      const last = events.at(-1);
      return last ? deserializeCheckpoint(last.metadata.checkpoint) : null;
    },
  };
}

/** In-memory checkpoint adapter for focused loop tests; values always cross by copy. */
export function createMemoryCheckpointRepository(initial: OrchestrationCheckpoint | null = null): OrchestrationPersistencePort {
  let value = initial ? serializeCheckpoint(initial) : null;
  return {
    load: () => (value ? structuredClone(value) : null),
    save(checkpoint) {
      value = serializeCheckpoint(checkpoint);
    },
  };
}
