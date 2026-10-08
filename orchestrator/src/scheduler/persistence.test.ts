import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../store/memory";
import { createManagerLoop } from "./loop";
import { createSimulation, fakeIntake } from "./fake";
import { createAuditCheckpointRepository } from "./persistence";
import type { GoalReviewer } from "../planning/types";

describe("Manager Loop persistence and resume", () => {
  it("persists Manager call counts and adds to them after restart instead of resetting", async () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let checkpointId = 0;
    const persistence = createAuditCheckpointRepository({
      audit: store.audit,
      nextId: () => `manager-count-checkpoint-${++checkpointId}`,
    });
    let diagnosisCalls = 0;
    const manager = {
      async diagnose() {
        diagnosisCalls++;
        if (diagnosisCalls === 1) throw new Error("temporary Manager outage");
        return {
          rootCause: "The failing branch does not persist the record.",
          whyPreviousAttemptFailed: "",
          missingEvidence: [],
          repairStrategy: "Persist before returning from the branch",
          strategyChanged: false,
          repairObjective: "Every successful branch persists once.",
          repairInstructions: ["Move the write before the return."],
          protectedAreas: ["Keep the public response shape unchanged."],
          requiredEvidence: ["The focused test passes"],
          validationPlan: ["tests", "typecheck"],
          touchesPaths: ["server/counts/index.ts"],
          restartFromScratch: false,
          ownerDecisionNeeded: false,
          ownerDecisionQuestion: "",
          ownerOptions: [],
          recommendedOption: "",
          constraintCompliance: [],
        };
      },
    };
    const reviewer: GoalReviewer = {
      async review(input) {
        return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "trusted diff contains the persisted write", reason: "" })), constraints: [] };
      },
    };
    const task = fakeIntake(
      { taskId: "counts" },
      {
        goal: { intent: "change_code", originalRequest: "修正存檔", interpretedObjective: "Every successful save persists.", workArea: "programming" },
        acceptanceCriteria: [{ id: "AC-1", text: "Every successful save persists", kind: "goal" }],
      },
    );
    const sim = createSimulation({
      persistence,
      manager,
      goalReviewer: reviewer,
      worker: { counts: ["validation_failed", "success"] },
      policy: { managerMode: "gpt_required" },
      autoApproveCommits: false,
    });
    await sim.create(task);
    expect(sim.loop.task("counts")).toMatchObject({
      status: "waiting_infrastructure",
      budget: { managerCalls: { interpretation: 1, semanticReview: 1, repairDiagnosis: 1 } },
    });
    expect(persistence.load()?.tasks[0].managerCalls).toMatchObject({ interpretation: 1, semanticReview: 1, repairDiagnosis: 1 });

    // Seed the other independently exercised call kinds as prior durable history.
    // This isolates the checkpoint round-trip from the workflow tests that prove
    // each corresponding call increments its own field.
    const saved = persistence.load()!;
    saved.tasks[0].managerCalls = {
      interpretation: 1,
      semanticReview: 1,
      repairDiagnosis: 1,
      guidanceInterpretation: 3,
      combinedReview: 4,
      combinedDiagnosis: 5,
    };
    persistence.save(saved);

    const oldLease = sim.ports.leases.current("ws-counts");
    expect(oldLease).not.toBeNull();
    sim.ports.leases.release(oldLease);
    const resumed = createManagerLoop(sim.ports, { managerMode: "gpt_required" });
    await resumed.resume();
    await resumed.settle();

    expect(resumed.task("counts")).toMatchObject({
      budget: {
        managerCalls: {
          interpretation: 1,
          semanticReview: 2,
          repairDiagnosis: 2,
          guidanceInterpretation: 3,
          combinedReview: 4,
          combinedDiagnosis: 5,
        },
      },
    });
    expect(diagnosisCalls).toBe(2);
    expect(persistence.load()?.tasks[0].managerCalls).toEqual({
      interpretation: 1,
      semanticReview: 2,
      repairDiagnosis: 2,
      guidanceInterpretation: 3,
      combinedReview: 4,
      combinedDiagnosis: 5,
    });
  });

  it("stores a sanitized checkpoint in the existing audit repository and reloads it", () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let id = 0;
    const repository = createAuditCheckpointRepository({
      audit: store.audit,
      nextId: () => `checkpoint-${++id}`,
    });
    repository.save({ version: 1, sequence: 0, tasks: [] });
    expect(repository.load()).toEqual({ version: 1, sequence: 0, tasks: [] });
    expect(store.audit.list({ taskId: "scheduler" })).toHaveLength(1);
  });

  it("reloads a completed worker/push/PR stage without repeating worker, push, or PR creation", async () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let checkpointId = 0;
    const persistence = createAuditCheckpointRepository({
      audit: store.audit,
      nextId: () => `resume-checkpoint-${++checkpointId}`,
    });
    const sim = createSimulation({ persistence });
    await sim.create(fakeIntake({ taskId: "resume1" }, { dependsOn: [] }));
    const before = sim.loop.task("resume1")!;
    expect(before.status).toBe("qa_pending");
    expect(persistence.load()?.tasks[0]).toMatchObject({
      intake: { taskId: "resume1", dependsOn: [] },
      status: "qa_pending",
      worker: "claude",
      workerRunning: false,
      workerExecutions: 1,
      repair: { attempt: 0 },
      receipt: { headSha: before.headSha },
      pr: { number: before.prNumber },
      prState: "open",
      nextQaPollDelayMs: 30_000,
      pendingSideEffect: null,
    });
    const workerCalls = sim.workerCalls.length;
    const pushes = sim.remote.calls.filter((c) => c.startsWith("PUSH")).length;
    const prs = sim.remote.calls.filter((c) => c.startsWith("CREATE pr")).length;

    const oldLease = sim.ports.leases.current("ws-resume1");
    expect(oldLease).not.toBeNull();
    sim.ports.leases.release(oldLease);

    const resumed = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await resumed.resume();
    await resumed.settle();
    expect(resumed.task("resume1")!).toMatchObject({
      status: "qa_pending",
      workerRunning: false,
      branch: before.branch,
      headSha: before.headSha,
      prNumber: before.prNumber,
    });
    expect(sim.workerCalls).toHaveLength(workerCalls);
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toHaveLength(pushes);
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE pr"))).toHaveLength(prs);
  });

  it("resume retains a Codex assignment and never re-routes or repeats the worker", async () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let checkpointId = 0;
    const persistence = createAuditCheckpointRepository({
      audit: store.audit,
      nextId: () => `codex-checkpoint-${++checkpointId}`,
    });
    const sim = createSimulation({ persistence });
    await sim.create(fakeIntake({ taskId: "resume-ui", category: "visual_polish" }));
    expect(persistence.load()?.tasks[0]).toMatchObject({
      worker: "codex",
      workerExecutions: 1,
      status: "qa_pending",
    });
    const calls = sim.workerCalls.length;
    const lease = sim.ports.leases.current("ws-resume-ui");
    expect(lease).not.toBeNull();
    sim.ports.leases.release(lease);
    const resumed = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await resumed.resume();
    await resumed.settle();
    expect(resumed.task("resume-ui")).toMatchObject({
      worker: "codex",
      status: "qa_pending",
    });
    expect(sim.workerCalls).toHaveLength(calls);
  });

  it("fails closed before dispatch when checkpoint persistence fails", async () => {
    const sim = createSimulation({
      persistence: {
        load: () => null,
        save: () => {
          throw new Error("store unavailable");
        },
      },
    });
    await sim.create(fakeIntake({ taskId: "storefail" }));
    expect(sim.loop.task("storefail")!).toMatchObject({
      status: "blocked",
      state: "failed",
    });
    expect(sim.workerCalls).toEqual([]);
  });

  it("does not report acceptance when the terminal checkpoint cannot be stored", async () => {
    const sim = createSimulation({
      persistence: {
        load: () => null,
        save: (checkpoint) => {
          if (checkpoint.tasks.some((t) => t.status === "accepted")) throw new Error("terminal store unavailable");
        },
      },
    });
    await sim.create(fakeIntake({ taskId: "terminal-storefail" }));
    await sim.send({ type: "qa_updated", taskId: "terminal-storefail" });
    expect(sim.loop.task("terminal-storefail")!).toMatchObject({
      status: "blocked",
      blockingReason: "orchestration persistence failed",
    });
  });

  it("restores a pending commit/publish approval with the identical binding (sanitizer-redacted authorization literal is restored, never widened)", async () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let id = 0;
    const persistence = createAuditCheckpointRepository({ audit: store.audit, nextId: () => `cp-${++id}` });
    const sim = createSimulation({ persistence, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "resume-commit" }));
    const before = await sim.loop.pendingApproval("resume-commit");
    expect(persistence.load()!.tasks[0].commitApprovalEvidence!.authorization).toBe("[REDACTED]");
    sim.ports.leases.release(sim.ports.leases.current("ws-resume-commit"));
    const resumed = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture" });
    await resumed.resume();
    await resumed.settle();
    const after = await resumed.pendingApproval("resume-commit");
    expect(after).toEqual(before);
    expect(after!.evidence!.authorization).toEqual({ commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false });
  });
});
