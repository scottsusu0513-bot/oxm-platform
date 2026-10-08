import { describe, expect, it } from "vitest";
import { checkHumanDecisionBinding, humanDecisionResumeStep, normalizeHumanDecision } from "../manager/humanDecision";
import type { HumanDecisionRequest } from "../manager/types";
import { createSimulation, driveQa, fakeIntake, type Simulation, type SimulationOptions, type WorkerScript } from "./fake";
import { createManagerLoop } from "./loop";
import { createMemoryCheckpointRepository } from "./persistence";

/**
 * needs_human_decision resume path: a bound human decision is consumed by the
 * Manager as evidence, which issues a fresh repair plan for the SAME task,
 * branch and worker. A decision is never an approval.
 */

const GUIDANCE = "The fixture expects UTC timestamps; normalize dates to UTC before comparing.";
const FAIL3: WorkerScript[] = ["validation_failed", "validation_failed", "validation_failed"];

const events = (sim: Simulation, taskId: string) => sim.audit.filter((e) => e.taskId === taskId).map((e) => e.event);
const gitWrites = (sim: Simulation) => sim.remote.calls.filter((c) => c.startsWith("PUSH") || c.startsWith("CREATE pr") || /merge|deploy|DELETE|force/i.test(c));

function decisionFor(req: HumanDecisionRequest, over: Record<string, unknown> = {}) {
  return {
    decisionId: "hd-1",
    escalationId: req.escalationId,
    taskId: req.taskId,
    branch: req.branch,
    expectedHeadSha: req.expectedHeadSha,
    kind: "continue_with_guidance",
    guidance: GUIDANCE,
    decidedBy: "human-1",
    ...over,
  };
}

async function escalated(taskId: string, worker: WorkerScript[], opts: SimulationOptions = {}) {
  const sim = createSimulation({ worker: { [taskId]: worker }, autoApproveCommits: false, ...opts });
  await sim.create(fakeIntake({ taskId }));
  const t = sim.loop.task(taskId)!;
  expect(t.status).toBe("needs_human_decision");
  return { sim, request: t.humanDecisionRequest! };
}

const submit = (sim: Simulation, taskId: string, decision: unknown) => sim.send({ type: "human_decision_submitted", taskId, decision });

describe("human decision — escalation request", () => {
  it("escalation after two Manager-guided cycles opens a bound, resumable request and keeps the workspace", async () => {
    const { sim, request } = await escalated("hd1", FAIL3);
    const t = sim.loop.task("hd1")!;
    expect(request).toMatchObject({ kind: "human_decision_request", escalationId: "hd1.hd.1", taskId: "hd1", branch: t.branch, round: 1, cyclesCompleted: 2 });
    expect(request.expectedHeadSha).toMatch(/^[0-9a-f]{40}$/);
    expect(t.humanEscalation?.decisionRequest).toEqual(request);
    expect(t.escalationHistory).toHaveLength(1);
    expect(sim.ports.leases.current("ws-hd1")).toMatchObject({ taskId: "hd1" });
    expect(sim.workerCalls).toHaveLength(3);
  });
});

