import { describe, expect, it, vi } from "vitest";
import { createFakeRuntimeScheduler, createInMemoryIntakeRepository } from "../intake/fake";
import { createAgentRuntimeService } from "../intake/service";
import type { IntakeDependencies } from "../intake/types";
import { approvalAuthorizes } from "../store/repositories";
import { createMemoryStore } from "../store/memory";
import { GatewayError } from "./errors";
import {
  createFakeAuthenticator,
  createFakeGatewayAudit,
  createFakeGatewayEvents,
  createFakeRateLimiter,
  createInMemoryGatewayDecisionRepository,
  fakePrincipal,
} from "./fake";
import { createAgentGatewayService } from "./service";
import type {
  GatewayCapability,
  PendingApprovalRequirement,
} from "./types";

const BASE = Date.parse("2026-10-05T00:10:00.000Z");

function harness(options: {
  denied?: Parameters<typeof createFakeRateLimiter>[0];
  shared?: ReturnType<typeof baseState>;
} = {}) {
  const state = options.shared ?? baseState();
  const audit = createFakeGatewayAudit();
  const events = createFakeGatewayEvents();
  const requirements = new Map<string, PendingApprovalRequirement>();
  const caps: GatewayCapability[] = [
    "task:submit",
    "task:read",
    "task:pause",
    "task:cancel",
    "approval:read",
    "approval:grant",
    "approval:reject",
  ];
  const authenticator = createFakeAuthenticator({
    operator: fakePrincipal({ principalId: "operator-1", capabilities: caps }),
    reader: fakePrincipal({
      principalId: "reader-1",
      capabilities: ["task:read", "approval:read"],
    }),
    submitter: fakePrincipal({
      principalId: "submitter-1",
      capabilities: ["task:submit", "task:read"],
    }),
    empty: fakePrincipal({ principalId: "empty-1", capabilities: [] }),
  });
  const service = createAgentGatewayService({
    authenticator,
    runtime: state.runtime,
    approvals: state.store.approvals,
    approvalRequirements: {
      async current(taskId) {
        return requirements.get(taskId) ?? null;
      },
    },
    decisions: state.decisions,
    events,
    rateLimiter: createFakeRateLimiter(options.denied),
    audit,
    now: () => new Date(state.time).toISOString(),
  });
  const call = (token: string, request: unknown, requestId = `request-${++state.request}`) => ({
    authentication: {
      credentials: { token },
      requestId,
      source: "test-client",
    },
    request,
  });
  return { ...state, state, service, call, audit, events, requirements };
}

function baseState() {
  let time = BASE;
  let task = 0;
  let audit = 0;
  const now = () => new Date(time).toISOString();
  const store = createMemoryStore(now);
  const records = createInMemoryIntakeRepository();
  const scheduler = createFakeRuntimeScheduler();
  const deps: IntakeDependencies = {
    ...store,
    intakeRecords: records,
    scheduler,
    workerAvailability: () => ({ claude: "available", codex: "available" }),
    nextTaskId: () => `task-${++task}`,
    nextAuditId: () => `intake-audit-${++audit}`,
    now,
  };
  return {
    get time() { return time; },
    set time(value: number) { time = value; },
    request: 0,
    store,
    records,
    scheduler,
    decisions: createInMemoryGatewayDecisionRepository(),
    runtime: createAgentRuntimeService(deps),
  };
}

const submit = (idempotencyKey = "submit-1") => ({
  idempotencyKey,
  userInstruction: "Polish the search page loading state and spacing",
  acceptanceCriteria: ["Loading remains visible until results return"],
});

async function accepted(h: ReturnType<typeof harness>, key = "submit-1") {
  return h.service.submitTask(h.call("submitter", submit(key)));
}

async function redTask(h: ReturnType<typeof harness>) {
  const result = await h.service.submitTask(
    h.call("operator", {
      idempotencyKey: "red-submit",
      userInstruction: "Production incident: delete corrupted database records in prod",
      expectedScopeHint: ["server/jobs/repair.ts"],
      acceptanceCriteria: ["Only corrupted records are removed"],
    }),
  );
  const requirement: PendingApprovalRequirement = {
    approvalRequestId: "approval-red-1",
    taskId: result.taskId,
    kind: "start",
    phase: "pre_execution",
    risk: "red",
    action: "start",
    bindingTarget: `contract:${result.taskId}:sha-a`,
    requestedAt: "2026-10-05T00:00:00.000Z",
    expiresAt: "2026-10-05T01:00:00.000Z",
    status: "pending",
    reasonSummary: "Red task requires approval",
  };
  h.requirements.set(result.taskId, requirement);
  return requirement;
}

