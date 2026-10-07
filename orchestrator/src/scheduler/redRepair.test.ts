import { describe, expect, it } from "vitest";
import { redStartBindingId } from "../workers/prompt";
import { createSimulation, driveQa, fakeIntake, type Simulation, type SimulationOptions, type WorkerScript } from "./fake";
import { createManagerLoop } from "./loop";
import { createMemoryCheckpointRepository } from "./persistence";

/**
 * Red-risk repairs (including a human-decision resume) wait for a FRESH
 * pre-execution approval bound to the new repair plan instead of blocking.
 */

const GUIDANCE = "The fixture expects UTC timestamps; normalize dates to UTC before comparing.";
const RED_ACTIONS = [{ kind: "code_edit" as const }, { kind: "prod_db_write" as const }];

async function grant(sim: Simulation, taskId: string, phase: "pre_execution" | "commit_publish" | "post_qa", overrides = {}) {
  sim.approve(taskId, phase, overrides);
  await sim.send({ type: "approval_granted", taskId, phase });
}

async function startRed(taskId: string, worker: WorkerScript[], opts: SimulationOptions = {}) {
  const sim = createSimulation({ worker: { [taskId]: worker }, autoApproveCommits: false, ...opts });
  await sim.create(fakeIntake({ taskId, actions: RED_ACTIONS }));
  expect(sim.loop.task(taskId)!).toMatchObject({ risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
  await grant(sim, taskId, "pre_execution");
  return sim;
}

const decision = (sim: Simulation, taskId: string, decisionId = "hd-1") => {
  const req = sim.loop.task(taskId)!.humanDecisionRequest!;
  return { decisionId, escalationId: req.escalationId, taskId, branch: req.branch, expectedHeadSha: req.expectedHeadSha, kind: "continue_with_guidance", guidance: GUIDANCE, decidedBy: "human-1" };
};

/** Red task -> two approved Manager-guided cycles -> needs_human_decision. */
async function redEscalated(taskId: string, worker: WorkerScript[], opts: SimulationOptions = {}) {
  const sim = await startRed(taskId, worker, opts);
  for (const cycle of [1, 2]) {
    const t = sim.loop.task(taskId)!;
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", state: "running" });
    expect(t.pendingRepair).toMatchObject({ round: 1, attempt: cycle });
    await grant(sim, taskId, "pre_execution");
  }
  expect(sim.loop.task(taskId)!.status).toBe("needs_human_decision");
  return sim;
}

describe("red-risk repair approval", () => {
  it("a red repair waits for its own pre-execution approval instead of blocking; history stays intact", async () => {
    const sim = await startRed("rr1", ["validation_failed", "success"]);
    const t = sim.loop.task("rr1")!;
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", state: "running", repair: { attempt: 0 } });
    expect(t.pendingRepair?.diagnosis).toMatchObject({ cycle: 1, failingCheck: "validation:tests" });
    expect(t.repairCycles).toEqual([]); // counted only when the repair actually starts
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.ports.leases.current("ws-rr1")).toMatchObject({ taskId: "rr1" });

    await grant(sim, "rr1", "pre_execution");
    const after = sim.loop.task("rr1")!;
    expect(after.pendingRepair).toBeNull();
    expect(after.repairCycles).toHaveLength(1);
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls[1]).toMatchObject({ repair: true, branch: sim.workerCalls[0].branch });
    // Accepted after repair: still needs the separate commit/publish approval.
    expect(after).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.commits).toEqual([]);
  });

  it("a resumed (human-decision) red repair enters awaiting pre-execution approval; a fresh approval resumes the same task", async () => {
    const sim = await redEscalated("rr2", ["validation_failed", "validation_failed", "validation_failed", "success"]);
    const branch = sim.loop.task("rr2")!.branch;
    await sim.send({ type: "human_decision_submitted", taskId: "rr2", decision: decision(sim, "rr2") });
    let t = sim.loop.task("rr2")!;
    expect(t.humanDecisionLog.at(-1)?.outcome).toBe("accepted");
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", humanRound: 2 });
    expect(t.pendingRepair).toMatchObject({ round: 2, attempt: 1 });
    expect(t.pendingRepair!.diagnosis.humanDecision?.decisionId).toBe("hd-1");
    expect(t.escalationHistory).toHaveLength(1);
    expect(sim.workerCalls).toHaveLength(3);

    // The gateway-visible requirement is bound to the NEW plan.
    const pending = await sim.loop.pendingApproval("rr2");
    expect(pending).toMatchObject({ phase: "pre_execution", kind: "start", bindingShaOrActionId: t.pendingRepair!.approvalBinding });

    await grant(sim, "rr2", "pre_execution");
    t = sim.loop.task("rr2")!;
    expect(sim.workerCalls).toHaveLength(4);
    expect(sim.workerCalls[3]).toMatchObject({ taskId: "rr2", branch, repair: true });
    expect(sim.workerCalls[3].objective).toContain("humanDecision hd-1");
    expect(t.repairCycles.at(-1)).toMatchObject({ round: 2, cycle: 1 });
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.commits).toEqual([]);

    await grant(sim, "rr2", "commit_publish");
    await driveQa(sim, "rr2");
    expect(sim.loop.task("rr2")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "post_qa" }); // red post-QA gate stays additive
  });

  it("old or stale approvals cannot authorize the new repair plan", async () => {
    const sim = await redEscalated("rr3", ["validation_failed", "validation_failed", "validation_failed", "success"]);
    const cycle2Binding = sim.approvals.listByTask("rr3").filter((a) => a.kind === "start").at(-1)!.bindingShaOrActionId;
    await sim.send({ type: "human_decision_submitted", taskId: "rr3", decision: decision(sim, "rr3") });
    const fresh = sim.loop.task("rr3")!.pendingRepair!.approvalBinding;
    expect(fresh).not.toBe(cycle2Binding);

    // Re-notify with only the old approvals on record.
    await sim.send({ type: "approval_granted", taskId: "rr3", phase: "pre_execution" });
    expect(sim.loop.task("rr3")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution" });
    // An approval explicitly bound to an earlier plan does not authorize either.
    await grant(sim, "rr3", "pre_execution", { bindingShaOrActionId: cycle2Binding });
    await grant(sim, "rr3", "pre_execution", { bindingShaOrActionId: redStartBindingId({ ...({} as never), taskId: "rr3", runId: "x", category: "bug_fix", actions: RED_ACTIONS, objective: "o", allowedScope: ["server/rr3/"], acceptanceCriteria: [], requiredValidations: ["tests"], branch: "agent/task-rr3-x" }) });
    expect(sim.loop.task("rr3")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(sim.workerCalls).toHaveLength(3);

    await grant(sim, "rr3", "pre_execution");
    expect(sim.workerCalls).toHaveLength(4);
  });

  it("rejection follows the existing approval model (blocked, no Worker run)", async () => {
    const sim = await redEscalated("rr4", ["validation_failed", "validation_failed", "validation_failed", "success"]);
    await sim.send({ type: "human_decision_submitted", taskId: "rr4", decision: decision(sim, "rr4") });
    sim.rejectApproval("rr4", "pre_execution");
    await sim.send({ type: "approval_rejected", taskId: "rr4", phase: "pre_execution" });
    const t = sim.loop.task("rr4")!;
    expect(t).toMatchObject({ status: "blocked", blockingReason: "pre_execution approval rejected" });
    expect(sim.workerCalls).toHaveLength(3);
    expect(sim.commits).toEqual([]);
    expect(t.escalationHistory).toHaveLength(1); // still auditable
    expect(t.humanDecisionLog.at(-1)?.outcome).toBe("accepted");
  });

  it("cancellation works while a red repair waits for approval", async () => {
    const sim = await startRed("rr5", ["validation_failed", "success"]);
    expect(sim.loop.cancel("rr5")).toMatchObject({ ok: true });
    expect(sim.loop.task("rr5")!).toMatchObject({ state: "cancelled", status: "blocked" });
    expect(sim.ports.leases.current("ws-rr5")).toBeNull();
  });
});

