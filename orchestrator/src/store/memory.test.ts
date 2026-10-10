import { describe, expect, it } from "vitest";
import { approvalAuthorizes } from "./repositories";
import { createInMemoryAuditRepository, createMemoryStore } from "./memory";
import { REDACTED } from "./sanitize";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const HASH = "0".repeat(64);

/** Deterministic clock: each call advances one second from a fixed epoch. */
function testClock(start = "2026-10-04T00:00:00.000Z") {
  let t = Date.parse(start);
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

const setup = () => createMemoryStore(testClock());
const newTask = { id: "t1", source: "chat", requesterId: "u1", rawText: "fix login bug" };

describe("TaskRepository", () => {
  it("creates tasks in received state with defaults and supports get/update", () => {
    const { tasks } = setup();
    const t = tasks.create(newTask);
    expect(t).toMatchObject({ state: "received", riskLevel: null, retries: 0, riskReasons: [], prNumber: null });
    expect(t.createdAt).toBe("2026-10-04T00:00:00.000Z");
    expect(tasks.get("t1")).toEqual(t);
    expect(tasks.get("missing")).toBeNull();

    const u = tasks.update("t1", { category: "bug_fix", riskLevel: "green", riskReasons: ["code_edit"], retries: 1 });
    expect(u).toMatchObject({ category: "bug_fix", riskLevel: "green", retries: 1, state: "received" });
    expect(u.updatedAt).not.toBe(t.updatedAt);
    expect(u.createdAt).toBe(t.createdAt);

    expect(() => tasks.create(newTask)).toThrow(/already exists/);
    expect(() => tasks.update("missing", {})).toThrow(/not found/);
    expect(() => tasks.update("t1", { retries: -1 })).toThrow(/non-negative/);
  });

  it("refuses to change state, identity, or raw request via update()", () => {
    const { tasks } = setup();
    tasks.create(newTask);
    for (const patch of [{ state: "complete" }, { id: "t2" }, { createdAt: "x" }, { rawText: "y" }, { requesterId: "z" }]) {
      expect(() => tasks.update("t1", patch as never)).toThrow(/cannot be updated/);
    }
    expect(tasks.get("t1")!.state).toBe("received");
  });

  it("validates state transitions through the taskState policy", () => {
    const { tasks } = setup();
    tasks.create(newTask);
    // unclassified tasks may only abort
    expect(() => tasks.transition("t1", "classified")).toThrow(/no riskLevel/);
    tasks.update("t1", { riskLevel: "green" });
    expect(() => tasks.transition("t1", "running")).toThrow(/\[taskState\].*not allowed/);
    expect(tasks.get("t1")!.state).toBe("received");

    for (const s of ["classified", "routed", "queued", "running", "pr_opened", "qa_running", "qa_passed"] as const) {
      expect(tasks.transition("t1", s).state).toBe(s);
    }
    // A passing PR is not completion unless the goal was the PR itself.
    expect(() => tasks.transition("t1", "complete")).toThrow(/PR-only goal/);
    expect(tasks.transition("t1", "complete", { completion: "pull_request" }).state).toBe("complete");
    expect(() => tasks.transition("t1", "failed")).toThrow(/not allowed/);
  });

  it("uses stored riskLevel so callers cannot skip red approval gates", () => {
    const { tasks } = setup();
    tasks.create(newTask);
    tasks.update("t1", { riskLevel: "red" });
    tasks.transition("t1", "classified");
    tasks.transition("t1", "routed");
    expect(() => tasks.transition("t1", "queued")).toThrow(/awaiting_approval/);
    tasks.transition("t1", "awaiting_approval");
    expect(() => tasks.transition("t1", "queued", { approvalPhase: "pre_execution" })).toThrow(/not been granted/);
    expect(tasks.transition("t1", "queued", { approvalPhase: "pre_execution", approved: true }).state).toBe("queued");
  });

  it("riskLevel can escalate via update() but never be downgraded", () => {
    const { tasks } = setup();
    const allowed = [
      [null, "green"], [null, "yellow"], [null, "red"],
      ["green", "green"], ["green", "yellow"], ["green", "red"],
      ["yellow", "yellow"], ["yellow", "red"],
      ["red", "red"],
    ] as const;
    allowed.forEach(([from, to], i) => {
      const id = `ok${i}`;
      tasks.create({ ...newTask, id });
      if (from) tasks.update(id, { riskLevel: from });
      expect(tasks.update(id, { riskLevel: to }).riskLevel).toBe(to);
    });

    const forbidden = [["red", "yellow"], ["red", "green"], ["yellow", "green"]] as const;
    forbidden.forEach(([from, to], i) => {
      const id = `bad${i}`;
      tasks.create({ ...newTask, id });
      tasks.update(id, { riskLevel: from });
      expect(() => tasks.update(id, { riskLevel: to, category: "bug_fix" })).toThrow(/cannot be downgraded/);
      expect(tasks.get(id)).toMatchObject({ riskLevel: from, category: null });
    });

    // clearing back to null (or bogus values) is also refused
    tasks.create({ ...newTask, id: "clr" });
    tasks.update("clr", { riskLevel: "red" });
    for (const v of [null, undefined, "purple"]) {
      expect(() => tasks.update("clr", { riskLevel: v as never })).toThrow(/riskLevel/);
    }
    expect(tasks.get("clr")!.riskLevel).toBe("red");
  });

  it("a red task cannot bypass approval by downgrading riskLevel before transition()", () => {
    const { tasks } = setup();
    tasks.create(newTask);
    tasks.update("t1", { riskLevel: "red" });
    tasks.transition("t1", "classified");
    tasks.transition("t1", "routed");
    expect(() => tasks.update("t1", { riskLevel: "green" })).toThrow(/cannot be downgraded/);
    expect(() => tasks.transition("t1", "queued")).toThrow(/awaiting_approval/);
  });

  it("allows unclassified tasks to be cancelled", () => {
    const { tasks } = setup();
    tasks.create(newTask);
    expect(tasks.transition("t1", "cancelled").state).toBe("cancelled");
  });
});

describe("TaskRunRepository", () => {
  it("supports create/get/update/listByTask", () => {
    const { runs } = setup();
    const r = runs.create({ id: "r1", taskId: "t1", worker: "claude", model: "claude-opus-5-5", promptHash: HASH });
    expect(r).toMatchObject({ endedAt: null, exitStatus: null, codespaceName: null });
    runs.create({ id: "r2", taskId: "t2", worker: "codex", model: "m", promptHash: HASH });
    const u = runs.update("r1", { exitStatus: "success", headSha: SHA_A, summary: "done", endedAt: "2026-10-04T01:00:00.000Z" });
    expect(u).toMatchObject({ exitStatus: "success", headSha: SHA_A, summary: "done" });
    expect(runs.get("r1")).toEqual(u);
    expect(runs.listByTask("t1").map((x) => x.id)).toEqual(["r1"]);
  });

  it("stores only a prompt hash, never a prompt", () => {
    const { runs } = setup();
    const base = { id: "r1", taskId: "t1", worker: "claude", model: "m" } as const;
    expect(() => runs.create({ ...base, promptHash: "Please refactor the auth module using token=abc" })).toThrow(/promptHash/);
    expect(() => runs.create({ ...base, promptHash: HASH.toUpperCase().replace(/0/g, "A") })).toThrow(/promptHash/);
    expect(Object.keys(runs.create({ ...base, promptHash: HASH }))).not.toContain("prompt");
  });

  it("rejects updates to immutable run fields and malformed SHAs", () => {
    const { runs } = setup();
    runs.create({ id: "r1", taskId: "t1", worker: "claude", model: "m", promptHash: HASH });
    expect(() => runs.update("r1", { promptHash: "x" } as never)).toThrow(/cannot be updated/);
    expect(() => runs.update("r1", { taskId: "t9" } as never)).toThrow(/cannot be updated/);
    expect(() => runs.update("r1", { headSha: "main" })).toThrow(/git SHA/);
  });
});

describe("ApprovalRepository", () => {
  const mergeA = {
    id: "a1",
    taskId: "t1",
    kind: "merge",
    requestedAction: "merge PR #5",
    expiresAt: "2026-10-05T00:00:00.000Z",
    bindingShaOrActionId: SHA_A,
  } as const;

  it("creates pending approvals and decides them once", () => {
    const { approvals } = setup();
    const a = approvals.create(mergeA);
    expect(a).toMatchObject({ status: "pending", decidedBy: null, decidedAt: null, channel: null });
    const d = approvals.decide("a1", { status: "approved", decidedBy: "owner", channel: "phone" });
    expect(d).toMatchObject({ status: "approved", decidedBy: "owner", channel: "phone" });
    expect(d.decidedAt).not.toBeNull();
    expect(() => approvals.decide("a1", { status: "rejected", decidedBy: "owner", channel: "phone" })).toThrow(/already approved/);
    expect(approvals.listByTask("t1")).toEqual([d]);
  });

  it("requires a binding, and merge approvals must bind to a full SHA", () => {
    const { approvals } = setup();
    expect(() => approvals.create({ ...mergeA, bindingShaOrActionId: "" })).toThrow(/required/);
    expect(() => approvals.create({ ...mergeA, bindingShaOrActionId: "main" })).toThrow(/full git SHA/);
    expect(approvals.create({ ...mergeA, id: "a2", kind: "execute_red_action", bindingShaOrActionId: "action-42" }).status).toBe("pending");
  });

  it("an approval for one SHA/action cannot authorize another", () => {
    const { approvals } = setup();
    approvals.create(mergeA);
    approvals.create({ ...mergeA, id: "a2", kind: "execute_red_action", bindingShaOrActionId: "action-1" });
    const merge = approvals.decide("a1", { status: "approved", decidedBy: "owner", channel: "chat" });
    const act = approvals.decide("a2", { status: "approved", decidedBy: "owner", channel: "chat" });
    const at = "2026-10-04T12:00:00.000Z";

    expect(approvalAuthorizes(merge, { taskId: "t1", kind: "merge", bindingShaOrActionId: SHA_A, at })).toEqual({ ok: true });
    expect(approvalAuthorizes(merge, { taskId: "t1", kind: "merge", bindingShaOrActionId: SHA_B, at }).ok).toBe(false);
    expect(approvalAuthorizes(merge, { taskId: "t2", kind: "merge", bindingShaOrActionId: SHA_A, at }).ok).toBe(false);
    expect(approvalAuthorizes(merge, { taskId: "t1", kind: "execute_red_action", bindingShaOrActionId: SHA_A, at }).ok).toBe(false);

    expect(approvalAuthorizes(act, { taskId: "t1", kind: "execute_red_action", bindingShaOrActionId: "action-1", at }).ok).toBe(true);
    expect(approvalAuthorizes(act, { taskId: "t1", kind: "execute_red_action", bindingShaOrActionId: "action-2", at }).ok).toBe(false);

    // binding is immutable: no repository operation can rebind an approval
    expect(approvals.get("a1")!.bindingShaOrActionId).toBe(SHA_A);
    const rebind = approvals.get("a1")!;
    rebind.bindingShaOrActionId = SHA_B;
    expect(approvals.get("a1")!.bindingShaOrActionId).toBe(SHA_A);
  });

  it("rejected, pending, expired or out-of-window approvals never authorize", () => {
    const { approvals } = setup();
    const at = "2026-10-04T12:00:00.000Z";
    const req = { taskId: "t1", kind: "merge", bindingShaOrActionId: SHA_A, at } as const;
    const pending = approvals.create(mergeA);
    expect(approvalAuthorizes(pending, req).ok).toBe(false);
    const rejected = approvals.decide("a1", { status: "rejected", decidedBy: "owner", channel: "chat" });
    expect(approvalAuthorizes(rejected, req).ok).toBe(false);

    approvals.create({ ...mergeA, id: "a2" });
    const expired = approvals.expire("a2");
    expect(expired.status).toBe("expired");
    expect(approvalAuthorizes(expired, req).ok).toBe(false);
    expect(() => approvals.decide("a2", { status: "approved", decidedBy: "owner", channel: "chat" })).toThrow(/already expired/);

    approvals.create({ ...mergeA, id: "a3" });
    const ok = approvals.decide("a3", { status: "approved", decidedBy: "owner", channel: "chat" });
    expect(approvalAuthorizes(ok, { ...req, at: mergeA.expiresAt }).ok).toBe(false);
  });

  it("rejects invalid request timestamps and enforces the expiry boundary", () => {
    const { approvals } = setup();
    approvals.create(mergeA);
    const ok = approvals.decide("a1", { status: "approved", decidedBy: "owner", channel: "chat" });
    const req = { taskId: "t1", kind: "merge", bindingShaOrActionId: SHA_A } as const;

    for (const at of ["", "not-a-date", "2026-13-45T99:99:99Z", "NaN"]) {
      const r = approvalAuthorizes(ok, { ...req, at });
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ reason: expect.stringMatching(/invalid/) });
    }

    expect(approvalAuthorizes(ok, { ...req, at: "2026-10-04T23:59:59.999Z" })).toEqual({ ok: true });
    expect(approvalAuthorizes(ok, { ...req, at: "2026-10-05T00:00:00.000Z" }).ok).toBe(false);
    expect(approvalAuthorizes(ok, { ...req, at: "2026-10-05T00:00:00.001Z" }).ok).toBe(false);
  });

  it("cannot decide an approval after its expiry", () => {
    const { approvals } = createMemoryStore(testClock("2026-10-06T00:00:00.000Z"));
    approvals.create(mergeA);
    expect(() => approvals.decide("a1", { status: "approved", decidedBy: "owner", channel: "chat" })).toThrow(/expired/);
    expect(approvals.get("a1")!.status).toBe("pending");
  });
});

