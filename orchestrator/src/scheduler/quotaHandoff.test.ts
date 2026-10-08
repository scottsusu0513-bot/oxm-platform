import { describe, expect, it } from "vitest";
import { createSimulation, fakeIntake, type WorkerScript } from "./fake";

/**
 * Fixed OXM Worker availability policy in the Manager Loop:
 *  - Claude programming task + Claude quota exhausted -> Codex continues the SAME task
 *    (same branch, checkpoint HEAD, lineage, progress) from a structured handoff;
 *  - Claude available again -> handed back at the next safe boundary (next run);
 *  - Codex visual task + Codex quota exhausted -> pause; never Claude;
 *  - both unavailable -> pause; resume when an eligible Worker is available;
 *  - quota never consumes a Manager-guided repair cycle or an infrastructure retry.
 */

const codeTask = (taskId: string) => fakeIntake({ taskId, category: "backend" });
const visualTask = (taskId: string) => fakeIntake({ taskId, category: "css", actions: [{ kind: "ui_edit" }, { kind: "run_tests" }] });
const sim = (taskId: string, scripts: WorkerScript[], extra: Parameters<typeof createSimulation>[0] = {}) => createSimulation({ worker: { [taskId]: scripts }, ...extra });
const events = (s: ReturnType<typeof createSimulation>, taskId: string) => s.audit.filter((e) => e.taskId === taskId).map((e) => e.event);

describe("Claude quota on a programming task -> temporary Codex takeover of the SAME task", () => {
  it("continues on Codex from the same branch/checkpoint with a structured handoff; no repair cycle, no restart", async () => {
    const s = sim("q1", ["quota_exhausted_dirty", "success"]);
    await s.create(codeTask("q1"));
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
    const [first, second] = s.workerCalls;
    // Same task, branch and checkpoint; the interrupted run's progress is inherited, not discarded.
    expect(second.taskId).toBe("q1");
    expect(second.branch).toBe(first.branch);
    expect(second.expectedHeadSha).toBe(first.expectedHeadSha);
    expect(second.allowedDirtyPaths).toContain("server/q1/index.ts");
    expect(second.repair).toBe(false);
    expect(second.objective).toContain("WORKER HANDOFF (claude_quota_exhausted): claude -> codex");
    expect(second.objective).toContain("do not restart from scratch");
    expect(second.objective).toContain("Uncommitted task-owned changes already on the branch: 1 path(s).");
    expect(second.objective.startsWith("Implement task q1.")).toBe(true);
    const snap = s.loop.task("q1")!;
    expect(snap).toMatchObject({ worker: "codex", workArea: "programming", primaryWorker: "claude", temporaryCover: true });
    expect(snap.repair.attempt).toBe(0);
    expect(snap.repairCycles).toHaveLength(0);
    expect(snap.budget.infrastructureRetries).toBe(0);
    expect(snap.handoffs).toHaveLength(1);
    expect(snap.handoffs[0]).toMatchObject({ from: "claude", to: "codex", reason: "claude_quota_exhausted", taskId: "q1", branch: first.branch, checkpointHeadSha: first.expectedHeadSha, restartFromScratch: false });
    expect(snap.handoffs[0].filesInvolved).toEqual(["server/q1/index.ts"]);
    expect(snap.handoffs[0].acceptanceCriteria).toEqual(["Behaviour is covered by tests"]);
    expect(events(s, "q1")).toEqual(expect.arrayContaining(["worker_quota_exhausted", "worker_handoff", "worker_availability_resumed"]));
    // The Manager still owns acceptance; the task proceeds to the normal commit/publish gate.
    expect(snap.approvalPhase === "commit_publish" || snap.status === "qa_pending" || snap.status === "accepted").toBe(true);
  });

  it("hands back to Claude at the next safe boundary once Claude is available, and verifies against the SAME criteria", async () => {
    const s = sim("q2", ["quota_exhausted", "validation_failed", "success"], { holdWorkers: true });
    await s.create(codeTask("q2"));
    s.releaseWorker("q2");
    await s.loop.settle();
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
    // Claude's quota resets while Codex is mid-run: nothing switches mid-run.
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    expect(s.workerCalls).toHaveLength(2);
    expect(s.loop.task("q2")!.worker).toBe("codex");
    s.releaseWorker("q2");
    await s.loop.settle();
    // The Codex run needed a repair: the repair run (safe boundary) goes back to Claude.
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex", "claude"]);
    const back = s.workerCalls[2];
    expect(back.repair).toBe(true);
    expect(back.branch).toBe(s.workerCalls[0].branch);
    expect(back.objective).toContain("WORKER HANDOFF (claude_available_again): codex -> claude");
    expect(back.objective).toContain("Manager diagnosis #1");
    const snap = s.loop.task("q2")!;
    expect(snap).toMatchObject({ worker: "claude", temporaryCover: false });
    expect(snap.handoffs.map((h) => `${h.from}->${h.to}`)).toEqual(["claude->codex", "codex->claude"]);
    // Exactly one Manager-guided cycle (the validation failure); the quota consumed none.
    expect(snap.repair.attempt).toBe(1);
    expect(events(s, "q2")).toContain("worker_handback");
    s.releaseWorker("q2");
    await s.loop.settle();
  });
});

