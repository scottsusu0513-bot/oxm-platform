import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { AuditRepository } from "../store/repositories";
import { sanitizeMetadata } from "../store/sanitize";
import { AUDIT_ACTORS, type AuditEvent, type IsoTimestamp, type NewAuditEvent } from "../store/types";

/**
 * Durable, append-only AuditRepository backed by a local JSONL file.
 *
 * Same contract as the in-memory repository (append + list, no update or
 * delete, metadata always sanitized), so existing audit-backed adapters such
 * as createAuditCheckpointRepository work unchanged. Every append is written
 * and fsync'd before it is returned. The file is created owner-only (0600).
 *
 * Loading fails closed: any malformed or duplicate line refuses to open the
 * log instead of silently dropping state (e.g. an open escalation).
 */
export interface FileAuditRepository extends AuditRepository {
  readonly path: string;
  close(): void;
}

export function createFileAuditRepository(input: { path: string; now: () => IsoTimestamp }): FileAuditRepository {
  if (!isAbsolute(input.path)) throw new Error("[store] audit log path must be absolute");
  mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
  const events: AuditEvent[] = [];
  const ids = new Set<string>();
  if (existsSync(input.path)) {
    const lines = readFileSync(input.path, "utf8").split("\n");
    if (lines.at(-1) === "") lines.pop();
    lines.forEach((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`[store] audit log line ${index + 1} is malformed; refusing to load`);
      }
      const e = parsed as Partial<AuditEvent>;
      if (
        !e || typeof e !== "object" || typeof e.id !== "string" || !e.id || typeof e.taskId !== "string" || !e.taskId ||
        typeof e.event !== "string" || !e.event || !AUDIT_ACTORS.includes(e.actor as never) ||
        !e.metadata || typeof e.metadata !== "object" || Array.isArray(e.metadata) || typeof e.createdAt !== "string" || ids.has(e.id)
      )
        throw new Error(`[store] audit log line ${index + 1} is invalid; refusing to load`);
      ids.add(e.id);
      events.push(e as AuditEvent);
    });
  }
  const fd = openSync(input.path, "a", 0o600);
  const clone = (e: AuditEvent) => structuredClone(e);
  let closed = false;
  return Object.freeze({
    path: input.path,
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
    },
    append(event: NewAuditEvent): AuditEvent {
      for (const key of ["id", "taskId", "event"] as const)
        if (typeof event[key] !== "string" || event[key] === "") throw new Error(`[store] audit.${key} is required`);
      if (!AUDIT_ACTORS.includes(event.actor)) throw new Error(`[store] invalid audit actor ${String(event.actor)}`);
      if (closed) throw new Error("[store] audit log is closed");
      if (ids.has(event.id)) throw new Error(`[store] audit event ${event.id} already exists`);
      const stored: AuditEvent = {
        id: event.id,
        taskId: event.taskId,
        actor: event.actor,
        event: event.event,
        fromState: event.fromState ?? null,
        toState: event.toState ?? null,
        metadata: sanitizeMetadata(event.metadata),
        createdAt: input.now(),
      };
      writeSync(fd, `${JSON.stringify(stored)}\n`);
      fsyncSync(fd);
      ids.add(stored.id);
      events.push(stored);
      return clone(stored);
    },
    list(filter: { taskId?: string } = {}): AuditEvent[] {
      return events.filter((e) => filter.taskId === undefined || e.taskId === filter.taskId).map(clone);
    },
  });
}
