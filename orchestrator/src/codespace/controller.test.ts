import { describe, expect, it } from "vitest";
import { createCodespaceLifecycleController } from "./controller";
import { createFakeCodespaceClient, FAKE_CODESPACE_IDENTITY } from "./fake";
import { createLifecycleLeaseRegistry } from "./lease";
import {
  createMemoryLifecycleStateRepository,
  initialLifecycleState,
} from "./state";
import type { LifecycleWorkload, PersistedLifecycleState } from "./types";

const T0 = "2026-10-05T12:00:00.000Z";
const T5 = "2026-10-05T12:05:00.000Z";
const T11 = "2026-10-05T12:11:00.000Z";
const none = (): LifecycleWorkload => ({
  runnableTaskIds: [],
  imminentTaskIds: [],
  repairPendingTaskIds: [],
  workerRunningTaskIds: [],
  activeWorkspaceLease: false,
  orchestrationActive: false,
});
const runnable = (...taskIds: string[]): LifecycleWorkload => ({
  ...none(),
  runnableTaskIds: taskIds,
});

function harness(
  status: Parameters<typeof createFakeCodespaceClient>[0] = "stopped",
  initial?: PersistedLifecycleState
) {
  const fake = createFakeCodespaceClient(status);
  const audit: string[] = [];
  const persistence = createMemoryLifecycleStateRepository(initial);
  const make = () =>
    createCodespaceLifecycleController({
      identity: FAKE_CODESPACE_IDENTITY,
      ports: {
        client: fake.client,
        persistence,
        leases: createLifecycleLeaseRegistry(),
        audit: e => audit.push(e.event),
      },
    });
  return { fake, audit, persistence, make, controller: make() };
}

