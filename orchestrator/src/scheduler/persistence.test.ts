import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../store/memory";
import { createManagerLoop } from "./loop";
import { createSimulation, fakeIntake } from "./fake";
import { createAuditCheckpointRepository } from "./persistence";

describe("Manager Loop persistence and resume", () => {
  it("stores a sanitized checkpoint in the existing audit repository and reloads it", () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let id = 0;
    const repository = createAuditCheckpointRepository({ audit: store.audit, nextId: () => `checkpoint-${++id}` });
    repository.save({ version: 1, sequence: 0, tasks: [] });
    expect(repository.load()).toEqual({ version: 1, sequence: 0, tasks: [] });
    expect(store.audit.list({ taskId: "scheduler" })).toHaveLength(1);
  });

  it("reloads a completed worker/push/PR stage without repeating worker, push, or PR creation", async () => {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let checkpointId = 0;
    const persistence = createAuditCheckpointRepository({ audit: store.audit, nextId: () => `resume-checkpoint-${++checkpointId}` });
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

    const resumed = createManagerLoop(sim.ports);
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
    expect(sim.loop.task("storefail")!).toMatchObject({ status: "blocked", state: "failed" });
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
});
