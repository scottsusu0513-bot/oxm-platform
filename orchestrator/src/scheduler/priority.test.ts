import { describe, expect, it } from "vitest";
import { assessPriority, priorityRank } from "./priority";
import { compareQueued, orderQueue } from "./queue";
import type { SchedulerTaskView } from "./types";

describe("priority policy", () => {
  it.each([
    [["production_incident"], "critical"],
    [["security_incident"], "critical"],
    [["main_ci_broken"], "critical"],
    [["functional_regression"], "high"],
    [["auth_integrity"], "high"],
    [["data_integrity"], "high"],
    [["release_blocker"], "high"],
    [["feature"], "normal"],
    [["bug"], "normal"],
    [["ux_improvement"], "normal"],
    [["polish"], "low"],
    [["copy_cleanup"], "low"],
    [["refactor"], "low"],
    [[], "normal"],
  ] as const)("%j → %s", (signals, expected) => {
    expect(assessPriority({ signals }).priority).toBe(expected);
  });

  it("the most urgent signal wins", () => {
    expect(assessPriority({ signals: ["polish", "security_incident", "feature"] }).priority).toBe("critical");
  });

  it("explicit user priority may raise", () => {
    const p = assessPriority({ signals: ["polish"], requested: "high" });
    expect(p).toMatchObject({ priority: "high", policyPriority: "low", requestedPriority: "high" });
  });

  it("explicit user priority never downgrades policy-critical work", () => {
    const p = assessPriority({ signals: ["production_incident"], requested: "low" });
    expect(p.priority).toBe("critical");
    expect(p.reasons.join(" ")).toContain("never downgraded");
  });

  it("ignores unknown signals and requests", () => {
    expect(assessPriority({ signals: ["bogus" as never], requested: "urgent" as never })).toMatchObject({ priority: "normal", requestedPriority: null });
  });

  it("ranks critical first", () => {
    expect(["low", "critical", "normal", "high"].sort((a, b) => priorityRank(a as never) - priorityRank(b as never))).toEqual(["critical", "high", "normal", "low"]);
  });
});

const view = (taskId: string, priority: SchedulerTaskView["priority"], seq: number): SchedulerTaskView => ({
  taskId,
  seq,
  priority,
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
});

describe("queue order", () => {
  it("priority → dependency readiness → creation sequence → task id", () => {
    const tasks = [view("n2", "normal", 2), view("h3", "high", 3), view("n1", "normal", 1), view("w0", "normal", 0), view("c9", "critical", 9)];
    const ready = (id: string) => id !== "w0";
    expect(orderQueue(tasks, ready).map((t) => t.taskId)).toEqual(["c9", "h3", "n1", "n2", "w0"]);
  });

  it("task id breaks equal sequence deterministically", () => {
    expect(compareQueued(view("b", "normal", 1), view("a", "normal", 1), () => true)).toBeGreaterThan(0);
  });
});