describe("human decision — resume", () => {
  it("a valid decision resumes the SAME task; Manager consumes it as evidence and issues a fresh plan; the Worker runs again", async () => {
    const { sim, request } = await escalated("hd2", [...FAIL3, "success"]);
    const before = sim.loop.task("hd2")!;
    const round1 = structuredClone(before.repairCycles);
    const report1 = structuredClone(before.escalationHistory[0]);

    await submit(sim, "hd2", decisionFor(request));
    const t = sim.loop.task("hd2")!;
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ decisionId: "hd-1", escalationId: "hd2.hd.1", outcome: "accepted" });
    expect(sim.loop.tasks().map((x) => x.taskId)).toEqual(["hd2"]); // no new task
    expect(t.humanRound).toBe(2);
    expect(t.humanDecisionRequest).toBeNull();

    // Manager evidence + fresh plan
    const resumed = t.repairCycles.at(-1)!;
    expect(resumed).toMatchObject({ round: 2, cycle: 1 });
    const d = resumed.diagnosis;
    expect(d).toMatchObject({ round: 2, cycle: 1, failingCheck: "validation:tests" });
    expect(d.humanDecision).toMatchObject({ decisionId: "hd-1", escalationId: "hd2.hd.1", round: 2, guidance: GUIDANCE, decidedBy: "human-1" });
    expect(d.evidenceUsed).toEqual(expect.arrayContaining(["human:hd-1", "diagnosis:1.2"]));
    expect(d.previous).toMatchObject({ cycle: 2, previousFingerprint: round1[1].diagnosis.fingerprint });
    expect(d.rootCause).toContain("Human decision hd-1");
    expect(d.requiredFix).toContain("Apply the human decision");
    expect(round1.every((c) => c.diagnosis.humanDecision === null)).toBe(true);
    expect(events(sim, "hd2")).toEqual(expect.arrayContaining(["manager_human_decision_consumed", "human_decision_accepted"]));

    // Same branch / worker / expected head; the Worker gets the human response inside the repair contract.
    expect(sim.workerCalls).toHaveLength(4);
    const run = sim.workerCalls[3];
    expect(run).toMatchObject({ taskId: "hd2", branch: before.branch, kind: sim.workerCalls[0].kind, expectedHeadSha: request.expectedHeadSha, repair: true });
    expect(run.objective).toContain("round 2");
    expect(run.objective).toContain(`humanDecision hd-1 (continue_with_guidance): ${GUIDANCE}`);
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE ref"))).toHaveLength(1);

    // History preserved: original failure, both diagnoses, both outcomes, the escalation report.
    expect(t.repairCycles.slice(0, 2)).toEqual(round1);
    expect(t.escalationHistory).toEqual([report1]);
    expect(report1.originalFailure?.failingCheck).toBe("validation:tests");
    expect(report1.diagnoses.map((x) => x.cycle)).toEqual([1, 2]);
    expect(report1.repairOutcomes).toHaveLength(2);
  });

  it("a successful resumed task reaches normal Manager acceptance but still waits for the separate commit/publish approval", async () => {
    const { sim, request } = await escalated("hd3", [...FAIL3, "success"]);
    await submit(sim, "hd3", decisionFor(request));
    let t = sim.loop.task("hd3")!;
    expect(t.repairCycles.at(-1)?.revalidation?.decision).toBe("accepted");
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    // The human decision approved nothing.
    expect(sim.approvals.listByTask("hd3")).toEqual([]);
    expect(sim.commits).toEqual([]);
    expect(gitWrites(sim)).toEqual([]);

    sim.approve("hd3", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "hd3", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    await driveQa(sim, "hd3");
    t = sim.loop.task("hd3")!;
    expect(t).toMatchObject({ status: "accepted", state: "complete" });
    expect(sim.remote.calls.filter((c) => /merge|deploy|DELETE|force/i.test(c))).toEqual([]);
    expect(sim.remote.refs.get("main")).toBeDefined();
  });

  it("a resumed round that fails again escalates with a NEW request; the old one is stale", async () => {
    const { sim, request } = await escalated("hd4", ["validation_failed"]);
    await submit(sim, "hd4", decisionFor(request));
    const t = sim.loop.task("hd4")!;
    expect(t.status).toBe("needs_human_decision");
    expect(t.humanDecisionRequest).toMatchObject({ escalationId: "hd4.hd.2", round: 2, cyclesCompleted: 2 });
    expect(t.escalationHistory.map((r) => r.decisionRequest.escalationId)).toEqual(["hd4.hd.1", "hd4.hd.2"]);
    expect(t.escalationHistory[1].diagnoses[0].humanDecision?.decisionId).toBe("hd-1");
    expect(sim.workerCalls).toHaveLength(5); // 1 + 2 cycles + 2 cycles of the resumed round

    // Replay of the round-1 escalation with a new id is stale.
    await submit(sim, "hd4", decisionFor(request, { decisionId: "hd-replay" }));
    expect(sim.loop.task("hd4")!.humanDecisionLog.at(-1)).toMatchObject({ decisionId: "hd-replay", outcome: "rejected", reason: "human decision is for a stale or unknown escalation" });
    expect(sim.workerCalls).toHaveLength(5);
  });
});

