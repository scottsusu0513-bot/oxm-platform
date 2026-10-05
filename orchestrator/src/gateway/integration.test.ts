import { describe, expect, it } from "vitest";
import { createSimulation, fakeIntake } from "../scheduler/fake";
import {
  createManagerApprovalRequirementReader,
  createManagerLoopGatewayEvents,
} from "./integration";

describe("gateway / Manager approval integration", () => {
  it("exposes the exact Manager binding and a forged notification remains non-authoritative", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake({ taskId: "gateway-red", actions: [{ kind: "prod_deploy" }] }),
    );
    const reader = createManagerApprovalRequirementReader(sim.loop);
    const requirement = await reader.current("gateway-red");
    expect(requirement).toMatchObject({
      taskId: "gateway-red",
      phase: "pre_execution",
      kind: "start",
      action: "start",
      status: "pending",
    });
    expect(requirement?.bindingTarget).not.toBe("start:gateway-red");

    createManagerLoopGatewayEvents(sim.loop).reEvaluateApproval(
      "gateway-red",
      "pre_execution",
      "approved",
    );
    await sim.loop.settle();
    expect(sim.loop.task("gateway-red")).toMatchObject({
      status: "needs_human_approval",
      state: "awaiting_approval",
    });
    expect(sim.workerCalls).toEqual([]);
  });

  it("changes the request identity when the exact action binding changes", async () => {
    const first = {
      taskId: "t1",
      phase: "post_qa" as const,
      kind: "merge" as const,
      requestedAction: "complete_post_qa",
      bindingShaOrActionId: "a".repeat(40),
      risk: "red" as const,
      requestedAt: "2026-10-05T00:00:00.000Z",
    };
    let current = first;
    const reader = createManagerApprovalRequirementReader({
      async pendingApproval() { return current; },
    });
    const before = await reader.current("t1");
    current = { ...first, bindingShaOrActionId: "b".repeat(40) };
    const after = await reader.current("t1");
    expect(after?.approvalRequestId).not.toBe(before?.approvalRequestId);
    expect(after?.bindingTarget).toBe("b".repeat(40));
  });
});
