import { describe, expect, it } from "vitest";
import type { AgentRuntimeService, AgentTaskStatus } from "../intake/types";
import type { HumanDecisionInput } from "../manager/types";
import { createSimulation, fakeIntake, type Simulation, type WorkerScript } from "../scheduler/fake";
import { createMemoryStore } from "../store/memory";
import { GatewayError } from "./errors";
import {
  createFakeAuthenticator,
  createFakeGatewayAudit,
  createFakeRateLimiter,
  createInMemoryGatewayDecisionRepository,
  createInMemoryHumanDecisionRepository,
  fakePrincipal,
} from "./fake";
import { createManagerHumanDecisionReader, createManagerLoopGatewayEvents } from "./integration";
import { createAgentGatewayService } from "./service";
import { authenticateAndAuthorize } from "./auth";
import { isValidPrincipalId, MAX_PRINCIPAL_ID_LENGTH } from "../domain/types";
import { normalizeHumanDecision } from "../manager/humanDecision";
import type { AuthContext, GatewayControlEventPort } from "./types";

/**
 * Authenticated Gateway path for needs_human_decision. The caller supplies
 * only escalationId, idempotencyKey and guidance; everything bound comes from
 * trusted Manager state and the authenticated session.
 */

const NOW = "2026-10-05T00:10:00.000Z";
const GUIDANCE = "The fixture expects UTC timestamps; normalize dates to UTC before comparing.";
const FAIL3: WorkerScript[] = ["validation_failed", "validation_failed", "validation_failed"];

function principal(id: string, type: AuthContext["principalType"], caps: AuthContext["capabilities"]) {
  return { ...fakePrincipal({ principalId: id, capabilities: caps, now: NOW }), principalType: type };
}

const LONG_ID = `p${"x".repeat(MAX_PRINCIPAL_ID_LENGTH - 1)}`;
const TOO_LONG_ID = `${LONG_ID}x`;

async function setup(taskId: string, worker: WorkerScript[] = [...FAIL3, "success"]) {
  const sim = createSimulation({ worker: { [taskId]: worker }, autoApproveCommits: false });
  await sim.create(fakeIntake({ taskId }));
  expect(sim.loop.task(taskId)!.status).toBe("needs_human_decision");
  const store = createMemoryStore(() => NOW);
  const runtime = {
    getTaskStatus: (id: string) => {
      const snap = sim.loop.task(id);
      return snap ? ({ taskId: id, taskState: snap.state } as unknown as AgentTaskStatus) : null;
    },
  } as unknown as AgentRuntimeService;
  const emitted: { taskId: string; decision: HumanDecisionInput }[] = [];
  const loopEvents = createManagerLoopGatewayEvents(sim.loop);
  const events: GatewayControlEventPort = {
    ...loopEvents,
    humanDecisionSubmitted(id, decision) {
      emitted.push({ taskId: id, decision: structuredClone(decision) });
      loopEvents.humanDecisionSubmitted(id, decision);
    },
  };
  const audit = createFakeGatewayAudit();
  const gateway = createAgentGatewayService({
    authenticator: createFakeAuthenticator({
      operator: principal("operator-1", "operator", ["human_decision:read", "human_decision:submit"]),
      requester: principal("requester-1", "user", ["human_decision:read", "human_decision:submit"]),
      stranger: principal("stranger-1", "user", ["human_decision:read", "human_decision:submit"]),
      service: principal("svc-1", "service", ["human_decision:read", "human_decision:submit"]),
      approver: principal("approver-1", "operator", ["approval:grant", "approval:read", "task:read"]),
      longest: principal(LONG_ID, "operator", ["human_decision:read", "human_decision:submit"]),
      overlong: principal(TOO_LONG_ID, "operator", ["human_decision:read", "human_decision:submit"]),
    }),
    runtime,
    approvals: store.approvals,
    approvalRequirements: { current: async () => null },
    decisions: createInMemoryGatewayDecisionRepository(),
    events,
    rateLimiter: createFakeRateLimiter(),
    audit,
    now: () => NOW,
    humanDecisionRequirements: createManagerHumanDecisionReader(sim.loop, (id) => (id === taskId ? "requester-1" : null)),
    humanDecisionSubmissions: createInMemoryHumanDecisionRepository(),
  });
  const call = (token: string, request: unknown, requestId = `req-${Math.random().toString(16).slice(2)}`) => ({
    authentication: { credentials: { token }, requestId, source: "phone" },
    request,
  });
  const escalationId = sim.loop.task(taskId)!.humanDecisionRequest!.escalationId;
  return { sim, gateway, call, emitted, audit, escalationId, store };
}