describe("restart preserves both human waiting states", () => {
  const restart = (sim: Simulation, workspaceId: string) => {
    const lease = sim.ports.leases.current(workspaceId);
    if (lease) sim.ports.leases.release(lease);
    return createManagerLoop(sim.ports);
  };

  it("waiting-for-human-decision and waiting-for-red-repair-approval both survive a restart and resume", async () => {
    const persistence = createMemoryCheckpointRepository();
    const sim = await redEscalated("rr6", ["validation_failed", "validation_failed", "validation_failed", "success"], { persistence });
    const escalated = sim.loop.task("rr6")!;

    const loop2 = restart(sim, "ws-rr6");
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("rr6")!).toMatchObject({ status: "needs_human_decision", humanDecisionRequest: escalated.humanDecisionRequest });
    loop2.post({ type: "human_decision_submitted", taskId: "rr6", decision: decision(sim, "rr6") });
    await loop2.settle();
    const parked = loop2.task("rr6")!;
    expect(parked).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution" });

    const loop3 = restart(sim, "ws-rr6");
    await loop3.resume();
    await loop3.settle();
    const restored = loop3.task("rr6")!;
    expect(restored).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", humanRound: 2 });
    expect(restored.pendingRepair).toEqual(parked.pendingRepair);
    expect(restored.escalationHistory).toEqual(parked.escalationHistory);
    expect(sim.workerCalls).toHaveLength(3);

    sim.approvals.create({ id: "ap-fresh", taskId: "rr6", kind: "start", requestedAction: "start", bindingShaOrActionId: restored.pendingRepair!.approvalBinding, expiresAt: "2026-10-05T12:00:00.000Z" });
    sim.approvals.decide("ap-fresh", { status: "approved", decidedBy: "human-1", channel: "test" });
    loop3.post({ type: "approval_granted", taskId: "rr6", phase: "pre_execution" });
    await loop3.settle();
    expect(sim.workerCalls).toHaveLength(4);
    expect(loop3.task("rr6")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
  });
});

