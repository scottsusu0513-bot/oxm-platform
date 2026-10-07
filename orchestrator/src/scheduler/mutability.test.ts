import { describe, expect, it } from "vitest";
import { routeByMode } from "../agentRuntime/readOnlySnapshot";
import { checkMutability, type WorkerKind } from "../domain/types";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { StartApprovalNotice } from "../humanInteraction/types";
import { formatStartApproval } from "../telegram/format";
import type { GoalReviewer, IntentPlanner } from "../planning/types";
import { createInMemoryAuditRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import type { WorkerAdapter, WorkerTaskContract } from "../workers/types";
import { createWorkerPort } from "./adapters";
import { createSimulation, fakeIntake } from "./fake";
import { createManagerLoop } from "./loop";
import { createAuditCheckpointRepository } from "./persistence";

const READ_RED = "幫我查正式資料庫目前有哪些設定，不要修改";
const CHANGE_RED = "幫我修改正式資料庫 schema";
const AUDIT_RO = "檢查 production 登入設定是否安全";
const AUDIT_FIX = "檢查 production 登入設定，有問題就修";

const INTENT: Record<string, string> = {
  [READ_RED]: "investigate_or_answer",
  [CHANGE_RED]: "change_code",
  [AUDIT_RO]: "audit_or_review",
  [AUDIT_FIX]: "audit_and_fix",
};

function planner(observations: Record<string, string[]> = {}): IntentPlanner {
  return {
    async interpret(input) {
      return {
        intent: INTENT[input.message],
        taskId: null,
        title: "owner request",
        interpretedObjective: `Handle the owner's request: ${input.message}`,
        criteria: ["The owner's requested outcome is delivered"],
        clarificationQuestion: "",
        riskObservations: observations[input.message] ?? [],
      };
    },
  };
}

const approve: GoalReviewer = {
  async review(input) {
    return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "verified", reason: "" })) };
  },
};

/**
 * Manager Loop over the simulation, with the Worker port built exactly like
 * production: routeByMode(change adapter, snapshot adapter) per worker kind.
 * Records which runtime and which contract mutability every run used.
 */
