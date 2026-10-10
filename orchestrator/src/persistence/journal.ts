import type { AuditRepository } from "../store/repositories";
import type { IsoTimestamp } from "../store/types";

export const REPOSITORY_JOURNAL_EVENT = "repository_journal_op";

/**
 * Backward-compatible replay of a historical duplicate create, declared per
 * repository (never a journal-wide default). Two runtimes that once wrote the
 * same durable journal each recorded the same create; on replay the second
 * one is skipped only when it is logically equal to the persisted row
 * (`ignoredFields` excluded, e.g. a runtime-local timestamp). A different
 * payload under the same key is a real conflict and still fails closed,
 * unless the operator explicitly superseded that exact journal event.
 */
export interface ReplayDuplicatePolicy<T> {
  method: string;
  /** The key the call would create, or null when the call is malformed. */
  keyOf(args: readonly unknown[]): string | null;
  /** The currently persisted row for `key`, or null. */
  existing(repo: T, key: string): unknown;
  /** Record fields that are runtime-local metadata rather than logical payload. */
  ignoredFields: readonly string[];
}

export type JournalReplayFailure =
  | "malformed_record"
  | "unknown_repository"
  | "unknown_method"
  | "duplicate_conflict"
  | "repository_rejected"
  | "invalid_override";

export interface JournalReplayDetail {
  category: JournalReplayFailure;
  /** Position in the journal stream (0-based), or null for a stream-level failure. */
  index: number | null;
  eventId: string | null;
  repository: string | null;
  method: string | null;
  key: string | null;
}

/** A replay failure carrying only safe identifiers: never record payloads or repository error text. */
export class JournalReplayError extends Error {
  constructor(readonly detail: JournalReplayDetail) {
    super(`[journal] replay refused: ${describeJournalReplayDetail(detail)}`);
    this.name = "JournalReplayError";
  }
}

export function describeJournalReplayDetail(d: JournalReplayDetail): string {
  const parts = [`category=${d.category}`];
  if (d.index !== null) parts.push(`index=${d.index}`);
  if (d.eventId !== null) parts.push(`event=${d.eventId}`);
  if (d.repository !== null) parts.push(`repository=${d.repository}`);
  if (d.method !== null) parts.push(`method=${d.method}`);
  if (d.key !== null) parts.push(`key=${d.key}`);
  return parts.join(" ");
}

export interface JournalReplaySkip {
  eventId: string;
  index: number;
  repository: string;
  method: string;
  key: string;
  reason: "identical_historical_duplicate" | "operator_superseded";
}

