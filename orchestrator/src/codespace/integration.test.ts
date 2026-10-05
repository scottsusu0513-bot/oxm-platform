import { describe, expect, it } from "vitest";
import { createSimulation, fakeIntake } from "../scheduler/fake";
import {
  createManagerApprovalRequirementReader,
  createManagerLoopGatewayEvents,
} from "../gateway/integration";
import { createCodespaceLifecycleController } from "./controller";
import { createFakeCodespaceClient, FAKE_CODESPACE_IDENTITY } from "./fake";
import { createLifecycleLeaseRegistry } from "./lease";
import { createMemoryLifecycleStateRepository } from "./state";

function attach(status: "stopped" | "available" = "stopped") {
  const sim = createSimulation({ holdWorkers: true });
  const fake = createFakeCodespaceClient(status);
  sim.ports.lifecycle = createCodespaceLifecycleController({
    identity: FAKE_CODESPACE_IDENTITY,
    ports: {
      client: fake.client,
      persistence: createMemoryLifecycleStateRepository(),
      leases: createLifecycleLeaseRegistry(),
      audit: event => sim.audit.push(event),
    },
  });
  return { sim, fake };
}

describe("scheduler / lifecycle integration", () => {
  it("waits for readiness, then dispatches two queued tasks through one runtime start", async () => {
    const { sim, fake } = attach();
    await sim.create(fakeIntake({ taskId: "life1" }));
    await sim.create(fakeIntake({ taskId: "life2" }));
    expect(sim.workerCalls).toEqual([]);
    expect(sim.loop.task("life1")!.status).toBe("runtime_starting");
    expect(fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    fake.setStatus("available");
    await sim.send({ type: "runtime_status_updated" });
    expect(sim.workerCalls.map(c => c.taskId).sort()).toEqual([
      "life1",
      "life2",
    ]);
    expect(fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
  });

  it("dispatches immediately when available with no lifecycle mutation", async () => {
    const { sim, fake } = attach("available");
    await sim.create(fakeIntake({ taskId: "cheap" }));
    expect(sim.workerCalls).toHaveLength(1);
    expect(fake.calls.some(c => /^(start|stop):/.test(c))).toBe(false);
  });

  it("an approval-waiting task does not wake the runtime", async () => {
    const { sim, fake } = attach();
    await sim.create(
      fakeIntake({ taskId: "redlife", actions: [{ kind: "prod_deploy" }] })
    );
    expect(sim.loop.task("redlife")!.status).toBe("needs_human_approval");
    expect(fake.calls.some(c => c.startsWith("start:"))).toBe(false);
  });

  it("a gateway approval never starts Codespace directly; the scheduler lifecycle may wake it", async () => {
    const { sim, fake } = attach();
    await sim.create(
      fakeIntake({ taskId: "approved-life", actions: [{ kind: "prod_deploy" }] })
    );
    const requirement = await createManagerApprovalRequirementReader(
      sim.loop
    ).current("approved-life");
    expect(requirement).not.toBeNull();
    const approval = sim.approvals.create({
      id: requirement!.approvalRequestId,
      taskId: requirement!.taskId,
      kind: requirement!.kind,
      requestedAction: requirement!.action,
      bindingShaOrActionId: requirement!.bindingTarget,
      expiresAt: requirement!.expiresAt,
    });
    sim.approvals.decide(approval.id, {
      status: "approved",
      decidedBy: "operator-1",
      channel: "gateway",
    });

    // The gateway adapter only posts a re-evaluation notification. The
    // Manager verifies the repository row, queues work, and only then the
    // lifecycle controller decides to start the stopped runtime.
    createManagerLoopGatewayEvents(sim.loop).reEvaluateApproval(
      "approved-life",
      "pre_execution",
      "approved"
    );
    await sim.loop.settle();
    expect(fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    expect(sim.loop.task("approved-life")!.status).toBe("runtime_starting");
    expect(sim.workerCalls).toEqual([]);
  });
});
