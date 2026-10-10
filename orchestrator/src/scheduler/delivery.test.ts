import { describe, expect, it } from "vitest";
import { createFakeDelivery, createFakePreview, deployed, PASSING_CHECKS, type FakeDelivery } from "../delivery/fake";
import { deployApprovalBinding } from "../delivery/approval";
import { DEPLOY_AUTHORIZATION } from "../delivery/types";
import { createMemoryStore } from "../store/memory";
import { REDACTED } from "../store/sanitize";
import { createManagerLoop } from "./loop";
import { createSimulation, driveQa, fakeIntake, sha, type Simulation, type SimulationOptions } from "./fake";
import { createAuditCheckpointRepository } from "./persistence";
import type { TaskIntake } from "./types";

const PR26 = "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數";

function uiTask(taskId: string, overrides: Partial<TaskIntake> = {}): TaskIntake {
  return fakeIntake(
    { taskId, category: "ui", title: PR26, expectedPaths: ["client/src/pages/admin/"] },
    {
      goal: { intent: "change_code", originalRequest: PR26, interpretedObjective: "Show hourly page views under the admin traffic chart.", workArea: "visual" },
      ...overrides,
    },
  );
}

function setup(opts: SimulationOptions & { enabled?: boolean } = {}) {
  let delivery!: FakeDelivery;
  const preview = createFakePreview();
  const sim = createSimulation({
    autoApproveCommits: false,
    preview,
    delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now, enabled: opts.enabled ?? true })),
    ...opts,
  });
  return { sim, delivery: () => delivery, preview };
}

let approvalSeq = 0;
async function decideDeploy(sim: Simulation, taskId: string, status: "approved" | "rejected" = "approved", binding?: string) {
  const check = await sim.loop.pendingApproval(taskId);
  if (!check || check.phase !== "deploy") throw new Error(`no deploy approval pending for ${taskId}`);
  const a = sim.approvals.create({ id: `deploy-${taskId}-${++approvalSeq}`, taskId, kind: "deploy", requestedAction: check.requestedAction, bindingShaOrActionId: binding ?? check.bindingShaOrActionId, expiresAt: "2026-10-05T12:00:00.000Z" });
  sim.approvals.decide(a.id, { status, decidedBy: "owner", channel: "test" });
  await sim.send({ type: status === "approved" ? "approval_granted" : "approval_rejected", taskId, phase: "deploy" });
}

async function publish(sim: Simulation, taskId: string) {
  sim.approve(taskId, "commit_publish");
  await sim.send({ type: "approval_granted", taskId, phase: "commit_publish" });
  await driveQa(sim, taskId);
}

const merges = (sim: Simulation, d: FakeDelivery) => [...sim.remote.calls, ...d.calls].filter((c) => /^MERGE/.test(c));