const decisionBody = (r: PendingApprovalRequirement, idempotencyKey = "decision-1") => ({
  taskId: r.taskId,
  idempotencyKey,
  approvalRequestId: r.approvalRequestId,
  kind: r.kind,
  phase: r.phase,
  action: r.action,
  bindingTarget: r.bindingTarget,
});

describe("AgentGatewayService authentication, task control, and safety", () => {
  it("allows an authenticated submitter, preserves intake idempotency, and makes no LLM call", async () => {
    const h = harness();
    const first = await accepted(h);
    const second = await accepted(h);
    expect(first).toMatchObject({ taskId: "task-1", duplicate: false });
    expect(second).toMatchObject({ taskId: "task-1", duplicate: true });
    expect(h.scheduler.enqueued).toHaveLength(1);
    expect(h.store.tasks.get("task-1")?.llmClassifierCalls).toBe(0);
  });

  it("rejects unauthenticated and authenticated-but-unauthorized submissions", async () => {
    const h = harness();
    await expect(h.service.submitTask(h.call("bad", submit()))).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(h.service.submitTask(h.call("empty", submit()))).rejects.toMatchObject({ code: "forbidden" });
    expect(h.scheduler.enqueued).toHaveLength(0);
  });

  it("returns only sanitized structured status and performs no Worker/LLM/Codespace action", async () => {
    const h = harness();
    await accepted(h);
    const enqueueCount = h.scheduler.enqueued.length;
    const status = await h.service.getTaskStatus(h.call("reader", { taskId: "task-1" }));
    expect(status).toMatchObject({ taskId: "task-1", assignedWorker: "codex", approvalRequired: false });
    expect(Object.keys(status)).not.toContain("title");
    expect(JSON.stringify(status)).not.toContain("Polish the search");
    expect(h.scheduler.enqueued).toHaveLength(enqueueCount);
    expect(h.scheduler.pauseCalls).toEqual([]);
    expect(h.scheduler.cancelCalls).toEqual([]);
  });

  it("pauses and cancels through AgentRuntimeService while read-only callers cannot mutate", async () => {
    const pause = harness();
    await accepted(pause);
    await expect(pause.service.pauseTask(pause.call("reader", { taskId: "task-1", idempotencyKey: "pause-1" }))).rejects.toMatchObject({ code: "forbidden" });
    expect(await pause.service.pauseTask(pause.call("operator", { taskId: "task-1", idempotencyKey: "pause-1" }))).toMatchObject({ status: "paused" });
    expect(pause.scheduler.pauseCalls).toEqual(["task-1"]);

    const cancel = harness();
    await accepted(cancel);
    await expect(cancel.service.cancelTask(cancel.call("reader", { taskId: "task-1", idempotencyKey: "cancel-1" }))).rejects.toMatchObject({ code: "forbidden" });
    expect(await cancel.service.cancelTask(cancel.call("operator", { taskId: "task-1", idempotencyKey: "cancel-1" }))).toMatchObject({ taskState: "cancelled" });
    expect(cancel.scheduler.cancelCalls).toEqual(["task-1"]);
  });

  it("fails closed when a mutation is rate limited", async () => {
    const h = harness({ denied: ["task_submit"] });
    await expect(accepted(h)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(h.scheduler.enqueued).toHaveLength(0);
  });

  it("strictly rejects unknown fields and source identity injection", async () => {
    const h = harness();
    await expect(h.service.submitTask(h.call("submitter", { ...submit(), source: { requesterId: "admin" } }))).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("AgentGatewayService trusted approvals", () => {
  it("reads the exact current requirement without exposing secret material", async () => {
    const h = harness();
    const requirement = await redTask(h);
    const result = await h.service.getPendingApproval(h.call("reader", { taskId: requirement.taskId }));
    expect(result).toEqual({
      result: "pending",
      approval: {
        ...requirement,
        reasonSummary: "pre_execution approval required for start",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/rawText|prompt|token|stdout|secret/i);
  });

  it("stores a trusted exact-bound approval, re-evaluates once, and satisfies approvalAuthorizes", async () => {
    const h = harness();
    const requirement = await redTask(h);
    const result = await h.service.approveTask(h.call("operator", decisionBody(requirement)));
    const stored = h.store.approvals.get(result.approvalId)!;
    expect(stored).toMatchObject({ status: "approved", decidedBy: "operator-1", channel: "test" });
    expect(approvalAuthorizes(stored, {
      taskId: requirement.taskId,
      kind: requirement.kind,
      bindingShaOrActionId: requirement.bindingTarget,
      at: new Date(h.state.time).toISOString(),
    })).toEqual({ ok: true });
    expect(h.events.events.filter((e) => e.type === "task_re_evaluate_requested")).toHaveLength(1);
  });

  it("a forged re-evaluation event without a stored approval cannot authorize", async () => {
    const h = harness();
    const requirement = await redTask(h);
    h.events.reEvaluateApproval(requirement.taskId, requirement.phase, "approved");
    expect(h.store.approvals.listByTask(requirement.taskId)).toEqual([]);
  });

  it.each([
    ["old SHA", { bindingTarget: "contract:task-1:sha-old" }],
    ["wrong task", { taskId: "task-other" }],
    ["wrong kind", { kind: "merge" }],
    ["wrong phase", { phase: "post_qa" }],
    ["wrong action", { action: "complete_post_qa" }],
  ])("rejects stale binding: %s", async (_label, changed) => {
    const h = harness();
    const requirement = await redTask(h);
    await expect(
      h.service.approveTask(h.call("operator", { ...decisionBody(requirement), ...changed })),
    ).rejects.toMatchObject({ code: changed.taskId ? "not_found" : "stale_binding" });
    expect(h.store.approvals.listByTask(requirement.taskId)).toEqual([]);
  });

  it("makes identical retries idempotent and conflicts on a changed decision", async () => {
    const h = harness();
    const requirement = await redTask(h);
    const body = decisionBody(requirement);
    expect(await h.service.approveTask(h.call("operator", body))).toMatchObject({ duplicate: false });
    expect(await h.service.approveTask(h.call("operator", body))).toMatchObject({ duplicate: true });
    expect(h.store.approvals.listByTask(requirement.taskId)).toHaveLength(1);
    expect(h.events.events.filter((e) => e.type === "task_re_evaluate_requested")).toHaveLength(1);
    await expect(h.service.rejectTask(h.call("operator", body))).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("stores rejection as trusted evidence that cannot authorize", async () => {
    const h = harness();
    const requirement = await redTask(h);
    const result = await h.service.rejectTask(h.call("operator", decisionBody(requirement)));
    const stored = h.store.approvals.get(result.approvalId)!;
    expect(stored.status).toBe("rejected");
    expect(approvalAuthorizes(stored, {
      taskId: requirement.taskId,
      kind: requirement.kind,
      bindingShaOrActionId: requirement.bindingTarget,
      at: new Date(h.state.time).toISOString(),
    }).ok).toBe(false);
  });

  it("rejects expired requirements and rate-limited approval attempts", async () => {
    const expired = harness();
    const requirement = await redTask(expired);
    expired.state.time = Date.parse("2026-10-05T02:00:00.000Z");
    await expect(expired.service.approveTask(expired.call("operator", decisionBody(requirement)))).rejects.toMatchObject({ code: "approval_expired" });

    const limited = harness({ denied: ["approval_mutate"] });
    const current = await redTask(limited);
    await expect(limited.service.approveTask(limited.call("operator", decisionBody(current)))).rejects.toMatchObject({ code: "rate_limited" });
    expect(limited.store.approvals.listByTask(current.taskId)).toEqual([]);
  });

  it("retains approval and decision idempotency across service recreation", async () => {
    const first = harness();
    const requirement = await redTask(first);
    const body = decisionBody(requirement);
    const initial = await first.service.approveTask(first.call("operator", body));
    const restarted = harness({ shared: first.state });
    restarted.requirements.set(requirement.taskId, requirement);
    const retry = await restarted.service.approveTask(restarted.call("operator", body));
    expect(retry).toMatchObject({ approvalId: initial.approvalId, duplicate: true });
    expect(first.store.approvals.listByTask(requirement.taskId)).toHaveLength(1);
    expect(restarted.events.events).toEqual([]);
  });
});
