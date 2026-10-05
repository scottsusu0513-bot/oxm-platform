import { describe, expect, it } from "vitest";
import { createSimulation, fakeIntake } from "../scheduler/fake";
import { createManagerLoopRuntimePort } from "./runtime";

describe("Manager Loop runtime controls", () => {
  it("bridges task_created without executing inside the adapter", async () => {
    const sim = createSimulation();
    const port = createManagerLoopRuntimePort(sim.loop);
    port.enqueue(
      fakeIntake({
        taskId: "runtime-enqueue",
        availability: { claude: "unavailable", codex: "unavailable" },
      })
    );
    expect(sim.workerCalls).toHaveLength(0);
    await sim.loop.settle();
    expect(port.snapshot("runtime-enqueue")).toMatchObject({
      taskId: "runtime-enqueue",
      status: "queued",
    });
  });

  it("pauses queued work and excludes it from future dispatch", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake({
        taskId: "runtime-pause",
        availability: { claude: "unavailable", codex: "unavailable" },
      })
    );
    const port = createManagerLoopRuntimePort(sim.loop);
    expect(port.pause("runtime-pause")).toEqual({ ok: true });
    await sim.send({ type: "scheduler_tick" });
    expect(port.snapshot("runtime-pause")).toMatchObject({
      paused: true,
      state: "queued",
      queueReason: "paused by operator",
    });
    expect(sim.workerCalls).toHaveLength(0);
  });

  it("cancels running work through the loop while preserving branch and PR records", async () => {
    const sim = createSimulation({ holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "runtime-cancel" }));
    const before = sim.loop.task("runtime-cancel")!;
    expect(before.workerRunning).toBe(true);
    const port = createManagerLoopRuntimePort(sim.loop);
    expect(port.cancel("runtime-cancel")).toEqual({
      ok: true,
      cancellationRequested: true,
    });
    const after = port.snapshot("runtime-cancel")!;
    expect(after).toMatchObject({
      state: "cancelled",
      status: "blocked",
      blockingReason: "cancelled by operator",
      branch: before.branch,
      prNumber: before.prNumber,
    });
    expect(sim.remote.calls.filter(call => /DELETE|merge/i.test(call))).toEqual(
      []
    );
  });
});
