import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { MilestoneNotice } from "../humanInteraction/types";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "../planning/types";
import { createInMemoryAuditRepository } from "../store/memory";
import { createSimulation } from "./fake";
import { createManagerLoop } from "./loop";
import { createAuditCheckpointRepository } from "./persistence";

const MSG = "幫我把搜尋 loading 做順一點";
const planner: IntentPlanner = {
  async interpret() {
    return { intent: "change_code", taskId: null, title: "loading", interpretedObjective: "Make the search waiting state responsive.", criteria: ["Waiting state gives visible feedback immediately"], clarificationQuestion: "", riskObservations: [] };
  },
};

type Step = "outage" | "fail" | "ok";
function scriptedReviewer(steps: Step[]): GoalReviewer & { calls: GoalReviewInput[] } {
  const calls: GoalReviewInput[] = [];
  return {
    calls,
    async review(input) {
      calls.push(input);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step === "outage") throw new Error("503 overloaded");
      return { criteria: input.criteria.map((c) => ({ id: c.id, status: step === "ok" ? "satisfied" : "not_satisfied", evidence: step === "ok" ? "diff" : "", reason: step === "ok" ? "" : "missing" })) };
    },
  };
}

async function start(reviewer: GoalReviewer, persistence = false) {
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  let cp = 0;
  const sim = createSimulation({ autoApproveCommits: false, goalReviewer: reviewer, ...(persistence ? { persistence: createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` }) } : {}) });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "o" });
  await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${MSG}` });
  await sim.loop.settle();
  return { sim, audit, ...h };
}

describe("goal-reviewer outage never consumes a Manager-guided repair cycle", () => {
  it("an outage on the first run waits (typed infrastructure state); a retry judges the SAME run without re-running the Worker", async () => {
    const r = scriptedReviewer(["outage", "ok"]);
    const { sim } = await start(r);
    const t = sim.loop.task("o-task-1")!;
    expect(t).toMatchObject({ status: "waiting_infrastructure", pendingReview: true, repair: { attempt: 0 } });
    expect(t.repairCycles).toEqual([]);
    expect(t.queueReason).toMatch(/goal reviewer unavailable \(infrastructure\).*No Manager repair cycle consumed/);
    expect(sim.workerCalls).toHaveLength(1);
    await sim.send({ type: "review_retry", taskId: "o-task-1" });
    expect(sim.loop.task("o-task-1")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish", pendingReview: false, repair: { attempt: 0 } });
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("an outage after a real repair leaves the cycle count exactly where the real repair put it", async () => {
    const r = scriptedReviewer(["fail", "outage", "outage", "ok"]);
    const { sim } = await start(r);
    const waiting = sim.loop.task("o-task-1")!;
    expect(waiting).toMatchObject({ status: "waiting_infrastructure", repair: { attempt: 1 } });
    expect(waiting.repairCycles).toHaveLength(1);
    await sim.send({ type: "review_retry", taskId: "o-task-1" });
    expect(sim.loop.task("o-task-1")).toMatchObject({ status: "waiting_infrastructure", repair: { attempt: 1 }, reviewRetries: 1 });
    await sim.send({ type: "review_retry", taskId: "o-task-1" });
    const done = sim.loop.task("o-task-1")!;
    expect(done).toMatchObject({ status: "needs_human_approval", repair: { attempt: 1 } });
    expect(done.repairCycles).toHaveLength(1);
    expect(sim.workerCalls).toHaveLength(2); // initial + one real repair; no run for outages
  });

  it("exhausted review retries surface a clear waiting state, never a goal failure or a human decision", async () => {
    const r = scriptedReviewer(["outage"]);
    const { sim } = await start(r);
    for (let i = 0; i < 8; i++) await sim.send({ type: "review_retry", taskId: "o-task-1" });
    const t = sim.loop.task("o-task-1")!;
    expect(t).toMatchObject({ status: "waiting_infrastructure", reviewRetries: 5, repair: { attempt: 0 }, humanEscalation: null });
    expect(t.queueReason).toMatch(/after 5 retries.*restart the runtime to retry, or cancel.*No Manager repair cycle was consumed/);
    expect(r.calls).toHaveLength(6); // initial judgement + 5 bounded retries
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("a restart re-arms the bounded retries for the same finished run", async () => {
    const r = scriptedReviewer(["outage", "outage", "ok"]);
    const { sim } = await start(r, true);
    expect(sim.loop.task("o-task-1")!.status).toBe("waiting_infrastructure");
    sim.ports.leases.release(sim.ports.leases.current("default"));
    const loop2 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("o-task-1")).toMatchObject({ status: "waiting_infrastructure", reviewRetries: 1 });
    loop2.post({ type: "review_retry", taskId: "o-task-1" });
    await loop2.settle();
    expect(loop2.task("o-task-1")).toMatchObject({ status: "needs_human_approval", repair: { attempt: 0 } });
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("the owner is told once that the task is waiting on infrastructure, not failed", async () => {
    const { service, transport } = await start(scriptedReviewer(["outage"]));
    await service.observe();
    await service.observe();
    const infra = transport.sent.filter((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "infrastructure_waiting");
    expect(infra).toHaveLength(1);
    expect((infra[0].notice as MilestoneNotice).detail).toMatch(/has not failed and no fix attempt was used/);
  });

  it("a substantive 'unsupported' verdict is still a real repair (not an outage)", async () => {
    const reviewer: GoalReviewer = {
      async review(input) {
        return { criteria: input.criteria.map((c) => ({ id: c.id, status: "unsupported", evidence: "", reason: "not visible" })) };
      },
    };
    const { sim } = await start(reviewer);
    expect(sim.loop.task("o-task-1")!.status).toBe("needs_human_decision");
  });
});