describe("delivery lifecycle — PR #26 regression (UI task, same lineage to production)", () => {
  it("Worker → accepted → preview → publish → PR → CI → deploy gate (not complete) → approve → merge → deploy → smoke → completed", async () => {
    const { sim, delivery, preview } = setup();
    await sim.create(uiTask("pr26"));
    await sim.loop.settle({ waitForWorkers: true });
    let t = sim.loop.task("pr26")!;
    // Implementation accepted; the preview is offered before any publication.
    expect(t).toMatchObject({ state: "awaiting_approval", approvalPhase: "commit_publish", lifecyclePhase: "preview_ready" });
    expect(t.preview).toMatchObject({ status: "ready", url: "https://cs-name-3000.app.github.dev/", visibility: "private", access: "github_sign_in" });
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH") || c.startsWith("CREATE pr"))).toEqual([]); // preview never publishes
    expect(preview.started).toBe(1);

    await publish(sim, "pr26");
    t = sim.loop.task("pr26")!;
    // CI passed: NOT completed — the same task asks the Owner about deployment.
    expect(t).toMatchObject({ state: "awaiting_approval", status: "needs_human_approval", approvalPhase: "deploy", lifecyclePhase: "awaiting_deploy_approval", deliveryTarget: "production" });
    expect(t.delivery).toMatchObject({ stage: "awaiting_deploy_approval", prNumber: t.prNumber, headSha: t.headSha, mergeSha: null });
    expect(sim.loop.tasks()).toHaveLength(1); // no second "deploy PR #xx" task
    expect(t.preview?.status).toBe("stopped"); // workspace released; preview has no audience any more
    expect(preview.calls).toContain("RELEASE pr26");
    expect(t.inFlight).toBe(false);
    const pending = await sim.loop.pendingApproval("pr26");
    expect(pending).toMatchObject({ kind: "deploy", phase: "deploy", requestedAction: "merge_and_deploy_production" });
    expect(pending!.bindingShaOrActionId).toMatch(/^deploy:[0-9a-f]{64}$/);
    expect(pending!.deployEvidence).toMatchObject({ taskId: "pr26", prNumber: t.prNumber, headSha: t.headSha, ci: { status: "passed" }, authorization: { merge: true, deploy: true, commit: false, push: false } });
    expect(merges(sim, delivery())).toEqual([]);

    await decideDeploy(sim, "pr26");
    t = sim.loop.task("pr26")!;
    expect(merges(sim, delivery())).toEqual([`MERGE pr ${t.prNumber} ${t.headSha}`]);
    expect(t).toMatchObject({ state: "complete", status: "accepted", lifecyclePhase: "completed" });
    expect(t.delivery).toMatchObject({ stage: "production_verified", mergeSha: delivery().mergeSha, deployStatus: "live", deployCommitSha: delivery().mergeSha, health: { ok: true }, smoke: { ok: true } });
    expect(sim.audit.filter((e) => e.taskId === "pr26").map((e) => e.event)).toEqual(expect.arrayContaining(["preview_ready", "delivery_merge_requested", "delivery_merged", "delivery_production_verified", "manager_accepted"]));
  });

  it("merge success + Render still deploying → not completed", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep1"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep1");
    delivery().observations = [() => ({ observer: "configured", deploy: null }), deployed("build_in_progress"), deployed("update_in_progress")];
    await decideDeploy(sim, "dep1");
    for (let i = 0; i < 3; i++) {
      const t = sim.loop.task("dep1")!;
      expect(t).toMatchObject({ state: "deploying", status: "deploying" });
      expect(["deploying", "production_verifying"]).toContain(t.lifecyclePhase);
      await sim.send({ type: "delivery_poll", taskId: "dep1" });
    }
    expect(sim.loop.task("dep1")!.state).not.toBe("complete");
    expect(delivery().verifyCount).toBe(0);
  });

  it("Render deploy failed → deployment_failed, never completed", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep2"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep2");
    delivery().observations = [deployed("build_failed")];
    await decideDeploy(sim, "dep2");
    const t = sim.loop.task("dep2")!;
    expect(t).toMatchObject({ state: "failed", status: "blocked", lifecyclePhase: "deployment_failed" });
    expect(t.delivery).toMatchObject({ stage: "deployment_failed", failure: { code: "deploy_build_failed" } });
  });

  it("Render live but on another SHA → blocked", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep3"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep3");
    // The observer reports a deployment record for the merge SHA whose commit is different (tampered / mismatched).
    delivery().observations = [() => ({ observer: "configured", deploy: { id: "dep-x", status: "live", commitSha: sha(0xdead) } })];
    await decideDeploy(sim, "dep3");
    expect(sim.loop.task("dep3")).toMatchObject({ state: "failed", status: "blocked", delivery: { stage: "blocked", failure: { code: "deployed_sha_mismatch" } } });
    expect(delivery().verifyCount).toBe(0);
  });

  it("Render live + SHA match + health fail → blocked (bounded re-checks), never completed", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep4"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep4");
    delivery().checks = [{ health: { ok: false, detail: "liveness 502" }, smoke: { ok: true, detail: "home page served" } }];
    await decideDeploy(sim, "dep4");
    expect(sim.loop.task("dep4")).toMatchObject({ state: "deploying", lifecyclePhase: "production_verifying" });
    await sim.send({ type: "delivery_poll", taskId: "dep4" });
    await sim.send({ type: "delivery_poll", taskId: "dep4" });
    expect(sim.loop.task("dep4")).toMatchObject({ state: "failed", status: "blocked", delivery: { stage: "blocked", failure: { code: "production_health_failed" } } });
    expect(delivery().verifyCount).toBe(3);
  });

  it("Render live + SHA match + health + smoke pass after a transient check failure → completed", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep5"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep5");
    delivery().checks = [{ health: { ok: true, detail: "ok" }, smoke: { ok: false, detail: "home page 503" } }, PASSING_CHECKS];
    await decideDeploy(sim, "dep5");
    expect(sim.loop.task("dep5")!.state).toBe("deploying");
    await sim.send({ type: "delivery_poll", taskId: "dep5" });
    expect(sim.loop.task("dep5")).toMatchObject({ state: "complete", status: "accepted", lifecyclePhase: "completed", delivery: { stage: "production_verified" } });
  });

  it("no trusted deployment observer configured → stays deploying (unobservable), never assumed successful", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("dep6"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep6");
    delivery().observations = [() => ({ observer: "unconfigured", deploy: null })];
    await decideDeploy(sim, "dep6");
    await sim.send({ type: "delivery_poll", taskId: "dep6" });
    expect(sim.loop.task("dep6")).toMatchObject({ state: "deploying", status: "deploying", delivery: { observerMissing: true, failure: { code: "deploy_observer_unconfigured" } } });
    expect(merges(sim, delivery())).toHaveLength(1);
    expect(delivery().verifyCount).toBe(0);
  });

  it("deployment never received within its window → blocked", async () => {
    const { sim, delivery } = setup({ policy: { deliveryWindows: { receiveWindowMs: -1, rolloutWindowMs: 0, maxCheckFailures: 3 } } });
    await sim.create(uiTask("dep7"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "dep7");
    delivery().observations = [() => ({ observer: "configured", deploy: null })];
    await decideDeploy(sim, "dep7");
    expect(sim.loop.task("dep7")).toMatchObject({ state: "failed", delivery: { stage: "blocked", failure: { code: "deploy_not_received" } } });
  });
});