const gwError = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof GatewayError) return { code: e.code, status: e.status };
    throw e;
  }
  throw new Error("expected a GatewayError");
};
const settle = (sim: Simulation) => sim.loop.settle();

describe("gateway human decision — submission", () => {
  it("an authenticated operator submission emits exactly one human_decision_submitted bound to trusted state, and the task resumes", async () => {
    const { sim, gateway, call, emitted, escalationId } = await setup("gw1");
    const snap = sim.loop.task("gw1")!;
    const res = await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k-1", guidance: `  ${GUIDANCE}\n` }));
    expect(res).toMatchObject({ taskId: "gw1", escalationId, result: "submitted", duplicate: false });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].decision).toEqual({
      decisionId: res.decisionId,
      escalationId,
      taskId: "gw1",
      branch: snap.branch,
      expectedHeadSha: snap.humanDecisionRequest!.expectedHeadSha,
      kind: "continue_with_guidance",
      guidance: GUIDANCE,
      decidedBy: "operator-1",
    });
    await settle(sim);
    const t = sim.loop.task("gw1")!;
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ decisionId: res.decisionId, outcome: "accepted" });
    expect(t.repairCycles.at(-1)?.diagnosis.humanDecision?.decidedBy).toBe("operator-1");
    expect(sim.workerCalls).toHaveLength(4);
  });

  it("the task requester may decide; other users, service principals and unauthenticated callers may not", async () => {
    const { gateway, call, emitted, escalationId } = await setup("gw2");
    const body = (k: string) => ({ escalationId, idempotencyKey: k, guidance: GUIDANCE });
    expect(await gwError(gateway.submitHumanDecision(call("nobody", body("a"))))).toEqual({ code: "unauthenticated", status: 401 });
    expect(await gwError(gateway.submitHumanDecision(call("approver", body("b"))))).toEqual({ code: "forbidden", status: 403 }); // lacks capability
    expect(await gwError(gateway.submitHumanDecision(call("service", body("c"))))).toEqual({ code: "forbidden", status: 403 });
    expect(await gwError(gateway.submitHumanDecision(call("stranger", body("d"))))).toEqual({ code: "forbidden", status: 403 });
    expect(emitted).toEqual([]);
    const ok = await gateway.submitHumanDecision(call("requester", body("e")));
    expect(ok.duplicate).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it.each([
    ["taskId", { taskId: "other" }],
    ["branch", { branch: "agent/task-other" }],
    ["expectedHeadSha", { expectedHeadSha: "e".repeat(40) }],
    ["lineageId", { lineageId: "x" }],
    ["decidedBy", { decidedBy: "someone-else" }],
    ["kind", { kind: "approve_commit" }],
    ["approval", { approval: "approved" }],
    ["approveCommit", { approveCommit: true }],
    ["merge", { merge: true }],
    ["deploy", { deploy: true }],
  ])("the caller cannot supply the trusted field %s", async (_field, extra) => {
    const { gateway, call, emitted, escalationId } = await setup("gw3");
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: GUIDANCE, ...extra })))).toEqual({ code: "invalid_request", status: 400 });
    expect(emitted).toEqual([]);
  });

  it("duplicate submission is idempotent; the same key with different content conflicts", async () => {
    const { sim, gateway, call, emitted, escalationId } = await setup("gw4");
    const body = { escalationId, idempotencyKey: "k-dup", guidance: GUIDANCE };
    const first = await gateway.submitHumanDecision(call("operator", body));
    const second = await gateway.submitHumanDecision(call("operator", body));
    expect(second).toMatchObject({ decisionId: first.decisionId, duplicate: true });
    expect(emitted).toHaveLength(1);
    expect(await gwError(gateway.submitHumanDecision(call("operator", { ...body, guidance: "different text" })))).toEqual({ code: "idempotency_conflict", status: 409 });
    await settle(sim);
    expect(sim.loop.task("gw4")!.humanRound).toBe(2);
    expect(sim.workerCalls).toHaveLength(4);
  });

  it("stale, closed, unknown and cancelled escalations are rejected without an event", async () => {
    const { sim, gateway, call, emitted, escalationId } = await setup("gw5", ["validation_failed"]);
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId: "missing-task.hd.1", idempotencyKey: "k0", guidance: GUIDANCE })))).toEqual({ code: "not_found", status: 404 });
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId: "gw5", idempotencyKey: "k0", guidance: GUIDANCE })))).toEqual({ code: "invalid_request", status: 400 });
    await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k1", guidance: GUIDANCE }));
    await settle(sim);
    // Round 2 failed again: a new escalation is open, the round-1 id is stale.
    expect(sim.loop.task("gw5")!.humanDecisionRequest?.escalationId).toBe("gw5.hd.2");
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k2", guidance: GUIDANCE })))).toEqual({ code: "stale_binding", status: 409 });
    sim.loop.cancel("gw5");
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId: "gw5.hd.2", idempotencyKey: "k3", guidance: GUIDANCE })))).toEqual({ code: "conflict", status: 409 });
    expect(emitted).toHaveLength(1);
  });

  it("guidance is sanitized and credential-looking guidance is rejected", async () => {
    const { gateway, call, emitted, escalationId } = await setup("gw6");
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: "use ghp_0123456789abcdefghijABCDEFGHIJ0123456789" })))).toEqual({ code: "invalid_request", status: 400 });
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: "   " })))).toEqual({ code: "invalid_request", status: 400 });
    expect(await gwError(gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: "x".repeat(601) })))).toEqual({ code: "invalid_request", status: 400 });
    expect(emitted).toEqual([]);
    await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: "line one\n\tline\u0007two" }));
    expect(emitted[0].decision.guidance).toBe("line one line two");
  });

  it("a human decision grants no commit/push/merge/deploy authority", async () => {
    const { sim, gateway, call, store, escalationId } = await setup("gw7");
    await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: GUIDANCE }));
    await settle(sim);
    const t = sim.loop.task("gw7")!;
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(store.approvals.listByTask("gw7")).toEqual([]);
    expect(sim.approvals.listByTask("gw7")).toEqual([]);
    expect(sim.commits).toEqual([]);
    expect(sim.remote.calls.filter((c) => /PUSH|CREATE pr|merge|deploy/i.test(c))).toEqual([]);
  });
});