describe("red-risk transient retry approval", () => {
  it("unchanged binding: the existing approval still authorizes the retry (no new wait)", async () => {
    const sim = await startRed("rt1", ["timeout", "success"]);
    const t = sim.loop.task("rt1")!;
    expect(sim.workerCalls).toHaveLength(2);
    expect(t.budget.infrastructureRetries).toBe(1);
    expect(t.pendingRetry).toBeNull();
    expect(t.repairCycles).toEqual([]);
    expect(sim.approvals.listByTask("rt1").filter((a) => a.kind === "start")).toHaveLength(1);
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" }); // commit gate unchanged
  });

  it("changed binding: waits for a fresh pre-execution approval instead of blocking; stale approvals never authorize it", async () => {
    const sim = await startRed("rt2", ["timeout_dirty", "success"]);
    const initialBinding = sim.approvals.listByTask("rt2").find((a) => a.kind === "start")!.bindingShaOrActionId;
    let t = sim.loop.task("rt2")!;
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", state: "running", risk: "red", repair: { attempt: 0 } });
    expect(t.pendingRetry).toMatchObject({ errorType: "timeout" });
    expect(t.pendingRetry!.approvalBinding).not.toBe(initialBinding);
    expect(t.repairCycles).toEqual([]); // not a Manager-guided repair cycle
    expect(t.budget.infrastructureRetries).toBe(0);
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.ports.leases.current("ws-rt2")).toMatchObject({ taskId: "rt2" });
    expect(await sim.loop.pendingApproval("rt2")).toMatchObject({ phase: "pre_execution", bindingShaOrActionId: t.pendingRetry!.approvalBinding });

    await sim.send({ type: "approval_granted", taskId: "rt2", phase: "pre_execution" }); // only the old approval exists
    await grant(sim, "rt2", "pre_execution", { bindingShaOrActionId: initialBinding });
    expect(sim.loop.task("rt2")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(sim.workerCalls).toHaveLength(1);

    await grant(sim, "rt2", "pre_execution");
    t = sim.loop.task("rt2")!;
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls[1]).toMatchObject({ taskId: "rt2", branch: sim.workerCalls[0].branch, repair: false });
    expect(sim.workerCalls[1].allowedDirtyPaths).toEqual(["server/rt2/index.ts"]);
    expect(t).toMatchObject({ pendingRetry: null, repair: { attempt: 0 }, status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(t.budget.infrastructureRetries).toBe(1);
    expect(t.escalations.map((e) => e.action)).toContain("retry_infrastructure");
    expect(sim.commits).toEqual([]);
  });

  it("a retry inside a repair cycle with an unchanged binding continues under the approved repair; the cycle count does not move", async () => {
    const sim = await startRed("rt3", ["validation_failed", "timeout_dirty", "success"]);
    await grant(sim, "rt3", "pre_execution"); // approve repair #1 (it already allows the task-owned dirty path)
    const t = sim.loop.task("rt3")!;
    expect(t.pendingRetry).toBeNull();
    expect(t.repair.attempt).toBe(1);
    expect(t.repairCycles).toHaveLength(1);
    expect(t.budget.infrastructureRetries).toBe(1);
    expect(sim.workerCalls).toHaveLength(3);
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
  });

  it("rejection follows the normal approval behavior", async () => {
    const sim = await startRed("rt4", ["timeout_dirty", "success"]);
    sim.rejectApproval("rt4", "pre_execution");
    await sim.send({ type: "approval_rejected", taskId: "rt4", phase: "pre_execution" });
    expect(sim.loop.task("rt4")!).toMatchObject({ status: "blocked", blockingReason: "pre_execution approval rejected" });
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("checkpoint/restart preserves the waiting retry approval and the fresh approval resumes it", async () => {
    const persistence = createMemoryCheckpointRepository();
    const sim = await startRed("rt5", ["timeout_dirty", "success"], { persistence });
    const waiting = sim.loop.task("rt5")!;
    const lease = sim.ports.leases.current("ws-rt5");
    if (lease) sim.ports.leases.release(lease);
    const loop2 = createManagerLoop(sim.ports);
    await loop2.resume();
    await loop2.settle();
    const restored = loop2.task("rt5")!;
    expect(restored).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", pendingRetry: waiting.pendingRetry });
    expect(sim.workerCalls).toHaveLength(1);
    sim.approvals.create({ id: "ap-rt5", taskId: "rt5", kind: "start", requestedAction: "start", bindingShaOrActionId: restored.pendingRetry!.approvalBinding, expiresAt: "2026-10-05T12:00:00.000Z" });
    sim.approvals.decide("ap-rt5", { status: "approved", decidedBy: "human-1", channel: "test" });
    loop2.post({ type: "approval_granted", taskId: "rt5", phase: "pre_execution" });
    await loop2.settle();
    expect(sim.workerCalls).toHaveLength(2);
    expect(loop2.task("rt5")!).toMatchObject({ pendingRetry: null, status: "needs_human_approval", approvalPhase: "commit_publish" });
  });
});