describe("deploy approval binding and Owner choices", () => {
  it("Owner declines deployment → closed_without_deploy; nothing merged; never completed", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("no-dep"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "no-dep");
    await decideDeploy(sim, "no-dep", "rejected");
    expect(sim.loop.task("no-dep")).toMatchObject({ state: "closed_without_deploy", status: "blocked", lifecyclePhase: "closed_without_deploy", delivery: { stage: "closed_without_deploy" } });
    expect(merges(sim, delivery())).toEqual([]);
    expect(sim.audit.some((e) => e.taskId === "no-dep" && e.event === "task_closed_without_deploy")).toBe(true);
  });

  it("Owner declines publication → closed_without_deploy; nothing committed or pushed", async () => {
    const { sim } = setup();
    await sim.create(uiTask("no-pub"));
    await sim.loop.settle({ waitForWorkers: true });
    sim.rejectApproval("no-pub", "commit_publish");
    await sim.send({ type: "approval_rejected", taskId: "no-pub", phase: "commit_publish" });
    expect(sim.loop.task("no-pub")).toMatchObject({ state: "closed_without_deploy", lifecyclePhase: "closed_without_deploy" });
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH") || c.startsWith("CREATE pr"))).toEqual([]);
    expect(sim.commits).toEqual([]);
  });

  it("a publish approval can never authorize the deploy gate (separate scope / kind)", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("scope"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "scope");
    const check = (await sim.loop.pendingApproval("scope"))!;
    // A commit_publish-kind approval carrying the deploy binding does not authorize merge + deploy.
    const a = sim.approvals.create({ id: "wrong-kind", taskId: "scope", kind: "commit_publish", requestedAction: check.requestedAction, bindingShaOrActionId: check.bindingShaOrActionId, expiresAt: "2026-10-05T12:00:00.000Z" });
    sim.approvals.decide(a.id, { status: "approved", decidedBy: "owner", channel: "test" });
    await sim.send({ type: "approval_granted", taskId: "scope", phase: "deploy" });
    expect(sim.loop.task("scope")).toMatchObject({ state: "awaiting_approval", approvalPhase: "deploy" });
    expect(merges(sim, delivery())).toEqual([]);
  });

  it("an approval bound to other evidence (stale SHA / CI) does not authorize; the gate stays", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("stale"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "stale");
    await decideDeploy(sim, "stale", "approved", `deploy:${"0".repeat(64)}`);
    expect(sim.loop.task("stale")).toMatchObject({ state: "awaiting_approval", approvalPhase: "deploy" });
    expect(merges(sim, delivery())).toEqual([]);
  });

  it("PR head moved after the deploy approval → approval void, nothing merged", async () => {
    const { sim, delivery } = setup();
    await sim.create(uiTask("drift"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "drift");
    const t = sim.loop.task("drift")!;
    sim.remote.refs.set(t.branch!, sha(0xbeef)); // someone pushed to the PR branch
    await decideDeploy(sim, "drift");
    expect(sim.loop.task("drift")).toMatchObject({ state: "failed", status: "blocked", delivery: { stage: "blocked", failure: { code: "pr_head_moved" } } });
    expect(merges(sim, delivery())).toEqual([]);
  });

  it("deploy capability disabled → the approved gate waits (recoverable); nothing merged", async () => {
    const { sim, delivery } = setup({ enabled: false });
    await sim.create(uiTask("off"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "off");
    await decideDeploy(sim, "off");
    expect(sim.loop.task("off")).toMatchObject({ state: "awaiting_approval", status: "needs_human_approval", approvalPhase: "deploy", delivery: { failure: { code: "deploy_capability_disabled" } } });
    expect(merges(sim, delivery())).toEqual([]);
    // Enabled later: the SAME exact approval proceeds (no new task, no new approval).
    delivery().enabled = true as never;
    (delivery() as { enabled: boolean }).enabled = true;
    await sim.send({ type: "approval_granted", taskId: "off", phase: "deploy" });
    expect(sim.loop.task("off")).toMatchObject({ state: "complete", lifecyclePhase: "completed" });
  });

  it("a PR-only goal completes at the passing PR without a deploy gate", async () => {
    const { sim, delivery } = setup();
    const task = uiTask("pr-only");
    await sim.create({ ...task, goal: { ...task.goal!, deliveryTarget: "pull_request" } });
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "pr-only");
    expect(sim.loop.task("pr-only")).toMatchObject({ state: "complete", status: "accepted", deliveryTarget: "pull_request", delivery: null });
    expect(merges(sim, delivery())).toEqual([]);
  });

  it("programming (non-UI) work goes through the same deploy gate but without a preview", async () => {
    const { sim, preview } = setup();
    await sim.create(fakeIntake({ taskId: "api" }));
    await sim.loop.settle({ waitForWorkers: true });
    expect(sim.loop.task("api")).toMatchObject({ approvalPhase: "commit_publish", preview: null, lifecyclePhase: "awaiting_publish_approval" });
    await publish(sim, "api");
    expect(sim.loop.task("api")).toMatchObject({ approvalPhase: "deploy", lifecyclePhase: "awaiting_deploy_approval" });
    expect(preview.calls).toEqual([]);
  });

  it("red-risk production work: the deploy approval is its post-QA gate (shown as red)", async () => {
    const { sim } = setup();
    await sim.create(fakeIntake({ taskId: "red", actions: [{ kind: "code_edit" }, { kind: "auth_logic_change" }, { kind: "secret_read" }], category: "auth" }));
    await sim.loop.settle({ waitForWorkers: true });
    const t = sim.loop.task("red")!;
    if (t.approvalPhase === "pre_execution") {
      sim.approve("red", "pre_execution");
      await sim.send({ type: "approval_granted", taskId: "red", phase: "pre_execution" });
      await sim.loop.settle({ waitForWorkers: true });
    }
    await publish(sim, "red");
    const check = await sim.loop.pendingApproval("red");
    expect(check).toMatchObject({ phase: "deploy", kind: "deploy" });
    expect(check!.deployEvidence!.risk).toBe(sim.loop.task("red")!.risk);
  });
});

