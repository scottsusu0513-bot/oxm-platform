import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, writeSync } from "node:fs";
import { createFileAuditRepository } from "./fileAudit";
import type { AuditEvent } from "../store/types";

/** Events of which only the latest per key carries state; earlier ones are superseded. */
const SUPERSEDED: Readonly<Record<string, (e: AuditEvent) => string>> = {
  orchestration_checkpoint: (e) => e.taskId,
  human_transport_cursor: (e) => `${e.taskId}:${String((e.metadata as { transport?: unknown }).transport)}`,
};

export interface CompactionResult {
  compacted: boolean;
  eventsBefore: number;
  eventsAfter: number;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Offline compaction of the durable audit log (run before the runtime opens
 * it). Only superseded events are dropped: every checkpoint except the latest
 * per stream and every transport cursor except the latest. Journal records,
 * notice/ledger records and the Manager audit trail are kept verbatim, so the
 * latest pending task / escalation / approval state is never deleted.
 *
 * Crash-safe: the compacted log is written to a temp file and fsync'd, the
 * original is kept as `<path>.prev`, and the result is re-loaded and compared
 * before it replaces anything; any mismatch restores the original.
 */
export function compactAuditLog(path: string): CompactionResult {
  if (!existsSync(path)) return { compacted: false, eventsBefore: 0, eventsAfter: 0, bytesBefore: 0, bytesAfter: 0 };
  const original = createFileAuditRepository({ path, now: () => new Date().toISOString() });
  const events = original.list();
  original.close();
  const bytesBefore = statSync(path).size;
  const latest = new Map<string, string>();
  for (const e of events) {
    const key = SUPERSEDED[e.event]?.(e);
    if (key !== undefined) latest.set(`${e.event}|${key}`, e.id);
  }
  const kept = events.filter((e) => {
    const key = SUPERSEDED[e.event]?.(e);
    return key === undefined || latest.get(`${e.event}|${key}`) === e.id;
  });
  if (kept.length === events.length) return { compacted: false, eventsBefore: events.length, eventsAfter: events.length, bytesBefore, bytesAfter: bytesBefore };

  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
  const keepIds = new Set(kept.map((e) => e.id));
  const tmp = `${path}.compact.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    for (const line of lines) if (keepIds.has((JSON.parse(line) as { id: string }).id)) writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Verify before swapping: identical surviving events, identical latest state.
  const check = createFileAuditRepository({ path: tmp, now: () => new Date().toISOString() });
  const reloaded = check.list();
  check.close();
  if (JSON.stringify(reloaded) !== JSON.stringify(kept)) throw new Error("[persistence] compaction verification failed; original log left untouched");
  renameSync(path, `${path}.prev`);
  renameSync(tmp, path);
  return { compacted: true, eventsBefore: events.length, eventsAfter: kept.length, bytesBefore, bytesAfter: statSync(path).size };
}
