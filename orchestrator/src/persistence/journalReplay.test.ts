import { describe, expect, it } from "vitest";
import { createInMemoryInterpretationRepository, INTERPRETATION_REPLAY_DUPLICATE_POLICY } from "../gateway/fake";
import type { PersistedInterpretation } from "../gateway/types";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createAgentRuntimeService } from "../intake/service";
import { createInMemoryApprovalRepository, createInMemoryAuditRepository, createInMemoryTaskRepository, createInMemoryTaskRunRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createRepositoryJournal, JournalReplayError, REPOSITORY_JOURNAL_EVENT, type JournalReplayDetail } from "./journal";

const SECRET_BODY = "請修正老闆私密訊息內容 PRIVATE-BODY-MARKER";

const interpretation = (id: string, over: Partial<PersistedInterpretation> = {}): PersistedInterpretation =>
  ({
    interpretationId: id,
    fingerprint: `fp-${id}`,
    principalId: "telegram-owner",
    originalRequest: SECRET_BODY,
    priority: null,
    decision: { kind: "status_query", taskId: null },
    createdAt: "2026-10-09T08:00:00.000Z",
    ...over,
  }) as PersistedInterpretation;

let seq = 0;
/** Appends one journal record directly, as a second (historical) runtime writing the same journal would have. */
function record(audit: AuditRepository, repository: string, method: string, args: unknown[], id = `hist-${++seq}`, at = "2026-10-09T08:00:00.000Z") {
  audit.append({ id, taskId: "repository-journal", actor: "system", event: REPOSITORY_JOURNAL_EVENT, metadata: { repository, method, at, args: structuredClone(args) as never } });
  return id;
}

/** A fresh runtime's journal over the given audit: what every restart builds. */
function boot(audit: AuditRepository, superseded?: string[]) {
  let n = 0;
  const now = () => "2026-10-10T00:00:00.000Z";
  const journal = createRepositoryJournal({ audit, nextId: () => `boot-${++n}`, now, superseded });
  const tasks = journal.wrap("tasks", createInMemoryTaskRepository(journal.clock), ["create", "update", "transition"]);
  const runs = journal.wrap("runs", createInMemoryTaskRunRepository(journal.clock), ["create", "update"]);
  const approvals = journal.wrap("approvals", createInMemoryApprovalRepository(journal.clock), ["create", "decide", "expire"]);
  const intakeRecords = journal.wrap("intakeRecords", createInMemoryIntakeRepository(), ["create", "update"]);
  const interpretations = journal.wrap("interpretations", createInMemoryInterpretationRepository(), ["create"], { replayDuplicate: INTERPRETATION_REPLAY_DUPLICATE_POLICY });
  return { journal, tasks, runs, approvals, intakeRecords, interpretations, replay: () => journal.replay() };
}

function replayError(fn: () => unknown): JournalReplayDetail {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(JournalReplayError);
    return (error as JournalReplayError).detail;
  }
  throw new Error("replay did not fail");
}

/** Submits one real task through intake so tasks.create / intakeRecords.create journal records exist. */
async function submitOneTask(audit: AuditRepository) {
  const b = boot(audit);
  b.replay();
  const runtime = createAgentRuntimeService({
    tasks: b.tasks,
    runs: b.runs,
    approvals: b.approvals,
    audit,
    intakeRecords: b.intakeRecords,
    scheduler: { enqueue() {}, snapshot: () => null, pause: () => ({ ok: false }), cancel: () => ({ ok: false, cancellationRequested: false }) },
    workerAvailability: () => ({ claude: "unavailable", codex: "available" }),
    nextTaskId: () => "t261009-aaaaaa",
    nextAuditId: () => `svc-${++seq}`,
    now: () => "2026-10-09T08:00:00.000Z",
  } as never);
  const r = await runtime.submitTask({
    idempotencyKey: "tg.goal.1",
    requestId: "tg.goal.1",
    userInstruction: "修正搜尋頁 loading 體驗",
    source: { type: "gateway", requesterId: "telegram-owner", reference: "telegram" },
    submittedAt: "2026-10-09T08:00:00.000Z",
  } as never);
  expect(r.outcome).toBe("accepted");
}