describe("AuditRepository", () => {
  it("appends and lists events in order, filtered by task", () => {
    const { audit } = setup();
    audit.append({ id: "e1", taskId: "t1", actor: "manager", event: "task.created", toState: "received" });
    audit.append({ id: "e2", taskId: "t2", actor: "system", event: "task.created" });
    audit.append({ id: "e3", taskId: "t1", actor: "worker", event: "state", fromState: "queued", toState: "running" });
    expect(audit.list().map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(audit.list({ taskId: "t1" }).map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(audit.list()[0]).toMatchObject({ fromState: null, toState: "received", metadata: {} });
    expect(() => audit.append({ id: "e1", taskId: "t1", actor: "manager", event: "dup" })).toThrow(/already exists/);
    expect(() => audit.append({ id: "e9", taskId: "t1", actor: "root" as never, event: "x" })).toThrow(/actor/);
  });

  it("sanitizes metadata before persistence", () => {
    const { audit } = setup();
    const raw = { pr: 5, auth: { headers: { cookie: "sid=1" }, oauthCode: "c" }, env: [{ AWS_SECRET_ACCESS_KEY: "s" }] };
    const e = audit.append({ id: "e1", taskId: "t1", actor: "system", event: "x", metadata: raw });
    const stored = audit.list()[0];
    expect(stored).toEqual(e);
    expect(stored.metadata).toEqual({
      auth: { headers: { cookie: REDACTED }, oauthCode: REDACTED },
      env: [{ AWS_SECRET_ACCESS_KEY: REDACTED }],
      pr: 5,
    });
    expect(raw.auth.oauthCode).toBe("c"); // caller's object untouched
  });

  it("exposes no update/delete API (append-only)", () => {
    const { audit } = setup();
    const repo = createInMemoryAuditRepository(() => "2026-10-04T00:00:00.000Z");
    for (const r of [audit, repo]) {
      expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(r).sort()).toEqual(["append", "list"]);
      for (const name of ["update", "delete", "remove", "clear", "set", "replace"]) {
        expect(r).not.toHaveProperty(name);
      }
      // the repository object is frozen: no API can be bolted on later
      expect(Object.isFrozen(r)).toBe(true);
      expect(() => Object.assign(r, { delete: () => undefined })).toThrow();
    }
  });

  it("returned events and lists cannot mutate the stored log", () => {
    const { audit } = setup();
    const e = audit.append({ id: "e1", taskId: "t1", actor: "human", event: "approve", metadata: { note: "ok" } });
    e.event = "tampered";
    e.metadata.note = "tampered";
    const list = audit.list();
    list[0].event = "tampered";
    list.push({ ...list[0], id: "forged" });
    list.length = 0;
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0]).toMatchObject({ id: "e1", event: "approve", metadata: { note: "ok" } });
  });
});

