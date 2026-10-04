import { describe, expect, it } from "vitest";
import { decideSchedule } from "./scheduler";
import type { SchedulerInput, SchedulerPolicy, SchedulerTaskView } from "./types";

const POLICY: SchedulerPolicy = { maxConcurrentTasks: 2, executableWorkers: ["claude"] };
let seq = 0;
const task = (taskId: string, o: Partial<SchedulerTaskView> = {}): SchedulerTaskView => ({
  taskId,
  seq: ++seq,
  priority: "normal",
  state: "queued",
  status: "queued",
  inFlight: false,
  worker: "claude",
  dependsOn: [],
  workspaceId: `ws-${taskId}`,
  lineageId: taskId,
  expectedPaths: [`server/${taskId}.ts`],
  workerExecutions: 0,
  maxWorkerExecutions: 3,
  ...o,
});
const decide = (tasks: SchedulerTaskView[], o: Partial<SchedulerInput> = {}) =>
  Object.fromEntries(decideSchedule({ tasks, workspaceHolder: () => null, policy: POLICY, ...o }).map((d) => [d.taskId, d]));

describe("scheduler dispatch policy", () => {
  it("unrelated, non-overlapping tasks can both dispatch", () => {
    const d = decide([task("a"), task("b")]);
    expect(d.a.action).toBe("dispatch");
    expect(d.b.action).toBe("dispatch");
  });

  it("overlapping tasks serialize (exact and directory overlap)", () => {
    const d = decide([task("a", { expectedPaths: ["client/src/pages/"] }), task("b", { expectedPaths: ["client/src/pages/Search.tsx"] })]);
    expect(d.a.action).toBe("dispatch");
    expect(d.b).toMatchObject({ action: "wait_branch_conflict", waitingOn: ["a"] });
  });

  it("an in-flight task blocks overlapping queued work", () => {
    const d = decide([task("run", { inFlight: true, state: "running", status: "running", expectedPaths: ["server/x.ts"] }), task("q", { expectedPaths: ["server/x.ts"] })]);
    expect(d.run).toBeUndefined(); // in-flight tasks are not re-decided
    expect(d.q.action).toBe("wait_branch_conflict");
  });

  it("high-conflict files serialize even when exact paths differ", () => {
    const d = decide([task("a", { expectedPaths: ["server/db.ts", "server/a.ts"] }), task("b", { expectedPaths: ["drizzle/schema.ts"] })]);
    expect(d.b.action).toBe("wait_branch_conflict");
  });

  it("workspace collision queues a task", () => {
    const d = decide([task("a", { workspaceId: "w" }), task("b", { workspaceId: "w" })]);
    expect(d.a.action).toBe("dispatch");
    expect(d.b).toMatchObject({ action: "wait_workspace", waitingOn: ["a"] });
    expect(decide([task("c", { workspaceId: "w" })], { workspaceHolder: (id) => (id === "w" ? "zz" : null) }).c).toMatchObject({ action: "wait_workspace", waitingOn: ["zz"] });
  });

  it("high-priority task wins deterministic contention", () => {
    const low = task("low", { workspaceId: "w", expectedPaths: ["server/x.ts"] });
    const high = task("high", { workspaceId: "w", expectedPaths: ["server/x.ts"], priority: "high" });
    const d = decide([low, high]);
    expect(d.high.action).toBe("dispatch");
    expect(d.low.action).toBe("wait_workspace");
    // Order of input does not matter.
    expect(decide([high, low]).high.action).toBe("dispatch");
  });

  it("a waiting higher-priority task reserves its paths against lower-priority work", () => {
    const d = decide(
      [
        task("busy", { inFlight: true, state: "running", status: "running", workspaceId: "w" }),
        task("hi", { priority: "critical", workspaceId: "w", expectedPaths: ["server/shared.ts"] }),
        task("lo", { priority: "low", expectedPaths: ["server/shared.ts"] }),
      ],
      { workspaceHolder: (id) => (id === "w" ? "busy" : null) },
    );
    expect(d.hi.action).toBe("wait_workspace");
    expect(d.lo).toMatchObject({ action: "wait_branch_conflict", waitingOn: ["hi"] });
  });

  it("respects maxConcurrentTasks (configurable)", () => {
    const d = decide([task("a"), task("b"), task("c")]);
    expect([d.a.action, d.b.action, d.c.action]).toEqual(["dispatch", "dispatch", "keep_queued"]);
    expect(d.c.reason).toBe("max concurrency 2 reached");
    const one = decide([task("a"), task("b")], { policy: { ...POLICY, maxConcurrentTasks: 1 } });
    expect(one.b.action).toBe("keep_queued");
    const inflight = decide([task("r1", { inFlight: true, status: "running" }), task("r2", { inFlight: true, status: "qa_pending" }), task("q")]);
    expect(inflight.q.action).toBe("keep_queued");
  });

  it("dependencies gate dispatch", () => {
    const d = decide([task("b", { status: "running", inFlight: true }), task("a", { dependsOn: ["b"] })]);
    expect(d.a).toMatchObject({ action: "wait_dependency", waitingOn: ["b"] });
    expect(decide([task("b", { status: "accepted", state: "complete" }), task("a", { dependsOn: ["b"] })]).a.action).toBe("dispatch");
    expect(decide([task("b", { status: "blocked", state: "failed" }), task("a", { dependsOn: ["b"] })]).a.action).toBe("blocked");
  });

  it("unavailable or non-executable workers keep the task queued", () => {
    const d = decide([task("x", { worker: null }), task("y", { worker: "codex" })]);
    expect(d.x).toMatchObject({ action: "keep_queued", reason: "no eligible worker routed" });
    expect(d.y).toMatchObject({ action: "keep_queued", reason: "worker codex is not executable in this phase" });
  });

  it("exhausted retry budget blocks", () => {
    expect(decide([task("x", { workerExecutions: 3 })]).x.action).toBe("blocked");
  });

  it("only TaskState queued is dispatchable (approval gate respected)", () => {
    const d = decide([task("red", { state: "awaiting_approval", status: "needs_human_approval" })]);
    expect(d.red).toBeUndefined();
  });

  it("reports completed and blocked tasks", () => {
    const d = decide([task("done", { status: "accepted", state: "complete" }), task("bad", { status: "blocked", state: "failed" })]);
    expect(d.done.action).toBe("completed");
    expect(d.bad.action).toBe("blocked");
  });

  it("is deterministic", () => {
    const tasks = [task("a", { priority: "low" }), task("b", { workspaceId: "ws-a" }), task("c", { priority: "critical" })];
    expect(decideSchedule({ tasks, workspaceHolder: () => null, policy: POLICY })).toEqual(decideSchedule({ tasks: [...tasks].reverse(), workspaceHolder: () => null, policy: POLICY }));
  });
});