describe("human decision — rejection and idempotency", () => {
  it.each([
    ["wrong task", { taskId: "other-task" }, "human decision belongs to another task"],
    ["wrong branch", { branch: "agent/task-other-fix" }, "human decision branch does not match the task branch"],
    ["stale HEAD", { expectedHeadSha: "e".repeat(40) }, "human decision HEAD does not match the escalated workspace"],
    ["unknown escalation", { escalationId: "hd5.hd.9" }, "human decision is for a stale or unknown escalation"],
  ])("%s is rejected and changes nothing", async (_label, over, reason) => {
    const { sim, request } = await escalated("hd5", FAIL3);
    await submit(sim, "hd5", decisionFor(request, over));
    const t = sim.loop.task("hd5")!;
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason });
    expect(t).toMatchObject({ status: "needs_human_decision", humanRound: 1 });
    expect(t.humanDecisionRequest).toEqual(request);
    expect(sim.workerCalls).toHaveLength(3);
    // A rejected decision is not consumed: the correct one still resumes.
    await submit(sim, "hd5", decisionFor(request));
    expect(sim.loop.task("hd5")!.humanRound).toBe(2);
  });

  it("a decision for a task that is not awaiting a human decision is rejected", async () => {
    const sim = createSimulation({ autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "hd6" }));
    const t = sim.loop.task("hd6")!;
    await submit(sim, "hd6", { decisionId: "hd-x", escalationId: "hd6.hd.1", taskId: "hd6", branch: t.branch, expectedHeadSha: "a".repeat(40), kind: "continue_with_guidance", guidance: GUIDANCE, decidedBy: "human-1" });
    expect(sim.loop.task("hd6")!.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason: "task is needs_human_approval, not awaiting a human decision" });
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("duplicate delivery is idempotent (sequential and in the same drain)", async () => {
    const { sim, request } = await escalated("hd7", [...FAIL3, "validation_failed", "success"]);
    sim.loop.post({ type: "human_decision_submitted", taskId: "hd7", decision: decisionFor(request) });
    sim.loop.post({ type: "human_decision_submitted", taskId: "hd7", decision: decisionFor(request) });
    await sim.loop.settle();
    await submit(sim, "hd7", decisionFor(request));
    const t = sim.loop.task("hd7")!;
    expect(t.humanDecisionLog.map((x) => x.outcome)).toEqual(["accepted", "duplicate", "duplicate"]);
    expect(t.humanRound).toBe(2);
    expect(t.repairCycles.filter((c) => c.round === 2).map((c) => c.cycle)).toEqual([1, 2]); // one resume only
    expect(sim.workerCalls).toHaveLength(5);
  });

  it("a decision cannot carry or imply commit/push/merge/deploy authorization", async () => {
    const { sim, request } = await escalated("hd8", [...FAIL3, "success"]);
    for (const extra of [{ approveCommit: true }, { publish: true }, { merge: true }, { deploy: true }, { approval: "approved" }]) {
      await submit(sim, "hd8", decisionFor(request, { decisionId: `hd-${Object.keys(extra)[0]}`, ...extra }));
      expect(sim.loop.task("hd8")!.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("unsupported fields") });
    }
    await submit(sim, "hd8", decisionFor(request, { kind: "approve_commit", decisionId: "hd-kind" }));
    expect(sim.loop.task("hd8")!.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason: "human decision kind is not supported" });
    expect(sim.workerCalls).toHaveLength(3);

    await submit(sim, "hd8", decisionFor(request));
    expect(sim.loop.task("hd8")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.approvals.listByTask("hd8")).toEqual([]);
    expect(sim.commits).toEqual([]);
    expect(gitWrites(sim)).toEqual([]);
  });

  it("credential-looking guidance is refused", () => {
    const req = { kind: "human_decision_request", escalationId: "t.hd.1", taskId: "t", lineageId: "t", branch: "agent/task-t-x", expectedHeadSha: "a".repeat(40), round: 1, cyclesCompleted: 2, fingerprint: "" } as const;
    const n = normalizeHumanDecision(decisionFor(req, { guidance: "use token ghp_0123456789abcdefghijABCDEFGHIJ0123456789" }));
    expect(n.ok).toBe(false);
    const ok = normalizeHumanDecision(decisionFor(req));
    expect(ok.ok && checkHumanDecisionBinding(req, ok.decision).ok).toBe(true);
  });
});