describe("preview lifecycle", () => {
  it("preview unavailable → reported, implementation not failed, the Owner still decides", async () => {
    const preview = createFakePreview({ status: "unavailable", url: null, port: null, visibility: null, access: null, reason: "dev_server_start_timeout" });
    const sim = createSimulation({ autoApproveCommits: false, preview, delivery: ({ remote, now }) => createFakeDelivery({ remote, now }) });
    await sim.create(uiTask("pv-off"));
    await sim.loop.settle({ waitForWorkers: true });
    expect(sim.loop.task("pv-off")).toMatchObject({ state: "awaiting_approval", approvalPhase: "commit_publish", lifecyclePhase: "awaiting_publish_approval", preview: { status: "unavailable", reason: "dev_server_start_timeout", url: null } });
    expect(sim.audit.some((e) => e.taskId === "pv-off" && e.event === "preview_unavailable")).toBe(true);
  });

  it("an Owner revision from the preview repairs the SAME task/branch/Worker and reuses the preview server", async () => {
    const { sim, preview } = setup();
    await sim.create(uiTask("rev"));
    await sim.loop.settle({ waitForWorkers: true });
    const before = sim.loop.task("rev")!;
    expect(before.lifecyclePhase).toBe("preview_ready");
    const head = sim.workerContracts.at(-1)!.expectedHeadSha;
    await sim.send({
      type: "publish_revision_requested",
      taskId: "rev",
      decision: { decisionId: "rev-1", escalationId: "rev.revision", taskId: "rev", branch: before.branch, expectedHeadSha: head, kind: "continue_with_guidance", guidance: "數字太小，請放大並加上單位", decidedBy: "owner" },
    });
    await sim.loop.settle({ waitForWorkers: true });
    const after = sim.loop.task("rev")!;
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls[1]).toMatchObject({ taskId: "rev", branch: before.branch, repair: true, kind: before.worker });
    expect(after).toMatchObject({ state: "awaiting_approval", approvalPhase: "commit_publish", lifecyclePhase: "preview_ready" });
    expect(after.guidanceConstraints).toHaveLength(1);
    expect(sim.loop.tasks()).toHaveLength(1);
    expect(preview.started).toBe(1); // the running preview server is reused, never doubled
    // A replayed revision is not consumed twice.
    await sim.send({ type: "publish_revision_requested", taskId: "rev", decision: { decisionId: "rev-1", escalationId: "rev.revision", taskId: "rev", branch: before.branch, expectedHeadSha: head, kind: "continue_with_guidance", guidance: "數字太小，請放大並加上單位", decidedBy: "owner" } });
    await sim.loop.settle({ waitForWorkers: true });
    expect(sim.workerCalls).toHaveLength(2);
  });

  it("a revision cannot carry approval authority and is refused outside the publish gate", async () => {
    const { sim } = setup();
    await sim.create(uiTask("rev2"));
    await sim.loop.settle({ waitForWorkers: true });
    const t = sim.loop.task("rev2")!;
    await sim.send({ type: "publish_revision_requested", taskId: "rev2", decision: { decisionId: "x", escalationId: "rev2.revision", taskId: "rev2", branch: t.branch, expectedHeadSha: sha(1), kind: "continue_with_guidance", guidance: "改顏色", decidedBy: "owner", approve: true } });
    expect(sim.workerCalls).toHaveLength(1);
    await publish(sim, "rev2");
    await sim.send({ type: "publish_revision_requested", taskId: "rev2", decision: { decisionId: "y", escalationId: "rev2.revision", taskId: "rev2", branch: t.branch, expectedHeadSha: sha(1), kind: "continue_with_guidance", guidance: "改顏色", decidedBy: "owner" } });
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.loop.task("rev2")!.approvalPhase).toBe("deploy");
  });
});