function setup(opts: { observations?: Record<string, string[]>; audit?: AuditRepository; persistence?: boolean } = {}) {
  const audit = opts.audit ?? createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  let cp = 0;
  const sim = createSimulation({ autoApproveCommits: false, goalReviewer: approve, ...(opts.persistence ? { persistence: createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` }) } : {}) });
  const runs: { runtime: "change" | "snapshot"; mode: string }[] = [];
  const via = (kind: WorkerKind, runtime: "change" | "snapshot"): WorkerAdapter => ({
    kind,
    start(req) {
      runs.push({ runtime, mode: req.contract.mode ?? "change" });
      return sim.ports.worker.start(kind, req.contract, req.redApproval ?? null);
    },
  });
  const worker = createWorkerPort({
    claude: routeByMode(via("claude", "change"), via("claude", "snapshot")),
    codex: routeByMode(via("codex", "change"), via("codex", "snapshot")),
    now: sim.ports.now,
  });
  const ports = { ...sim.ports, worker };
  const loop = createManagerLoop(ports);
  const h = createHumanInteractionHarness({ loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: planner(opts.observations), idPrefix: "x" });
  const say = async (text: string, key = "tg.msg.1") => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text });
    await loop.settle();
    return r;
  };
  const approveStart = async () => {
    await h.service.observe();
    const n = h.transport.sent.find((s) => s.notice.kind === "start_approval")!.notice as StartApprovalNotice;
    const r = await h.service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${n.ref}.approve`, ref: n.ref, action: "approve" });
    await loop.settle();
    return { n, r };
  };
  return { sim, loop, ports, runs, audit, say, approveStart, ...h };
}

describe("mutability (intent) is independent of risk", () => {
  it("READ_ONLY + RED: approval required, still read-only after approval, isolated snapshot, no commit/publish path", async () => {
    const x = setup();
    expect((await x.say(READ_RED)).outcome).toBe("submitted");
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "read_only", risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(x.runs).toEqual([]);

    const { n, r } = await x.approveStart();
    expect(n.readOnly).toBe(true);
    expect(r.outcome).toBe("approved");
    const t = x.loop.task("x-task-1")!;
    // Still read-only after approval; ran only in the snapshot runtime; finished without any publish path.
    expect(t).toMatchObject({ mode: "read_only", risk: "red", status: "accepted", state: "complete" });
    expect(x.runs).toEqual([{ runtime: "snapshot", mode: "read_only" }]);
    expect(x.sim.approvals.listByTask("x-task-1").map((a) => a.kind)).toEqual(["start"]);
    expect(x.sim.commits).toHaveLength(0);
    expect(x.sim.remote.calls.filter((c) => /PUSH|CREATE pr/.test(c))).toEqual([]);
    await x.service.observe();
    expect(x.transport.sent.some((s) => s.notice.kind === "commit_publish_approval")).toBe(false);
  });

  it("the red approval is bound to the read-only contract and cannot add mutation authority", async () => {
    const x = setup();
    await x.say(READ_RED);
    const pending = await x.loop.pendingApproval("x-task-1");
    expect(pending?.startEvidence).toMatchObject({ mode: "read_only" });
    // The Telegram message states the read-only scope of the approval.
    await x.service.observe();
    const notice = x.transport.sent.find((s) => s.notice.kind === "start_approval")!.notice as StartApprovalNotice;
    expect(notice.readOnly).toBe(true);
    const telegramText = formatStartApproval(notice);
    expect(telegramText).toContain("Mode: READ-ONLY");
    expect(telegramText).toContain("no file can change and there is no commit/publish path");
    await x.approveStart();
    expect(x.runs.every((r) => r.mode === "read_only" && r.runtime === "snapshot")).toBe(true);
  });

  it("READ_ONLY audit + RED is valid and stays read-only", async () => {
    // Reading production settings is not red by itself; a planner risk observation makes it red here.
    const x = setup({ observations: { [AUDIT_RO]: ["sensitive_operation_unresolved"] } });
    await x.say(AUDIT_RO);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "read_only", risk: "red", approvalPhase: "pre_execution" });
    await x.approveStart();
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "read_only", status: "accepted" });
    expect(x.runs).toEqual([{ runtime: "snapshot", mode: "read_only" }]);
  });

  it("MUTATING + RED: pre-execution approval, then the normal mutation path, then a separate commit/publish approval", async () => {
    const x = setup();
    await x.say(CHANGE_RED);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "change", risk: "red", approvalPhase: "pre_execution" });
    expect(x.runs).toEqual([]);
    await x.approveStart();
    expect(x.runs).toEqual([{ runtime: "change", mode: "change" }]);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "change", status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(x.sim.commits).toHaveLength(0);
  });

  it("audit_and_fix + RED is mutating because its INTENT authorizes scoped fixes, not because it is red", async () => {
    const x = setup();
    await x.say(AUDIT_FIX);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "change", risk: "red", approvalPhase: "pre_execution" });
    await x.approveStart();
    expect(x.runs).toEqual([{ runtime: "change", mode: "change" }]);
    // Same intent, green text: still mutating (risk played no part in mutability).
    const y = setup();
    INTENT["檢查登入頁的錯字，有問題就修"] = "audit_and_fix";
    await y.say("檢查登入頁的錯字，有問題就修");
    expect(y.loop.task("x-task-1")).toMatchObject({ mode: "change" });
    expect(y.loop.task("x-task-1")!.risk).not.toBe("red");
  });

  it("planner risk observations raise risk but can never change mutability", async () => {
    const x = setup({ observations: { [READ_RED]: ["prod_data_write", "destructive_data_delete", "secret_change"] } });
    await x.say(READ_RED);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "read_only", risk: "red" });
    const y = setup({ observations: { [CHANGE_RED]: [] } });
    await y.say(CHANGE_RED);
    expect(y.loop.task("x-task-1")).toMatchObject({ mode: "change", risk: "red" });
  });

  it("restart/checkpoint preserves mutability independently from risk", async () => {
    const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
    const x = setup({ audit, persistence: true });
    await x.say(READ_RED);
    expect(x.loop.task("x-task-1")).toMatchObject({ mode: "read_only", risk: "red", status: "needs_human_approval" });
    const loop2 = createManagerLoop(x.ports);
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("x-task-1")).toMatchObject({ mode: "read_only", risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
    const h2 = createHumanInteractionHarness({ loop: loop2, approvals: x.sim.approvals, audit, now: x.sim.ports.now, planner: planner(), idPrefix: "x2" });
    await h2.service.observe();
    const n = [...x.transport.sent, ...h2.transport.sent].find((s) => s.notice.kind === "start_approval")!.notice;
    expect((await h2.service.handleAction({ kind: "action", idempotencyKey: "k", ref: n.ref, action: "approve" })).outcome).toBe("approved");
    await loop2.settle();
    expect(loop2.task("x-task-1")).toMatchObject({ mode: "read_only", status: "accepted" });
    expect(x.runs).toEqual([{ runtime: "snapshot", mode: "read_only" }]);
    expect(x.sim.commits).toHaveLength(0);
  });
});

describe("typed mutability invariant fails closed", () => {
  it("checkMutability rejects any contradiction between intent, task mode and contract", () => {
    expect(checkMutability({ taskMode: "read_only", contractMode: "read_only", intent: "investigate_or_answer" })).toEqual({ ok: true });
    expect(checkMutability({ taskMode: "change", contractMode: undefined, intent: "change_code" })).toEqual({ ok: true });
    expect(checkMutability({ taskMode: "read_only", contractMode: "change" }).ok).toBe(false);
    expect(checkMutability({ taskMode: "change", contractMode: "read_only" }).ok).toBe(false);
    expect(checkMutability({ taskMode: "change", contractMode: "change", intent: "investigate_or_answer" }).ok).toBe(false);
    expect(checkMutability({ taskMode: "read_only", contractMode: "read_only", intent: "audit_and_fix" }).ok).toBe(false);
  });

  it("a task whose mode contradicts its intent never starts a Worker", async () => {
    const sim = createSimulation({ autoApproveCommits: false });
    const tampered = fakeIntake({ taskId: "tamper1" }, { goal: { intent: "investigate_or_answer", originalRequest: "q", interpretedObjective: "o" } });
    await sim.create(tampered); // mode "change" (default) vs a read-only intent
    expect(sim.loop.task("tamper1")).toMatchObject({ status: "blocked" });
    expect(sim.loop.task("tamper1")!.blockingReason).toMatch(/mutability invariant violated/);
    expect(sim.workerCalls).toHaveLength(0);
  });

  it("intake rejects a request whose mode contradicts its interpreted intent", () => {
    const c: Partial<WorkerTaskContract> = { mode: "read_only" };
    expect(checkMutability({ taskMode: "change", contractMode: c.mode, intent: "change_code" }).ok).toBe(false);
  });
});