function duplicateFirst(audit: AuditRepository, repository: string, method: string) {
  const op = audit.list({ taskId: "repository-journal" }).find((e) => e.metadata.repository === repository && e.metadata.method === method);
  if (!op) throw new Error(`no ${repository}.${method} record`);
  record(audit, repository, method, op.metadata.args as unknown[], `dup-${repository}`, op.metadata.at as string);
}

describe("historical duplicate interpretation replay", () => {
  it("1. skips an identical duplicate create (createdAt differs only) and keeps one record", () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const first = record(audit, "interpretations", "create", [interpretation("tg.msg.79")]);
    const dup = record(audit, "interpretations", "create", [interpretation("tg.msg.79", { createdAt: "2026-10-09T08:00:02.318Z" })]);
    const b = boot(audit);
    expect(b.replay()).toBe(2);
    expect(b.interpretations.get("tg.msg.79")).toEqual(interpretation("tg.msg.79"));
    expect(b.journal.replaySkips()).toEqual([{ eventId: dup, index: 1, repository: "interpretations", method: "create", key: "tg.msg.79", reason: "identical_historical_duplicate" }]);
    expect(first).not.toBe(dup);
    // Recovery never writes back into the replayed journal stream.
    expect(audit.list({ taskId: "repository-journal" })).toHaveLength(2);
  });

  it("2. fails closed on the same interpretationId with a different payload", () => {
    const audit = createInMemoryAuditRepository(() => "t");
    record(audit, "interpretations", "create", [interpretation("tg.msg.94", { decision: { kind: "task", title: "A" } as never })]);
    const conflict = record(audit, "interpretations", "create", [interpretation("tg.msg.94", { decision: { kind: "task", title: "B" } as never })]);
    expect(replayError(() => boot(audit).replay())).toEqual({ category: "duplicate_conflict", index: 1, eventId: conflict, repository: "interpretations", method: "create", key: "tg.msg.94" });
  });

  it("2b. any differing logical field (fingerprint / principal / decision.taskId) is a conflict", () => {
    for (const over of [{ fingerprint: "other" }, { principalId: "someone" }, { decision: { kind: "cancel_or_pause", taskId: "t2" } as never }]) {
      const audit = createInMemoryAuditRepository(() => "t");
      record(audit, "interpretations", "create", [interpretation("tg.msg.96", { decision: { kind: "cancel_or_pause", taskId: "t1" } as never })]);
      record(audit, "interpretations", "create", [interpretation("tg.msg.96", { decision: { kind: "cancel_or_pause", taskId: "t1" } as never, ...over })]);
      expect(replayError(() => boot(audit).replay()).category).toBe("duplicate_conflict");
    }
  });

  it("3. handles a non-adjacent duplicate", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    record(audit, "interpretations", "create", [interpretation("tg.msg.82")]);
    await submitOneTask(audit);
    record(audit, "interpretations", "create", [interpretation("tg.msg.83")]);
    record(audit, "interpretations", "create", [interpretation("tg.msg.82", { createdAt: "2026-10-09T09:00:00.000Z" })]);
    const b = boot(audit);
    b.replay();
    expect(b.interpretations.get("tg.msg.82")).toEqual(interpretation("tg.msg.82"));
    expect(b.tasks.get("t261009-aaaaaa")).not.toBeNull();
    expect(b.journal.replaySkips().map((s) => s.key)).toEqual(["tg.msg.82"]);
  });

  it("4. handles multiple duplicate ids", () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const ids = ["tg.msg.79", "tg.msg.82", "tg.msg.85", "tg.msg.91"];
    for (const id of ids) record(audit, "interpretations", "create", [interpretation(id)]);
    for (const id of ids) record(audit, "interpretations", "create", [interpretation(id, { createdAt: "2026-10-09T08:00:01.000Z" })]);
    const b = boot(audit);
    b.replay();
    for (const id of ids) expect(b.interpretations.get(id)).toEqual(interpretation(id));
    expect(b.journal.replaySkips().map((s) => s.key)).toEqual(ids);
  });

  it("5. replay across repeated restarts yields identical state, equal to a single create", async () => {
    const clean = createInMemoryAuditRepository(() => "t");
    const dirty = createInMemoryAuditRepository(() => "t");
    for (const audit of [clean, dirty]) {
      record(audit, "interpretations", "create", [interpretation("tg.msg.79")], `a-${++seq}`);
      if (audit === dirty) record(audit, "interpretations", "create", [interpretation("tg.msg.79", { createdAt: "2026-10-09T08:00:05.000Z" })], `a-${++seq}`);
      record(audit, "interpretations", "create", [interpretation("tg.msg.80")], `a-${++seq}`);
    }
    const snapshot = (audit: AuditRepository) => {
      const b = boot(audit);
      b.replay();
      return [b.interpretations.get("tg.msg.79"), b.interpretations.get("tg.msg.80")];
    };
    const once = snapshot(clean);
    expect(snapshot(dirty)).toEqual(once);
    expect(snapshot(dirty)).toEqual(once);
    expect(snapshot(dirty)).toEqual(once);
  });

  it("6/7/8. unknown repository, unknown method and malformed records still fail closed", () => {
    const cases: [string, string, unknown, string][] = [
      ["evil", "create", [interpretation("tg.msg.1")], "unknown_repository"],
      ["interpretations", "delete", [interpretation("tg.msg.1")], "unknown_method"],
      ["interpretations", "create", "not-an-array", "malformed_record"],
      ["interpretations", "create", [{ fingerprint: "no-id" }], "malformed_record"],
      ["interpretations", "create", [interpretation("tg.msg.1"), "extra"], "malformed_record"],
    ];
    for (const [repository, method, args, category] of cases) {
      const audit = createInMemoryAuditRepository(() => "t");
      audit.append({ id: "bad-1", taskId: "repository-journal", actor: "system", event: REPOSITORY_JOURNAL_EVENT, metadata: { repository, method, at: "2026-10-09T08:00:00.000Z", args: args as never } });
      expect(replayError(() => boot(audit).replay())).toMatchObject({ category, index: 0, eventId: "bad-1" });
    }
    const audit = createInMemoryAuditRepository(() => "t");
    audit.append({ id: "bad-at", taskId: "repository-journal", actor: "system", event: REPOSITORY_JOURNAL_EVENT, metadata: { repository: "interpretations", method: "create", at: "not-a-date", args: [] } });
    expect(replayError(() => boot(audit).replay()).category).toBe("malformed_record");
  });

  it("9. a duplicate tasks.create is never silently ignored", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    await submitOneTask(audit);
    duplicateFirst(audit, "tasks", "create");
    expect(replayError(() => boot(audit).replay())).toMatchObject({ category: "repository_rejected", repository: "tasks", method: "create", eventId: "dup-tasks" });
  });

  it("10. a duplicate intakeRecords.create is never silently ignored", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    await submitOneTask(audit);
    duplicateFirst(audit, "intakeRecords", "create");
    expect(replayError(() => boot(audit).replay())).toMatchObject({ category: "repository_rejected", repository: "intakeRecords", method: "create", eventId: "dup-intakeRecords" });
  });

  it("11/12. diagnostics carry repository/method/event/key only, never payload, secrets or repository error text", () => {
    const audit = createInMemoryAuditRepository(() => "t");
    record(audit, "interpretations", "create", [interpretation("tg.msg.94")], "ev-1");
    record(audit, "interpretations", "create", [interpretation("tg.msg.94", { originalRequest: `${SECRET_BODY} v2` })], "ev-2");
    let error: unknown;
    try {
      boot(audit).replay();
    } catch (e) {
      error = e;
    }
    const message = (error as Error).message;
    expect(message).toBe("[journal] replay refused: category=duplicate_conflict index=1 event=ev-2 repository=interpretations method=create key=tg.msg.94");
    expect(message).not.toContain("PRIVATE-BODY-MARKER");
    expect(message).not.toContain("私密");
    expect(JSON.stringify((error as JournalReplayError).detail)).not.toContain("PRIVATE-BODY-MARKER");

    // A record key that is not shaped like an identifier is withheld rather than echoed.
    const hostile = createInMemoryAuditRepository(() => "t");
    record(hostile, "interpretations", "create", [interpretation(SECRET_BODY)], "ev-3");
    record(hostile, "interpretations", "create", [interpretation(SECRET_BODY, { fingerprint: "x" })], "ev-4");
    const detail = replayError(() => boot(hostile).replay());
    expect(detail.key).toBe("[withheld]");
    expect(JSON.stringify(detail)).not.toContain("PRIVATE-BODY-MARKER");
  });

  it("13. live-style sequence: create A, identical A, create B replays", () => {
    const audit = createInMemoryAuditRepository(() => "t");
    record(audit, "interpretations", "create", [interpretation("A")]);
    record(audit, "interpretations", "create", [interpretation("A", { createdAt: "2026-10-09T08:00:01.194Z" })]);
    record(audit, "interpretations", "create", [interpretation("B")]);
    const b = boot(audit);
    expect(b.replay()).toBe(3);
    expect(b.interpretations.get("A")).toEqual(interpretation("A"));
    expect(b.interpretations.get("B")).toEqual(interpretation("B"));
    // After replay a new live duplicate create is still rejected by the repository (no live idempotency change).
    expect(() => b.interpretations.create(interpretation("A"))).toThrow(/already exists/);
  });
});