describe("restart / replay of pending delivery", () => {
  function durable() {
    const store = createMemoryStore(() => "2026-10-04T12:00:00.000Z");
    let id = 0;
    return createAuditCheckpointRepository({ audit: store.audit, nextId: () => `cp-${++id}` });
  }

  it("a pending deploy gate and a deploying task both resume after restart (no duplicate merge)", async () => {
    const persistence = durable();
    let delivery!: FakeDelivery;
    const sim = createSimulation({ autoApproveCommits: false, persistence, delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now })) });
    await sim.create(fakeIntake({ taskId: "gate", workspaceId: "ws-a" }));
    await sim.create(fakeIntake({ taskId: "rolling", workspaceId: "ws-b" }));
    await sim.loop.settle({ waitForWorkers: true });
    for (const id of ["gate", "rolling"]) await publish(sim, id);
    delivery.observations = [deployed("build_in_progress")];
    await decideDeploy(sim, "rolling");
    expect(sim.loop.task("rolling")!.state).toBe("deploying");

    // Restart: a new loop from the checkpoint with the same trusted ports.
    const loop2 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture", completion: "production_verified" });
    delivery.observations = [deployed("live")];
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("gate")).toMatchObject({ state: "awaiting_approval", approvalPhase: "deploy", lifecyclePhase: "awaiting_deploy_approval" });
    expect(loop2.task("rolling")).toMatchObject({ state: "complete", lifecyclePhase: "completed" });
    expect(merges(sim, delivery)).toHaveLength(1);
  });

  it("t261010 regression: a deploy gate persisted through the sanitizing audit store stays readable and approvable after restart", async () => {
    const persistence = durable();
    let delivery!: FakeDelivery;
    const sim = createSimulation({ autoApproveCommits: false, persistence, delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now })) });
    await sim.create(uiTask("gate"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "gate");
    const before = (await sim.loop.pendingApproval("gate"))!;
    expect(before).toMatchObject({ phase: "deploy", kind: "deploy" });

    // The durable checkpoint really carries the sanitizer sentinel (the live failure shape).
    const raw = persistence.load()!.tasks.find((t) => t.intake.taskId === "gate")!.delivery!;
    expect(raw.evidence!.authorization as unknown).toBe(REDACTED);
    expect(raw.binding).toBe(before.bindingShaOrActionId);

    const loop2 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture", completion: "production_verified" });
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("gate")).toMatchObject({ status: "needs_human_approval", state: "awaiting_approval", approvalPhase: "deploy", lifecyclePhase: "awaiting_deploy_approval" });
    const after = (await loop2.pendingApproval("gate"))!;
    expect(after).toMatchObject({ phase: "deploy", kind: "deploy", bindingShaOrActionId: before.bindingShaOrActionId });
    expect(after.deployEvidence!.authorization).toEqual({ merge: true, deploy: true, commit: false, push: false, forcePush: false, productionDatabase: false });
    expect(deployApprovalBinding(after.deployEvidence!)).toBe(before.bindingShaOrActionId);
    expect(after.deployEvidence).toEqual(before.deployEvidence);
    expect(merges(sim, delivery)).toEqual([]); // resumed at the gate only — nothing merged by the restart

    // The Owner's deploy approval is accepted after the restart: exactly one merge.
    delivery.observations = [deployed("build_in_progress")];
    const a = sim.approvals.create({ id: "deploy-after-restart", taskId: "gate", kind: "deploy", requestedAction: after.requestedAction, bindingShaOrActionId: after.bindingShaOrActionId, expiresAt: "2026-10-05T12:00:00.000Z" });
    sim.approvals.decide(a.id, { status: "approved", decidedBy: "owner", channel: "test" });
    loop2.post({ type: "approval_granted", taskId: "gate", phase: "deploy" });
    await loop2.settle();
    expect(loop2.task("gate")!.state).toBe("deploying");
    expect(merges(sim, delivery)).toHaveLength(1);

    // A second restart while deploying neither repeats the merge nor reopens the gate.
    const loop3 = createManagerLoop(sim.ports, { managerMode: "deterministic_fixture", completion: "production_verified" });
    delivery.observations = [deployed("live")];
    await loop3.resume();
    await loop3.settle();
    expect(loop3.task("gate")).toMatchObject({ state: "complete", lifecyclePhase: "completed" });
    expect(merges(sim, delivery)).toHaveLength(1);
  });

  it("a persisted deploy record outside the exact redaction case is never rehydrated (fails closed, nothing merged)", async () => {
    const persistence = durable();
    let delivery!: FakeDelivery;
    const sim = createSimulation({ autoApproveCommits: false, persistence, delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now })) });
    await sim.create(uiTask("gate"));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "gate");
    const saved = persistence.load()!;
    const tamper: [string, (d: Record<string, unknown>, e: Record<string, unknown>) => void][] = [
      ["widened authorization", (_d, e) => void (e.authorization = { ...DEPLOY_AUTHORIZATION, push: true })],
      ["arbitrary authorization", (_d, e) => void (e.authorization = "granted")],
      ["other binding", (d) => void (d.binding = `deploy:${"0".repeat(64)}`)],
      ["other head", (_d, e) => void (e.headSha = sha(9))],
      ["CI changed", (_d, e) => void (e.ci = { status: "passed", checks: [{ name: "verify", outcome: "skipped" }] })],
    ];
    for (const [name, mutate] of tamper) {
      const cp = structuredClone(saved);
      const d = cp.tasks.find((t) => t.intake.taskId === "gate")!.delivery! as unknown as Record<string, unknown>;
      mutate(d, d.evidence as Record<string, unknown>);
      const loop2 = createManagerLoop({ ...sim.ports, persistence: { load: () => cp, save: () => undefined } }, { managerMode: "deterministic_fixture", completion: "production_verified" });
      await loop2.resume();
      await loop2.settle();
      const check = await loop2.pendingApproval("gate");
      const ev = check?.deployEvidence;
      const valid = ev ? (() => { try { return deployApprovalBinding(ev) === check!.bindingShaOrActionId; } catch { return false; } })() : false;
      expect(valid, name).toBe(false);
    }
    expect(merges(sim, delivery)).toEqual([]);
  });

  it("a restart during the merge write never repeats it; the outcome is read back from GitHub", async () => {
    const persistence = durable();
    let delivery!: FakeDelivery;
    const sim = createSimulation({ autoApproveCommits: false, persistence, delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now })) });
    await sim.create(fakeIntake({ taskId: "crash" }));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "crash");
    // Simulate a crash right after the merge write: the checkpoint still says "merge in flight".
    const original = delivery.mergeApproved;
    let saved: ReturnType<NonNullable<typeof persistence.load>> = null;
    delivery.mergeApproved = async (input) => {
      const r = await original(input);
      saved = structuredClone(persistence.load());
      return r;
    };
    await decideDeploy(sim, "crash");
    expect(saved!.tasks.find((t) => t.intake.taskId === "crash")!.pendingSideEffect).toBe("merge");
    const replay = { load: () => saved, save: () => undefined };
    const loop2 = createManagerLoop({ ...sim.ports, persistence: replay }, { managerMode: "deterministic_fixture", completion: "production_verified" });
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("crash")).toMatchObject({ state: "complete", lifecyclePhase: "completed" });
    expect(merges(sim, delivery)).toHaveLength(1);
  });

  it("legacy checkpoint: a task recorded 'complete' at the passing PR reopens at the deploy gate (same task, open PR only)", async () => {
    const persistence = durable();
    let delivery!: FakeDelivery;
    // Old semantics: PR-terminal completion.
    const sim = createSimulation({ autoApproveCommits: false, persistence, policy: { completion: "pull_request" }, delivery: ({ remote, now }) => (delivery = createFakeDelivery({ remote, now })) });
    await sim.create(uiTask("legacy"));
    await sim.create(fakeIntake({ taskId: "legacy-merged", workspaceId: "ws-m" }));
    await sim.loop.settle({ waitForWorkers: true });
    await publish(sim, "legacy");
    await publish(sim, "legacy-merged");
    expect(sim.loop.task("legacy")).toMatchObject({ state: "complete", status: "accepted" });
    // Strip the delivery fields as an old checkpoint would not have them; one PR got merged by hand meanwhile.
    const old = structuredClone(persistence.load()!);
    old.tasks = old.tasks.map((t) => {
      const { delivery: _d, preview: _p, ...rest } = t;
      return rest as typeof t;
    });
    const merged = sim.loop.task("legacy-merged")!;
    sim.remote.prs.get(merged.prNumber!)!.state = "closed";
    const loop2 = createManagerLoop({ ...sim.ports, persistence: { load: () => old, save: () => undefined } }, { managerMode: "deterministic_fixture" });
    await loop2.resume();
    await loop2.settle();
    expect(loop2.task("legacy")).toMatchObject({ state: "awaiting_approval", approvalPhase: "deploy", lifecyclePhase: "awaiting_deploy_approval", prNumber: sim.loop.task("legacy")!.prNumber });
    expect(loop2.task("legacy-merged")).toMatchObject({ state: "complete", status: "accepted" });
    expect(merges(sim, delivery)).toEqual([]); // reopened only — never approved or merged automatically
    expect(loop2.tasks()).toHaveLength(2);
  });
});