describe("Codespace lifecycle controller", () => {
  it("starts once, waits for trusted readiness, then permits dispatch", async () => {
    const h = harness();
    expect(
      (await h.controller.reconcile(runnable("a"), T0)).decision.action
    ).toBe("start");
    expect(h.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    expect(
      (await h.controller.reconcile(runnable("a"), T0)).decision.action
    ).toBe("wait_ready");
    expect(h.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    h.fake.setStatus("available");
    const ready = await h.controller.reconcile(runnable("a"), T0);
    expect(ready.ready).toBe(true);
    expect(ready.decision.action).toBe("no_op");
    expect(h.audit).toContain("codespace_ready");
  });

  it("reuses one start for adjacent tasks and an available runtime needs no mutation", async () => {
    const h = harness();
    await h.controller.reconcile(runnable("a", "b"), T0);
    await h.controller.reconcile(runnable("a", "b"), T0);
    expect(h.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    const available = harness("available");
    expect(
      (await available.controller.reconcile(runnable("a"), T0)).ready
    ).toBe(true);
    expect(available.fake.calls.some(c => /^(start|stop):/.test(c))).toBe(
      false
    );
  });

  it("does not wake for approval/dependency/blocked, paused/cancelled, or status-only work", async () => {
    const h = harness();
    await h.controller.reconcile(none(), T0);
    await h.controller.reconcile({ ...none(), statusQueryOnly: true }, T0);
    expect(h.fake.calls.some(c => c.startsWith("start:"))).toBe(false);
  });

  it("keeps an active worker alive and holds an idle runtime through grace", async () => {
    const h = harness("available");
    const active = await h.controller.reconcile(
      {
        ...none(),
        workerRunningTaskIds: ["a"],
        activeWorkspaceLease: true,
        orchestrationActive: true,
      },
      T0
    );
    expect(active.decision.action).toBe("keep_alive");
    await h.controller.reconcile(none(), T0);
    const grace = await h.controller.reconcile(none(), T5);
    expect(grace.decision).toMatchObject({
      action: "keep_alive",
      reasonCode: "idle_grace_active",
    });
    expect(h.fake.calls.some(c => c.startsWith("stop:"))).toBe(false);
  });

  it("stops once after grace and duplicate stop events are idempotent", async () => {
    const h = harness("available");
    await h.controller.reconcile(none(), T0);
    expect((await h.controller.reconcile(none(), T11)).decision.action).toBe(
      "stop"
    );
    await h.controller.reconcile(none(), T11);
    expect(h.fake.calls.filter(c => c.startsWith("stop:"))).toHaveLength(1);
    h.fake.setStatus("stopped");
    await h.controller.reconcile(none(), T11);
    await h.controller.reconcile(none(), T11);
    expect(h.fake.calls.filter(c => c.startsWith("stop:"))).toHaveLength(1);
  });

  it("retries a failed start within budget and blocks when exhausted", async () => {
    const retried = harness();
    retried.fake.failNextStarts();
    expect(
      (await retried.controller.reconcile(runnable("a"), T0)).decision.action
    ).toBe("wait_ready");
    expect(
      (await retried.controller.reconcile(runnable("a"), T0)).decision.action
    ).toBe("start");
    expect(retried.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(2);
    expect(retried.audit).toContain("lifecycle_retry_scheduled");

    const exhausted = harness();
    exhausted.fake.failNextStarts(2);
    await exhausted.controller.reconcile(runnable("a"), T0);
    expect(
      (await exhausted.controller.reconcile(runnable("a"), T0)).decision.action
    ).toBe("blocked");
    expect(exhausted.audit).toContain("lifecycle_blocked");
  });

  it("retries a failed stop and fails closed when trusted status is unavailable", async () => {
    const h = harness("available");
    await h.controller.reconcile(none(), T0);
    h.fake.failNextStops();
    expect(
      (await h.controller.reconcile(none(), T11)).decision.reasonCode
    ).toBe("stop_api_failure");
    expect((await h.controller.reconcile(none(), T11)).decision.action).toBe(
      "stop"
    );
    expect(h.fake.calls.filter(c => c.startsWith("stop:"))).toHaveLength(2);

    const unavailable = harness();
    unavailable.fake.failNextStatuses();
    const outcome = await unavailable.controller.reconcile(
      runnable("queued"),
      T0
    );
    expect(outcome).toMatchObject({
      ready: false,
      decision: { action: "blocked", reasonCode: "trusted_status_unavailable" },
    });
    expect(unavailable.fake.calls.some(c => c.startsWith("start:"))).toBe(
      false
    );
  });

  it("surfaces startup timeout without polling or losing queued work", async () => {
    const h = harness();
    await h.controller.reconcile(runnable("queued"), T0);
    const timeout = await h.controller.reconcile(runnable("queued"), T11);
    expect(timeout.decision.reasonCode).toBe("startup_timeout_retry_pending");
    expect(timeout.decision.taskIds).toEqual(["queued"]);
    expect(h.audit).toContain("lifecycle_retry_scheduled");
  });

  it("marks an unexpected stop during a worker run as interrupted", async () => {
    const initial = {
      ...initialLifecycleState(FAKE_CODESPACE_IDENTITY.codespaceName),
      state: "busy" as const,
      lastTrustedStatus: "available" as const,
    };
    const h = harness("stopped", initial);
    const outcome = await h.controller.reconcile(
      { ...none(), workerRunningTaskIds: ["a"], orchestrationActive: true },
      T0
    );
    expect(outcome).toMatchObject({
      unexpectedStop: true,
      workerInterrupted: true,
      ready: false,
    });
    expect(h.audit).toContain("codespace_unexpected_stop");
  });

  it("reconciles restart during starting and available without replaying start", async () => {
    const h = harness();
    await h.controller.reconcile(runnable("a"), T0);
    const restarted = h.make();
    expect((await restarted.reconcile(runnable("a"), T0)).decision.action).toBe(
      "wait_ready"
    );
    expect(h.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
    h.fake.setStatus("available");
    const restartedAgain = h.make();
    expect((await restartedAgain.reconcile(runnable("a"), T0)).ready).toBe(
      true
    );
    expect(h.fake.calls.filter(c => c.startsWith("start:"))).toHaveLength(1);
  });

  it("can wake again when approved work becomes runnable after a stop", async () => {
    const h = harness("available");
    await h.controller.reconcile(none(), T0);
    await h.controller.reconcile(none(), T11);
    h.fake.setStatus("stopped");
    await h.controller.reconcile(none(), T11);
    expect(
      (await h.controller.reconcile(runnable("approved"), T11)).decision.action
    ).toBe("start");
  });

  it("fails closed for another repository or codespace", async () => {
    const bad = {
      ...FAKE_CODESPACE_IDENTITY,
      repository: { owner: "other", repository: "repo" },
    };
    expect(() =>
      createCodespaceLifecycleController({
        identity: bad,
        ports: {
          client: createFakeCodespaceClient().client,
          persistence: createMemoryLifecycleStateRepository(),
          leases: createLifecycleLeaseRegistry(),
          audit: () => undefined,
        },
      })
    ).toThrow(/binding/);
    const h = harness();
    const fake = createFakeCodespaceClient("stopped", {
      ...FAKE_CODESPACE_IDENTITY,
      codespaceName: "other",
    });
    const controller = createCodespaceLifecycleController({
      identity: FAKE_CODESPACE_IDENTITY,
      ports: {
        client: fake.client,
        persistence: createMemoryLifecycleStateRepository(),
        leases: createLifecycleLeaseRegistry(),
        audit: () => undefined,
      },
    });
    await expect(controller.reconcile(runnable("a"), T0)).rejects.toThrow(
      /target mismatch/
    );
  });
});