describe("operator-superseded conflicting duplicates", () => {
  function conflicting() {
    const audit = createInMemoryAuditRepository(() => "t");
    const stray = record(audit, "interpretations", "create", [interpretation("tg.msg.96", { decision: { kind: "cancel_or_pause", taskId: "t-stray" } as never })]);
    const kept = record(audit, "interpretations", "create", [interpretation("tg.msg.96", { decision: { kind: "cancel_or_pause", taskId: "t-real" } as never, createdAt: "2026-10-09T08:00:01.000Z" })]);
    return { audit, stray, kept };
  }

  it("skips exactly the superseded record and keeps the other one", () => {
    const { audit, stray } = conflicting();
    const b = boot(audit, [stray]);
    b.replay();
    expect(b.interpretations.get("tg.msg.96")?.decision).toEqual({ kind: "cancel_or_pause", taskId: "t-real" });
    expect(b.journal.replaySkips()).toEqual([expect.objectContaining({ eventId: stray, key: "tg.msg.96", reason: "operator_superseded" })]);
  });

  it("refuses an override that names an unknown event, a non-policy repository, or leaves no survivor", async () => {
    const { audit, stray, kept } = conflicting();
    expect(replayError(() => boot(audit, ["no-such-event"]).replay())).toMatchObject({ category: "invalid_override", eventId: "no-such-event" });
    expect(replayError(() => boot(audit, [stray, kept]).replay())).toMatchObject({ category: "invalid_override", key: "tg.msg.96" });
    const lone = createInMemoryAuditRepository(() => "t");
    const only = record(lone, "interpretations", "create", [interpretation("tg.msg.1")]);
    expect(replayError(() => boot(lone, [only]).replay()).category).toBe("invalid_override");

    const tasksAudit = createInMemoryAuditRepository(() => "t");
    await submitOneTask(tasksAudit);
    duplicateFirst(tasksAudit, "tasks", "create");
    expect(replayError(() => boot(tasksAudit, ["dup-tasks"]).replay())).toMatchObject({ category: "invalid_override", repository: "tasks" });
  });

  it("a third, still-conflicting record fails closed even with one override", () => {
    const { audit, stray } = conflicting();
    record(audit, "interpretations", "create", [interpretation("tg.msg.96", { decision: { kind: "cancel_or_pause", taskId: "t-other" } as never })], "third");
    expect(replayError(() => boot(audit, [stray]).replay())).toMatchObject({ category: "duplicate_conflict", eventId: "third" });
  });
});