describe("cloning", () => {
  it("callers cannot mutate stored tasks, runs, or approvals by reference", () => {
    const { tasks, runs, approvals } = setup();
    const input = { ...newTask };
    const t = tasks.create(input);
    input.rawText = "mutated";
    t.state = "complete";
    t.riskReasons.push("forged");
    tasks.get("t1")!.riskReasons.push("forged");
    const reasons = ["a"];
    tasks.update("t1", { riskReasons: reasons });
    reasons.push("forged");
    expect(tasks.get("t1")).toMatchObject({ state: "received", rawText: "fix login bug", riskReasons: ["a"] });

    runs.create({ id: "r1", taskId: "t1", worker: "claude", model: "m", promptHash: HASH }).exitStatus = "success";
    runs.listByTask("t1")[0].summary = "forged";
    expect(runs.get("r1")).toMatchObject({ exitStatus: null, summary: null });

    approvals.create({ id: "a1", taskId: "t1", kind: "start", requestedAction: "start", expiresAt: "2026-10-05T00:00:00.000Z", bindingShaOrActionId: "act-1" }).status = "approved";
    approvals.listByTask("t1")[0].status = "approved";
    expect(approvals.get("a1")!.status).toBe("pending");
  });

  it("is deterministic across identical runs", () => {
    const run = () => {
      const s = setup();
      s.tasks.create(newTask);
      s.tasks.update("t1", { riskLevel: "green" });
      s.tasks.transition("t1", "classified");
      s.audit.append({ id: "e1", taskId: "t1", actor: "manager", event: "x", metadata: { b: 1, a: 2 } });
      return JSON.stringify([s.tasks.get("t1"), s.audit.list()]);
    };
    expect(run()).toBe(run());
  });
});