describe("Codex quota on site-visual work -> pause; never Claude", () => {
  it("pauses the same task with the trusted reset time and resumes on Codex only", async () => {
    const s = sim("v1", ["quota_exhausted_reset", "success"]);
    await s.create(visualTask("v1"));
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["codex"]);
    let snap = s.loop.task("v1")!;
    expect(snap.status).toBe("waiting_worker_quota");
    expect(snap.workArea).toBe("visual");
    expect(snap.availabilityPause).toMatchObject({ waitingFor: ["codex"], resetAt: "2026-10-07T18:00:00.000Z", exhausted: "codex" });
    expect(snap.repair.attempt).toBe(0);
    // Claude being available changes nothing for visual work.
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    await s.send({ type: "availability_check" });
    expect(s.workerCalls).toHaveLength(1);
    expect(s.loop.task("v1")!.status).toBe("waiting_worker_quota");
    // Codex back: the SAME task resumes on Codex from the same checkpoint.
    await s.send({ type: "worker_availability_changed", worker: "codex", status: "available" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["codex", "codex"]);
    expect(s.workerCalls[1]).toMatchObject({ taskId: "v1", branch: s.workerCalls[0].branch, expectedHeadSha: s.workerCalls[0].expectedHeadSha });
    snap = s.loop.task("v1")!;
    expect(snap.availabilityPause).toBeNull();
    expect(snap.handoffs).toHaveLength(0);
    expect(s.workerCalls.some((c) => c.kind === "claude")).toBe(false);
  });

  it("reports that the reset time cannot be determined instead of inventing one", async () => {
    const s = sim("v2", ["quota_exhausted"]);
    await s.create(visualTask("v2"));
    const snap = s.loop.task("v2")!;
    expect(snap.availabilityPause).toMatchObject({ waitingFor: ["codex"], resetAt: null });
    expect(snap.queueReason).toContain("exact reset time cannot be determined");
  });

  it("an elapsed trusted reset time lets the external availability check resume the same task", async () => {
    const s = sim("v3", ["quota_exhausted_elapsed", "success"]);
    await s.create(visualTask("v3"));
    expect(s.loop.task("v3")!.status).toBe("waiting_worker_quota");
    await s.send({ type: "availability_check" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["codex", "codex"]);
  });
});

describe("both Workers unavailable", () => {
  it("pauses with state preserved, never bypasses policy, and resumes on the first eligible Worker", async () => {
    const s = sim("b1", ["quota_exhausted", "quota_exhausted_dirty", "success"]);
    await s.create(codeTask("b1"));
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
    let snap = s.loop.task("b1")!;
    expect(snap.status).toBe("waiting_worker_quota");
    expect(snap.availabilityPause).toMatchObject({ waitingFor: ["claude", "codex"], exhausted: "codex" });
    expect(snap.repair.attempt).toBe(0);
    expect(snap.blockingReason).toBeNull();
    // Claude returns first: the programming task resumes on Claude from Codex's progress.
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex", "claude"]);
    const resumed = s.workerCalls[2];
    expect(resumed.branch).toBe(s.workerCalls[0].branch);
    expect(resumed.allowedDirtyPaths).toContain("server/b1/index.ts");
    expect(resumed.objective).toContain("WORKER HANDOFF (claude_available_again): codex -> claude");
    snap = s.loop.task("b1")!;
    expect(snap.repair.attempt).toBe(0);
    expect(snap.repairCycles).toHaveLength(0);
  });

  it("a non-quota Claude outage is not a takeover reason: routing waits for Claude", async () => {
    const s = createSimulation();
    await s.create(fakeIntake({ taskId: "b2", category: "backend", availability: { claude: "unavailable", codex: "available" } }));
    expect(s.workerCalls).toHaveLength(0);
    expect(s.loop.task("b2")!.worker).toBeNull();
  });

  it("automatic re-probes are bounded, but exhausting them pauses (never fails) and an explicit signal still resumes", async () => {
    const s = sim("b3", ["quota_exhausted"], { policy: { maxAvailabilityContinuations: 1 } });
    await s.create(codeTask("b3"));
    // Claude quota -> Codex takeover (continuation 1) -> Codex quota -> pause on both.
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
    // An explicit trusted signal is not an automatic probe: Claude resumes the same task.
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex", "claude"]);
    const snap = s.loop.task("b3")!;
    expect(snap.status).toBe("waiting_worker_quota");
    expect(snap.blockingReason).toBeNull();
    expect(snap.repair.attempt).toBe(0);
  });
});

describe("red-risk continuation keeps its own approval", () => {
  it("a quota takeover of a red task needs a fresh pre-execution approval of the handoff contract", async () => {
    const s = sim("r1", ["quota_exhausted", "success"]);
    await s.create(fakeIntake({ taskId: "r1", category: "backend", actions: [{ kind: "code_edit" }, { kind: "prod_db_write" }] }));
    expect(s.loop.task("r1")!.approvalPhase).toBe("pre_execution");
    s.approve("r1", "pre_execution");
    await s.send({ type: "approval_granted", taskId: "r1", phase: "pre_execution" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude"]);
    const snap = s.loop.task("r1")!;
    // The handoff contract differs from the approved one: no reuse of the old approval.
    expect(snap).toMatchObject({ status: "needs_human_approval", approvalPhase: "pre_execution", worker: "codex" });
    expect(snap.pendingRetry?.errorType).toBe("worker_continuation");
    s.approve("r1", "pre_execution", { bindingShaOrActionId: snap.pendingRetry!.approvalBinding });
    await s.send({ type: "approval_granted", taskId: "r1", phase: "pre_execution" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
  });
});

describe("availability probing without a trusted reset time", () => {
  it("re-probes only after the bounded interval; a renewed quota error just pauses again", async () => {
    const s = sim("p1", ["quota_exhausted", "quota_exhausted", "success"]);
    await s.create(visualTask("p1"));
    expect(s.loop.task("p1")!.availabilityPause).toMatchObject({ resetAt: null, since: "2026-10-04T12:00:00.000Z" });
    // The simulation clock is fixed: an interval that has not elapsed changes nothing.
    await s.send({ type: "availability_check", probeAfterMs: 60 * 60_000 });
    expect(s.workerCalls).toHaveLength(1);
    // A probe below the 1-minute floor is ignored (no hot retry loop).
    await s.send({ type: "availability_check", probeAfterMs: 0 });
    expect(s.workerCalls).toHaveLength(1);
    expect(s.loop.task("p1")!.status).toBe("waiting_worker_quota");
  });
});
