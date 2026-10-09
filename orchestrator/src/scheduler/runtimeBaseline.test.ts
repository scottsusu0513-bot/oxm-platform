import { describe, expect, it } from "vitest";
import { TERMINAL_ORCHESTRATION_STATUSES } from "./types";
import { createSimulation, driveQa, fakeIntake, MAIN_SHA, sha } from "./fake";

// Manager Loop regression for the cold-start blocker: new task branches never start
// older than the runtime baseline, and the fixed workspace is returned to the
// runtime branch only once no task is active.
const RUNTIME = { branch: "agent/gpt-manager-live-e2e", sha: sha(0x40bff) };

function spyRuntimeWorkspace(sim: () => ReturnType<typeof createSimulation>) {
  const calls: { statuses: string[] }[] = [];
  return {
    calls,
    port: {
      async restoreIfIdle() {
        calls.push({ statuses: sim().loop.tasks().map((t) => t.status) });
      },
    },
  };
}

describe("runtime baseline in the Manager Loop", () => {
  it("runtime newer than main: the task branch is created at the baseline; trusted commit/push/PR are unchanged", async () => {
    const sim = createSimulation({ runtimeBaseline: RUNTIME });
    await sim.create(fakeIntake({ taskId: "rb1" }));
    const t = sim.loop.task("rb1")!;
    expect(sim.remote.calls).toContain(`CREATE ref oxm/oxm-platform ${t.branch}@${RUNTIME.sha}`);
    expect(sim.workerCalls[0].expectedHeadSha).toBe(RUNTIME.sha);
    expect(sim.workerCalls[0].expectedHeadSha).not.toBe(MAIN_SHA);
    // Trusted commit after the human gate, then one normal push and a PR against main.
    expect(sim.commits.map((c) => c.taskId)).toEqual(["rb1"]);
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([`PUSH ${t.headSha}:refs/heads/${t.branch}`]);
    expect(t.prNumber).toBe(100);
    await driveQa(sim, "rb1");
    expect(sim.loop.task("rb1")!.status).toBe("accepted");
    // main is never written.
    expect(sim.remote.refs.get("main")).toBe(MAIN_SHA);
    expect(sim.remote.calls.filter((c) => /refs\/heads\/main|merge|force/i.test(c))).toEqual([]);
  });

  it("main already contains the runtime: the task branch starts from main", async () => {
    const sim = createSimulation({ runtimeBaseline: { ...RUNTIME, relation: "behind" } });
    await sim.create(fakeIntake({ taskId: "rb2" }));
    expect(sim.workerCalls[0].expectedHeadSha).toBe(MAIN_SHA);
  });

  it("a diverged or unpublished baseline fails closed before any branch or Worker", async () => {
    for (const relation of ["diverged", null] as const) {
      const sim = createSimulation({ runtimeBaseline: { ...RUNTIME, relation } });
      await sim.create(fakeIntake({ taskId: "rb3" }));
      expect(sim.loop.task("rb3")!).toMatchObject({ status: "blocked", blockingReason: expect.stringMatching(/task base could not be resolved \(baseline_(diverged|unpublished)\)/) });
      expect(sim.workerCalls).toEqual([]);
      expect(sim.remote.calls.filter((c) => c.startsWith("CREATE") || c.startsWith("PUSH"))).toEqual([]);
    }
  });

  it("returns to the runtime branch only after the task is terminal, never during work, approval or QA", async () => {
    let sim: ReturnType<typeof createSimulation>;
    const spy = spyRuntimeWorkspace(() => sim);
    sim = createSimulation({ runtimeBaseline: RUNTIME, runtimeWorkspace: spy.port, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "rb4" }));
    expect(sim.loop.task("rb4")!.status).not.toMatch(/accepted|blocked/);
    expect(spy.calls).toEqual([]); // waiting for the human commit approval: still on the task branch

    sim.approve("rb4", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "rb4", phase: "commit_publish" });
    expect(sim.loop.task("rb4")!.status).toBe("qa_pending");
    expect(spy.calls).toEqual([]);

    await driveQa(sim, "rb4");
    expect(sim.loop.task("rb4")!.status).toBe("accepted");
    expect(spy.calls.length).toBeGreaterThan(0);
    for (const call of spy.calls) for (const s of call.statuses) expect(TERMINAL_ORCHESTRATION_STATUSES).toContain(s);
  });

  it("a Worker failure under repair keeps the task branch; the return happens only after the repaired task completes", async () => {
    let sim: ReturnType<typeof createSimulation>;
    const spy = spyRuntimeWorkspace(() => sim);
    sim = createSimulation({ runtimeBaseline: RUNTIME, runtimeWorkspace: spy.port, worker: { rb5: ["failure", "success"] } });
    await sim.create(fakeIntake({ taskId: "rb5" }));
    expect(sim.workerCalls.map((c) => c.repair)).toEqual([false, true]);
    expect(sim.workerCalls[1].branch).toBe(sim.workerCalls[0].branch);
    expect(spy.calls).toEqual([]);
    await driveQa(sim, "rb5");
    expect(sim.loop.task("rb5")!.status).toBe("accepted");
    expect(spy.calls.length).toBeGreaterThan(0);
  });

  it("with a second task still active, finishing the first does not return the workspace", async () => {
    let sim: ReturnType<typeof createSimulation>;
    const spy = spyRuntimeWorkspace(() => sim);
    sim = createSimulation({ runtimeBaseline: RUNTIME, runtimeWorkspace: spy.port });
    await sim.create(fakeIntake({ taskId: "rb6" }));
    await sim.create(fakeIntake({ taskId: "rb7", workspaceId: "ws-rb7", expectedPaths: ["server/other.ts"] } as never));
    await driveQa(sim, "rb6");
    expect(sim.loop.task("rb6")!.status).toBe("accepted");
    expect(sim.loop.task("rb7")!.status).not.toMatch(/accepted|blocked/);
    expect(spy.calls).toEqual([]);
    await driveQa(sim, "rb7");
    expect(spy.calls.length).toBeGreaterThan(0);
  });
});