describe("gateway human decision — sanitized status", () => {
  it("exposes why input is needed, the request id, blocker, recommendation and requested input — without trusted binding data", async () => {
    const { sim, gateway, call, escalationId, audit } = await setup("gw8");
    const status = await gateway.getHumanDecision(call("operator", { taskId: "gw8" }));
    expect(status.lastOutcome).toBeNull();
    expect(status.pending).toMatchObject({
      escalationId,
      taskId: "gw8",
      round: 1,
      cyclesCompleted: 2,
      currentBlocker: { failureCode: "validation_failed", failingCheck: "validation:tests" },
      fingerprintTrend: "stagnated",
      grantsApproval: false,
    });
    expect(status.pending!.whyNeeded).toContain("needs_human_decision");
    expect(status.pending!.managerRecommendation.length).toBeGreaterThan(0);
    expect(status.pending!.inputRequested).toContain(escalationId);
    const text = JSON.stringify(status);
    const snap = sim.loop.task("gw8")!;
    expect(text).not.toContain(snap.humanDecisionRequest!.expectedHeadSha);
    expect(text).not.toContain(snap.branch!);
    expect(audit.events.some((e) => e.event === "human_decision_viewed")).toBe(true);
    expect(await gwError(gateway.getHumanDecision(call("approver", { taskId: "gw8" })))).toEqual({ code: "forbidden", status: 403 });
  });

  it("reports accepted, duplicate and stale outcomes", async () => {
    const { sim, gateway, call, escalationId } = await setup("gw9");
    const res = await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: GUIDANCE }));
    await settle(sim);
    let status = await gateway.getHumanDecision(call("operator", { taskId: "gw9" }));
    expect(status.pending).toBeNull();
    expect(status.lastOutcome).toMatchObject({ decisionId: res.decisionId, outcome: "accepted" });
    // A replayed loop event (e.g. redelivery) is a duplicate.
    sim.loop.post({ type: "human_decision_submitted", taskId: "gw9", decision: { decisionId: res.decisionId, escalationId, taskId: "gw9", branch: "b", expectedHeadSha: "a".repeat(40), kind: "continue_with_guidance", guidance: GUIDANCE, decidedBy: "operator-1" } });
    await settle(sim);
    status = await gateway.getHumanDecision(call("operator", { taskId: "gw9" }));
    expect(status.lastOutcome?.outcome).toBe("duplicate");
    sim.loop.post({ type: "human_decision_submitted", taskId: "gw9", decision: { decisionId: "hd-other", escalationId, taskId: "gw9", branch: "b", expectedHeadSha: "a".repeat(40), kind: "continue_with_guidance", guidance: GUIDANCE, decidedBy: "operator-1" } });
    await settle(sim);
    status = await gateway.getHumanDecision(call("operator", { taskId: "gw9" }));
    expect(status.lastOutcome?.outcome).toBe("stale");
  });
});