export interface RepositoryJournal {
  /** Clock to hand to the wrapped in-memory repositories; pinned during calls and replay. */
  clock(): IsoTimestamp;
  /** Records every successful call of `methods` on `repo` to the audit stream. */
  wrap<T extends object>(name: string, repo: T, methods: readonly (keyof T & string)[], options?: { replayDuplicate?: ReplayDuplicatePolicy<T> }): T;
  /** Re-applies every recorded call, in order, at its recorded time. Call once, before any new mutation. */
  replay(): number;
  /** Journal records the last replay skipped (historical duplicates), in journal order. */
  replaySkips(): JournalReplaySkip[];
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
/** Identifiers in diagnostics come from the journal; anything not shaped like an id is withheld. */
const safeId = (value: unknown): string | null => (typeof value !== "string" ? null : SAFE_IDENTIFIER.test(value) ? value : "[withheld]");

/** Deterministic deep equality over JSON-shaped records (key order independent). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function logical(record: unknown, ignored: readonly string[]): string | null {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  const copy: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const field of ignored) delete copy[field];
  return canonical(copy);
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
 * call the repository now rejects aborts startup instead of diverging. The
 * only exceptions are a repository's declared ReplayDuplicatePolicy and the
 * operator's explicit `superseded` journal event ids (validated against it).
 */
export function createRepositoryJournal(input: {
  audit: AuditRepository;
  nextId: () => string;
  now: () => IsoTimestamp;
  streamTaskId?: string;
  /** Operator-acknowledged journal event ids to skip on replay; each must be a conflicting duplicate under a declared policy. */
  superseded?: readonly string[];
}): RepositoryJournal {
  const stream = input.streamTaskId ?? "repository-journal";
  const registry = new Map<string, { repo: Record<string, unknown>; methods: ReadonlySet<string>; policy: ReplayDuplicatePolicy<never> | null }>();
  let pinned: IsoTimestamp | null = null;
  let replaying = false;
  let replayed = false;
  const skips: JournalReplaySkip[] = [];

  function invoke(repo: Record<string, unknown>, method: string, args: unknown[]): unknown {
    const fn = repo[method];
    if (typeof fn !== "function") throw new Error(`[journal] ${method} is not callable`);
    return (fn as (...a: unknown[]) => unknown).apply(repo, args);
  }

  return {
    clock: () => pinned ?? input.now(),
    wrap<T extends object>(name: string, repo: T, methods: readonly (keyof T & string)[], options?: { replayDuplicate?: ReplayDuplicatePolicy<T> }): T {
      if (registry.has(name)) throw new Error(`[journal] repository ${name} is already registered`);
      const policy = options?.replayDuplicate ?? null;
      if (policy && !(methods as readonly string[]).includes(policy.method)) throw new Error(`[journal] duplicate policy method ${policy.method} is not journaled`);
      const target = repo as unknown as Record<string, unknown>;
      registry.set(name, { repo: target, methods: new Set(methods), policy: policy as ReplayDuplicatePolicy<never> | null });
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
      const fault = (category: JournalReplayFailure, index: number | null, fields: Partial<Omit<JournalReplayDetail, "category" | "index">> = {}) =>
        new JournalReplayError({ category, index, eventId: null, repository: null, method: null, key: null, ...fields });

      // Validate every record before mutating anything.
      const parsed = ops.map((op, index) => {
        const { repository, method, at, args } = op.metadata as Record<string, unknown>;
        const ids = { eventId: safeId(op.id), repository: safeId(repository), method: safeId(method) };
        if (typeof repository !== "string" || typeof method !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at)) || !Array.isArray(args))
          throw fault("malformed_record", index, ids);
        const entry = registry.get(repository);
        if (!entry) throw fault("unknown_repository", index, ids);
        if (!entry.methods.has(method)) throw fault("unknown_method", index, ids);
        const policy = entry.policy && entry.policy.method === method ? entry.policy : null;
        const key = policy ? policy.keyOf(args) : null;
        if (policy && key === null) throw fault("malformed_record", index, ids);
        return { id: op.id, index, repository, method, at, args, entry, policy, key, ids };
      });

      // Operator overrides: only a policy-covered create whose key has another surviving record.
      const superseded = new Set(input.superseded ?? []);
      for (const eventId of Array.from(superseded)) {
        const op = parsed.find((p) => p.id === eventId);
        if (!op || !op.policy || op.key === null) throw fault("invalid_override", op?.index ?? null, { eventId: safeId(eventId), ...(op ? { repository: op.ids.repository, method: op.ids.method } : {}) });
        const survivor = parsed.some((p) => p !== op && !superseded.has(p.id) && p.repository === op.repository && p.method === op.method && p.key === op.key);
        if (!survivor) throw fault("invalid_override", op.index, { ...op.ids, key: safeId(op.key) });
      }

      replaying = true;
      try {
        for (const op of parsed) {
          const skip = (reason: JournalReplaySkip["reason"]) =>
            skips.push({ eventId: op.id, index: op.index, repository: op.repository, method: op.method, key: op.key!, reason });
          if (superseded.has(op.id)) {
            skip("operator_superseded");
            continue;
          }
          if (op.policy && op.key !== null) {
            const existing = op.policy.existing(op.entry.repo as never, op.key);
            if (existing !== null && existing !== undefined) {
              const before = logical(existing, op.policy.ignoredFields);
              if (before === null || before !== logical(op.args[0], op.policy.ignoredFields)) throw fault("duplicate_conflict", op.index, { ...op.ids, key: safeId(op.key) });
              skip("identical_historical_duplicate");
              continue;
            }
          }
          pinned = op.at;
          try {
            invoke(op.entry.repo, op.method, structuredClone(op.args));
          } catch {
            throw fault("repository_rejected", op.index, { ...op.ids, key: op.key === null ? null : safeId(op.key) });
          }
          pinned = null;
        }
      } finally {
        pinned = null;
        replaying = false;
      }
      return ops.length;
    },
    replaySkips: () => skips.map((s) => ({ ...s })),
  };
}
