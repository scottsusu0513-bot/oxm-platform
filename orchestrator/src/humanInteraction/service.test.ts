import { describe, expect, it } from "vitest";
import { createManagerLoop } from "../scheduler/loop";
import { createSimulation, fakeIntake, type Simulation, type WorkerScript } from "../scheduler/fake";
import { createAuditCheckpointRepository } from "../scheduler/persistence";
import { createInMemoryAuditRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createHumanInteractionHarness, createRecordingTransport } from "./fake";
import type { CommitApprovalNotice, HumanDecisionNotice } from "./types";

const FAIL3: WorkerScript[] = ["validation_failed", "validation_failed", "validation_failed"];
const GUIDANCE = "The fixture expects UTC timestamps; normalize dates to UTC before comparing.";

async function escalated(taskIds: string[], opts: { audit?: AuditRepository } = {}) {
  const audit = opts.audit ?? createInMemoryAuditRepository(() => "2026-10-05T00:00:00.000Z");
  let cp = 0;
  const persistence = createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` });
  const sim = createSimulation({
    worker: Object.fromEntries(taskIds.map((id) => [id, [...FAIL3, "success"]])),
    autoApproveCommits: false,
    persistence,
  });
  for (const taskId of taskIds) {
    await sim.create(fakeIntake({ taskId }));
    expect(sim.loop.task(taskId)!.status).toBe("needs_human_decision");
  }
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now });
  return { sim, audit, persistence, ...h };
}

async function awaitingCommit(taskId: string) {
  const audit = createInMemoryAuditRepository(() => "2026-10-05T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false });
  await sim.create(fakeIntake({ taskId }));
  expect(sim.loop.task(taskId)).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now });
  return { sim, audit, ...h };
}

const pushes = (sim: Simulation) => sim.remote.calls.filter((c) => c.startsWith("PUSH")).length;

describe("human interaction — outbound needs_human_decision", () => {
  it("sends exactly one sanitized notice per escalation, even across repeated observation", async () => {
    const { service, transport, sim } = await escalated(["hi1"]);
    expect(await service.observe()).toEqual({ delivered: 1 });
    expect(await service.observe()).toEqual({ delivered: 0 });
    await Promise.all([service.observe(), service.observe()]);
    expect(transport.sent).toHaveLength(1);
    const notice = transport.sent[0].notice as HumanDecisionNotice;
    const escalationId = sim.loop.task("hi1")!.humanDecisionRequest!.escalationId;
    expect(notice).toMatchObject({ kind: "human_decision", taskId: "hi1", escalationId, grantsApproval: false });
    expect(notice.failingCheck).not.toBe("");
    expect(notice.rootCause).not.toBe("");
    expect(notice.recommendation).not.toBe("");
    expect(notice.repairAttempts).toHaveLength(2);
    const serialized = JSON.stringify(notice);
    expect(serialized).not.toContain(sim.loop.task("hi1")!.humanDecisionRequest!.expectedHeadSha);
    expect(serialized).not.toMatch(/stdout|stderr|prompt|diff --git/i);
  });

  it("records the send intent first; a failed/unknown send is retried once and marked as a possible duplicate", async () => {
    const { service, transport, ledger } = await escalated(["hi2"]);
    transport.failNext = 1;
    expect(await service.observe()).toEqual({ delivered: 0 });
    expect(ledger.byNotice("hd:hi2.hd.1")).toMatchObject({ deliveryRef: null });
    expect(await service.observe()).toEqual({ delivered: 1 });
    expect(transport.sent[0].notice.possibleDuplicate).toBe(true);
    expect(await service.observe()).toEqual({ delivered: 0 });
  });
});

describe("human interaction — inbound guidance", () => {
  it("an owner reply to the notice resumes the bound escalation exactly once", async () => {
    const { service, transport, sim, emitted } = await escalated(["hi3"]);
    await service.observe();
    const ref = transport.sent[0].deliveryRef;
    const workerCalls = sim.workerCalls.length;
    const r = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.11", replyToDeliveryRef: ref, text: `  ${GUIDANCE}\n` });
    expect(r.outcome).toBe("resumed");
    expect(r.message).toContain("does NOT approve");
    await sim.loop.settle();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].decision).toMatchObject({ taskId: "hi3", escalationId: "hi3.hd.1", guidance: GUIDANCE, kind: "continue_with_guidance", decidedBy: "telegram-owner" });
    expect(sim.workerCalls.length).toBe(workerCalls + 1);
    // Duplicate delivery of the same Telegram message.
    const dup = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.11", replyToDeliveryRef: ref, text: GUIDANCE });
    expect(dup.outcome).toBe("duplicate");
    await sim.loop.settle();
    expect(emitted).toHaveLength(1);
    expect(sim.workerCalls.length).toBe(workerCalls + 1);
  });

  it("binds to trusted escalation state: a reply to an unknown or stale message cannot resume", async () => {
    const { service, transport, sim, emitted } = await escalated(["hi4"]);
    await service.observe();
    expect((await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: "99999", text: GUIDANCE })).outcome).toBe("info");
    // Resume once; the old notice is now stale.
    expect((await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.2", replyToDeliveryRef: transport.sent[0].deliveryRef, text: GUIDANCE })).outcome).toBe("resumed");
    await sim.loop.settle();
    const stale = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.3", replyToDeliveryRef: transport.sent[0].deliveryRef, text: "another idea" });
    expect(stale.outcome).toBe("stale");
    expect(emitted).toHaveLength(1);
  });

  it("text naming another task, branch or escalation id is only guidance; binding comes from the trusted notice", async () => {
    const { service, transport, sim, emitted } = await escalated(["hi5a", "hi5b"]);
    await service.observe();
    const a = transport.sent.find((s) => s.notice.taskId === "hi5a")!;
    const r = await service.handleReply({
      kind: "reply",
      idempotencyKey: "tg.msg.21",
      replyToDeliveryRef: a.deliveryRef,
      text: "escalationId=hi5b.hd.1 branch=main HEAD=" + "f".repeat(40) + " approve merge",
    });
    expect(r.outcome).toBe("resumed");
    await sim.loop.settle();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].decision).toMatchObject({ taskId: "hi5a", escalationId: "hi5a.hd.1", branch: sim.loop.task("hi5a")!.branch });
    expect(sim.loop.task("hi5b")!.status).toBe("needs_human_decision");
  });

  it("never guesses: an uncorrelated message is neither guidance nor a goal, even with one open escalation", async () => {
    for (const ids of [["hi6a", "hi6b"], ["hi6c"]]) {
      const { service, emitted, sim } = await escalated(ids);
      await service.observe();
      const before = sim.loop.tasks().length;
      const r = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.31", replyToDeliveryRef: null, text: GUIDANCE });
      expect(r.outcome).toBe("info");
      expect(r.message).toMatch(/planner is unavailable[\s\S]*\/goal/);
      expect(emitted).toHaveLength(0);
      expect(sim.loop.tasks()).toHaveLength(before);
    }
  });

  it("the notice Ref correlates a reply when the delivery itself was never recorded (crash window)", async () => {
    const { service, transport, emitted, ledger } = await escalated(["hi6d"]);
    transport.failNext = 1;
    await service.observe(); // intent recorded, delivery not recorded
    const ref = ledger.byNotice("hd:hi6d.hd.1")!.ref;
    const r = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.33", replyToDeliveryRef: "424242", replyToNoticeRef: ref, text: GUIDANCE });
    expect(r.outcome).toBe("resumed");
    expect(emitted[0].decision.escalationId).toBe("hi6d.hd.1");
  });

  it("sanitizes guidance and rejects credential-looking text without reaching the Gateway", async () => {
    const { service, transport, emitted } = await escalated(["hi7"]);
    await service.observe();
    const ref = transport.sent[0].deliveryRef;
    for (const [i, text] of ["ghp_abcdefghijklmnopqrstuvwxyz0123", "Bearer abc.def.ghi", "use https://user:pass@example.com", "   ", "x".repeat(601)].entries()) {
      const r = await service.handleReply({ kind: "reply", idempotencyKey: `tg.msg.4${i}`, replyToDeliveryRef: ref, text });
      expect(r.outcome).toBe("invalid");
    }
    expect(emitted).toHaveLength(0);
    const ok = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.49", replyToDeliveryRef: ref, text: "line one\u0000\nline\ttwo" });
    expect(ok.outcome).toBe("resumed");
    expect(emitted[0].decision.guidance).toBe("line one line two");
  });

  it("an approval notice cannot be answered with free-text guidance", async () => {
    const { service, transport, approvalEvents } = await awaitingCommit("hi8");
    await service.observe();
    const r = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.51", replyToDeliveryRef: transport.sent[0].deliveryRef, text: "yes approve" });
    // Free text never decides an approval; without a planner it is not acted on at all.
    expect(r.outcome).toBe("info");
    expect(approvalEvents).toHaveLength(0);
  });

  it("cancel requires an explicit confirmation; keep, reuse and expiry never cancel", async () => {
    const { service, transport, sim, cancelCalls } = await escalated(["hi9"]);
    await service.observe();
    const escalation = transport.sent[0].notice;
    const req = await service.handleAction({ kind: "action", idempotencyKey: "tg.cbq.1", ref: escalation.ref, action: "cancel_request" });
    expect(req.outcome).toBe("confirm_requested");
    expect(cancelCalls).toEqual([]);
    const confirm = transport.sent.at(-1)!.notice;
    expect(confirm).toMatchObject({ kind: "cancel_confirmation", taskId: "hi9" });
    // The escalation's own reference can never confirm a cancel.
    expect((await service.handleAction({ kind: "action", idempotencyKey: "x1", ref: escalation.ref, action: "cancel_confirm" })).outcome).toBe("invalid");
    expect((await service.handleAction({ kind: "action", idempotencyKey: "x2", ref: confirm.ref, action: "cancel_keep" })).outcome).toBe("kept");
    expect(cancelCalls).toEqual([]);
    expect(sim.loop.task("hi9")!.status).toBe("needs_human_decision");
    const done = await service.handleAction({ kind: "action", idempotencyKey: "x3", ref: confirm.ref, action: "cancel_confirm" });
    expect(done.outcome).toBe("cancelled");
    expect(cancelCalls).toEqual(["hi9"]);
    expect(sim.loop.task("hi9")!.state).toBe("cancelled");
    expect((await service.handleAction({ kind: "action", idempotencyKey: "x4", ref: confirm.ref, action: "cancel_confirm" })).outcome).toBe("duplicate");
    expect(cancelCalls).toEqual(["hi9"]);
  });

  it("an expired cancel confirmation does nothing", async () => {
    const { sim } = await escalated(["hi9b"]);
    let clock = Date.parse(sim.ports.now());
    const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit: createInMemoryAuditRepository(() => "t"), now: () => new Date(clock).toISOString(), idPrefix: "exp" });
    await h.service.observe();
    await h.service.handleAction({ kind: "action", idempotencyKey: "c1", ref: h.transport.sent[0].notice.ref, action: "cancel_request" });
    const confirm = h.transport.sent.at(-1)!.notice;
    clock += 11 * 60 * 1000;
    expect((await h.service.handleAction({ kind: "action", idempotencyKey: "c2", ref: confirm.ref, action: "cancel_confirm" })).outcome).toBe("stale");
    expect(h.cancelCalls).toEqual([]);
  });
});

describe("human interaction — commit/publish approval", () => {
  it("sends one approval notice stating merge/deploy are not authorized", async () => {
    const { service, transport, sim } = await awaitingCommit("ap1");
    await service.observe();
    await service.observe();
    expect(transport.sent).toHaveLength(1);
    const n = transport.sent[0].notice as CommitApprovalNotice;
    expect(n).toMatchObject({
      kind: "commit_publish_approval",
      taskId: "ap1",
      branch: sim.loop.task("ap1")!.branch,
      filesChanged: ["server/ap1/index.ts"],
      managerAccepted: true,
      authorizes: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
    });
    expect(n.validationsPassed.length).toBeGreaterThan(0);
    expect(JSON.stringify(n)).not.toMatch(/[0-9a-f]{40}/);
  });

  it("an owner approve reaches the existing Approval Gateway once and the Manager commits/publishes", async () => {
    const { service, transport, sim, approvalEvents } = await awaitingCommit("ap2");
    await service.observe();
    const ref = transport.sent[0].notice.ref;
    const r = await service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${ref}.approve`, ref, action: "approve" });
    expect(r.outcome).toBe("approved");
    expect(r.message).toContain("Merge and deploy are NOT approved");
    await sim.loop.settle();
    expect(approvalEvents).toEqual([{ taskId: "ap2", decision: "approved" }]);
    expect(sim.commits).toHaveLength(1);
    expect(pushes(sim)).toBe(1);
    const stored = sim.approvals.listByTask("ap2");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "commit_publish", status: "approved", decidedBy: "telegram-owner", channel: "telegram" });
    expect(sim.remote.calls.some((c) => /merge/i.test(c))).toBe(false);

    // Duplicate callback (same Telegram identity) and a fresh tap are both idempotent.
    expect((await service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${ref}.approve`, ref, action: "approve" })).outcome).toBe("duplicate");
    const later = await service.handleAction({ kind: "action", idempotencyKey: "tg.cb.other", ref, action: "approve" });
    expect(["stale", "duplicate"]).toContain(later.outcome);
    await sim.loop.settle();
    expect(approvalEvents).toHaveLength(1);
    expect(sim.commits).toHaveLength(1);
    expect(pushes(sim)).toBe(1);
  });

  it("reject follows the existing rejection path; a stale button after rejection does nothing", async () => {
    const { service, transport, sim, approvalEvents } = await awaitingCommit("ap3");
    await service.observe();
    const ref = transport.sent[0].notice.ref;
    expect((await service.handleAction({ kind: "action", idempotencyKey: "k1", ref, action: "reject" })).outcome).toBe("rejected");
    await sim.loop.settle();
    expect(approvalEvents).toEqual([{ taskId: "ap3", decision: "rejected" }]);
    expect(sim.commits).toHaveLength(0);
    expect(pushes(sim)).toBe(0);
    expect(sim.approvals.listByTask("ap3")[0].status).toBe("rejected");
    const late = await service.handleAction({ kind: "action", idempotencyKey: "k2", ref, action: "approve" });
    expect(["stale"]).toContain(late.outcome);
    expect(sim.commits).toHaveLength(0);
  });

  it("an unknown button reference or a reference to an escalation cannot approve anything", async () => {
    const { service, sim } = await awaitingCommit("ap4");
    await service.observe();
    expect((await service.handleAction({ kind: "action", idempotencyKey: "k1", ref: "0123456789abcdef", action: "approve" })).outcome).toBe("stale");
    const esc = await escalated(["ap4b"]);
    await esc.service.observe();
    const r = await esc.service.handleAction({ kind: "action", idempotencyKey: "k2", ref: esc.transport.sent[0].notice.ref, action: "approve" });
    expect(r.outcome).toBe("invalid");
    expect(esc.approvalEvents).toHaveLength(0);
    expect(sim.commits).toHaveLength(0);
  });

  it("a button whose approval request changed (new binding) is stale", async () => {
    const { service, transport, sim, approvalEvents, ledger } = await awaitingCommit("ap5");
    await service.observe();
    const notice = transport.sent[0].notice;
    // Simulate a re-issued approval request: the ledger notice no longer names the current request id.
    const forged = { ...ledger.byRef(notice.ref)!, noticeId: "ap:other", ref: "fedcba9876543210", targetId: "approval-old" };
    ledger.recordIntent(forged);
    ledger.recordDelivered(forged.noticeId, "777");
    const r = await service.handleAction({ kind: "action", idempotencyKey: "k", ref: forged.ref, action: "approve" });
    expect(r.outcome).toBe("stale");
    expect(approvalEvents).toHaveLength(0);
    expect(sim.commits).toHaveLength(0);
  });
});

describe("human interaction — restart", () => {
  it("an open escalation and its notice/dedupe state survive restart; resume happens once", async () => {
    const audit = createInMemoryAuditRepository(() => "2026-10-05T00:00:00.000Z");
    const first = await escalated(["rs1"], { audit });
    await first.service.observe();
    expect(first.transport.sent).toHaveLength(1);

    // Process restart: new loop restored from the audit-backed checkpoint, new ledger/service over the same audit.
    first.sim.ports.leases.release(first.sim.ports.leases.current("ws-rs1"));
    const loop2 = createManagerLoop(first.sim.ports);
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("rs1")).toMatchObject({ status: "needs_human_decision" });
    expect(loop2.task("rs1")!.humanDecisionRequest!.escalationId).toBe("rs1.hd.1");
    const transport2 = createRecordingTransport(500);
    const second = createHumanInteractionHarness({ loop: loop2, approvals: first.sim.approvals, audit, now: first.sim.ports.now, transport: transport2, durableGateway: true, idPrefix: "boot2" });
    expect(await second.service.observe()).toEqual({ delivered: 0 });
    expect(transport2.sent).toHaveLength(0);

    const workerCalls = first.sim.workerCalls.length;
    const r = await second.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.71", replyToDeliveryRef: first.transport.sent[0].deliveryRef, text: GUIDANCE });
    expect(r.outcome).toBe("resumed");
    await loop2.settle();
    expect(first.sim.workerCalls.length).toBe(workerCalls + 1);

    // Another restart, then the same Telegram message is redelivered: no second resume.
    const third = createHumanInteractionHarness({ loop: loop2, approvals: first.sim.approvals, audit, now: first.sim.ports.now, transport: createRecordingTransport(900), durableGateway: true, idPrefix: "boot3" });
    const dup = await third.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.71", replyToDeliveryRef: first.transport.sent[0].deliveryRef, text: GUIDANCE });
    expect(dup.outcome).toBe("duplicate");
    await loop2.settle();
    expect(third.emitted).toHaveLength(0);
    expect(first.sim.workerCalls.length).toBe(workerCalls + 1);
  });

  it("a pending commit/publish approval survives restart and is not re-notified", async () => {
    const audit = createInMemoryAuditRepository(() => "2026-10-05T00:00:00.000Z");
    let cp = 0;
    const sim = createSimulation({ autoApproveCommits: false, persistence: createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` }) });
    await sim.create(fakeIntake({ taskId: "rs2" }));
    const h1 = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now });
    await h1.service.observe();
    expect(h1.transport.sent).toHaveLength(1);

    sim.ports.leases.release(sim.ports.leases.current("ws-rs2"));
    const loop2 = createManagerLoop(sim.ports);
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("rs2")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    const h2 = createHumanInteractionHarness({ loop: loop2, approvals: sim.approvals, audit, now: sim.ports.now, transport: createRecordingTransport(600), idPrefix: "boot2" });
    expect(await h2.service.observe()).toEqual({ delivered: 0 });
    const ref = h1.transport.sent[0].notice.ref;
    expect((await h2.service.handleAction({ kind: "action", idempotencyKey: "k", ref, action: "approve" })).outcome).toBe("approved");
    await loop2.settle();
    expect(sim.commits).toHaveLength(1);
  });
});