describe("canonical principal id rule", () => {
  it("a max-length (128) principal is accepted end-to-end: Gateway -> event -> Manager -> diagnosis", async () => {
    expect(LONG_ID).toHaveLength(MAX_PRINCIPAL_ID_LENGTH);
    const { sim, gateway, call, emitted, escalationId } = await setup("gwl1");
    await gateway.submitHumanDecision(call("longest", { escalationId, idempotencyKey: "k", guidance: GUIDANCE }));
    expect(emitted[0].decision.decidedBy).toBe(LONG_ID);
    await settle(sim);
    const t = sim.loop.task("gwl1")!;
    expect(t.humanDecisionLog.at(-1)?.outcome).toBe("accepted");
    expect(t.repairCycles.at(-1)?.diagnosis.humanDecision?.decidedBy).toBe(LONG_ID);
  });

  it("an over-limit principal is rejected at the Gateway, before any event", async () => {
    const { gateway, call, emitted, escalationId } = await setup("gwl2");
    expect(await gwError(gateway.submitHumanDecision(call("overlong", { escalationId, idempotencyKey: "k", guidance: GUIDANCE })))).toEqual({ code: "unauthenticated", status: 401 });
    expect(emitted).toEqual([]);
  });

  it("Gateway authentication and Manager decision normalization apply the identical principal rule", async () => {
    const decision = (decidedBy: string) => ({ decisionId: "hd-1", escalationId: "t.hd.1", taskId: "t", branch: "agent/task-t-x", expectedHeadSha: "a".repeat(40), kind: "continue_with_guidance", guidance: GUIDANCE, decidedBy });
    for (const id of ["a", "a".repeat(64), "a".repeat(65), "a".repeat(127), "a".repeat(128), "a".repeat(129), "a b", "-a", "a/b", "user:42@x"]) {
      const authenticator = createFakeAuthenticator({ t: principal(id, "operator", ["human_decision:submit"]) });
      const gatewayOk = await authenticateAndAuthorize({ authenticator, authentication: { credentials: { token: "t" }, requestId: "r", source: "s" }, capability: "human_decision:submit", audit: createFakeGatewayAudit(), action: "x" }).then(() => true, () => false);
      const managerOk = normalizeHumanDecision(decision(id)).ok;
      expect(managerOk, id).toBe(gatewayOk);
      expect(isValidPrincipalId(id), id).toBe(gatewayOk);
    }
  });

  it("a 64-character task id still yields a resumable escalation (escalation id > 64 chars)", async () => {
    const taskId = `t${"a".repeat(63)}`;
    const { sim, gateway, call, escalationId } = await setup(taskId);
    expect(escalationId.length).toBeGreaterThan(64);
    await gateway.submitHumanDecision(call("operator", { escalationId, idempotencyKey: "k", guidance: GUIDANCE }));
    await settle(sim);
    expect(sim.loop.task(taskId)!.humanDecisionLog.at(-1)?.outcome).toBe("accepted");
  });
});