describe("human decision — cancel and restart", () => {
  it("cancellation from needs_human_decision still works and closes the escalation", async () => {
    const { sim, request } = await escalated("hd9", FAIL3);
    expect(sim.loop.cancel("hd9")).toMatchObject({ ok: true });
    const t = sim.loop.task("hd9")!;
    expect(t).toMatchObject({ state: "cancelled", status: "blocked" });
    expect(sim.ports.leases.current("ws-hd9")).toBeNull();
    await submit(sim, "hd9", decisionFor(request));
    expect(sim.loop.task("hd9")!.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected" });
    expect(sim.workerCalls).toHaveLength(3);
  });

  it("checkpoint/restart preserves the resumable escalation, and the decision resumes it after restart", async () => {
    const persistence = createMemoryCheckpointRepository();
    const { sim, request } = await escalated("hd10", [...FAIL3, "success"], { persistence });
    const before = sim.loop.task("hd10")!;

    // Process restart: the old loop is gone and its in-memory lease with it.
    sim.ports.leases.release(sim.ports.leases.current("ws-hd10")!);
    const loop2 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await loop2.resume();
    await loop2.settle();
    const restored = loop2.task("hd10")!;
    expect(restored).toMatchObject({ status: "needs_human_decision", humanRound: 1 });
    expect(restored.humanDecisionRequest).toEqual(request);
    expect(restored.humanEscalation).toEqual(before.humanEscalation);
    expect(restored.escalationHistory).toEqual(before.escalationHistory);
    expect(restored.repairCycles).toEqual(before.repairCycles);
    expect(sim.ports.leases.current("ws-hd10")).toMatchObject({ taskId: "hd10" });
    expect(sim.workerCalls).toHaveLength(3); // restart did not re-run anything

    loop2.post({ type: "human_decision_submitted", taskId: "hd10", decision: decisionFor(request) });
    await loop2.settle();
    expect(loop2.task("hd10")!).toMatchObject({ humanRound: 2, status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.workerCalls).toHaveLength(4);

    // Consumed ids survive a restart too: a replay after another restart is a duplicate.
    sim.ports.leases.release(sim.ports.leases.current("ws-hd10")!);
    const loop3 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await loop3.resume();
    loop3.post({ type: "human_decision_submitted", taskId: "hd10", decision: decisionFor(request) });
    await loop3.settle();
    expect(loop3.task("hd10")!.humanDecisionLog.at(-1)).toMatchObject({ outcome: "duplicate" });
    expect(sim.workerCalls).toHaveLength(4);
  });
});

describe("human decision — pure Manager resume step", () => {
  it("refuses evidence that is not at the escalated head or not reset for the new round", async () => {
    const { sim, request } = await escalated("hd11", FAIL3);
    const t = sim.loop.task("hd11")!;
    const last = t.repairCycles.at(-1)!;
    const n = normalizeHumanDecision(decisionFor(request));
    if (!n.ok) throw new Error(n.reason);
    const { fakeEvidence } = await import("../manager/fake");
    const base = fakeEvidence({
      taskId: "hd11",
      lineageId: "hd11",
      branch: { ...fakeEvidence().branch, assignedBranch: request.branch, workerBranch: request.branch, verifiedHeadSha: request.expectedHeadSha, workerHeadSha: request.expectedHeadSha },
      validations: [
        { name: "tests", requested: true, executed: true, status: "failed", trusted: true },
        { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
      ],
    });
    const previous = { diagnosis: last.diagnosis, repairOutcome: "r" };
    expect(humanDecisionResumeStep({ evidence: base, request, decision: n.decision, previous }).ok).toBe(true);
    expect(humanDecisionResumeStep({ evidence: { ...base, branch: { ...base.branch, verifiedHeadSha: "e".repeat(40), workerHeadSha: "e".repeat(40) } }, request, decision: n.decision, previous })).toMatchObject({ ok: false, reason: "workspace head moved since the escalation" });
    expect(humanDecisionResumeStep({ evidence: { ...base, repair: { attempt: 2, prior: [] } }, request, decision: n.decision, previous })).toMatchObject({ ok: false });
    expect(humanDecisionResumeStep({ evidence: { ...base, validations: base.validations.map((v) => ({ ...v, status: "passed" as const })) }, request, decision: n.decision, previous })).toMatchObject({ ok: false, reason: "evidence is accepted, not repairable" });
  });
});
