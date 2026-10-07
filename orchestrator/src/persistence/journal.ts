import type { AuditRepository } from "../store/repositories";
import type { IsoTimestamp } from "../store/types";

export const REPOSITORY_JOURNAL_EVENT = "repository_journal_op";

export interface RepositoryJournal {
  /** Clock to hand to the wrapped in-memory repositories; pinned during calls and replay. */
  clock(): IsoTimestamp;
  /** Records every successful call of `methods` on `repo` to the audit stream. */
  wrap<T extends object>(name: string, repo: T, methods: readonly (keyof T & string)[]): T;
  /** Re-applies every recorded call, in order, at its recorded time. Call once, before any new mutation. */
  replay(): number;
}

/**
 * Makes existing in-memory repositories durable through the append-only audit
 * repository instead of a second persistence mechanism: each successful
 * mutating call (repository, method, arguments, time) is appended as one
 * sanitized audit event, and a restart replays the same calls into fresh
 * in-memory repositories with the clock pinned to the recorded time, so the
 * repositories' own validation runs again on every replayed call.
 *
 * Replay fails closed: an unknown repository/method, malformed record, or a
 * call the repository now rejects aborts startup instead of diverging.
 */
export function createRepositoryJournal(input: {
  audit: AuditRepository;
  nextId: () => string;
  now: () => IsoTimestamp;
  streamTaskId?: string;
}): RepositoryJournal {
  const stream = input.streamTaskId ?? "repository-journal";
  const registry = new Map<string, { repo: Record<string, unknown>; methods: ReadonlySet<string> }>();
  let pinned: IsoTimestamp | null = null;
  let replaying = false;
  let replayed = false;

  function invoke(repo: Record<string, unknown>, method: string, args: unknown[]): unknown {
    const fn = repo[method];
    if (typeof fn !== "function") throw new Error(`[journal] ${method} is not callable`);
    return (fn as (...a: unknown[]) => unknown).apply(repo, args);
  }

  return {
    clock: () => pinned ?? input.now(),
    wrap<T extends object>(name: string, repo: T, methods: readonly (keyof T & string)[]): T {
      if (registry.has(name)) throw new Error(`[journal] repository ${name} is already registered`);
      const target = repo as unknown as Record<string, unknown>;
      registry.set(name, { repo: target, methods: new Set(methods) });
      const wrapped: Record<string, unknown> = { ...target };
      for (const method of methods) {
        wrapped[method] = (...args: unknown[]) => {
          if (pinned !== null) return invoke(target, method, args);
          const at = input.now();
          pinned = at;
          let result: unknown;
          try {
            result = invoke(target, method, args);
          } finally {
            pinned = null;
          }
          if (!replaying)
            input.audit.append({
              id: input.nextId(),
              taskId: stream,
              actor: "system",
              event: REPOSITORY_JOURNAL_EVENT,
              metadata: { repository: name, method, at, args: structuredClone(args) as never },
            });
          return result;
        };
      }
      return wrapped as T;
    },
    replay() {
      if (replayed) throw new Error("[journal] replay already ran");
      replayed = true;
      const ops = input.audit.list({ taskId: stream }).filter((e) => e.event === REPOSITORY_JOURNAL_EVENT);
      replaying = true;
      try {
        for (const op of ops) {
          const { repository, method, at, args } = op.metadata as Record<string, unknown>;
          const entry = typeof repository === "string" ? registry.get(repository) : undefined;
          if (!entry || typeof method !== "string" || !entry.methods.has(method) || typeof at !== "string" || Number.isNaN(Date.parse(at)) || !Array.isArray(args))
            throw new Error("[journal] malformed or unknown journal record; refusing to replay");
          pinned = at;
          invoke(entry.repo, method, structuredClone(args));
          pinned = null;
        }
      } finally {
        pinned = null;
        replaying = false;
      }
      return ops.length;
    },
  };
}
