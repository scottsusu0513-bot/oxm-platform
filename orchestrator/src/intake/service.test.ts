import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../store/memory";
import { createAgentRuntimeService } from "./service";
import {
  createFakeRuntimeScheduler,
  createInMemoryIntakeRepository,
} from "./fake";
import type {
  IntakeDependencies,
  MinimalLlmClassifier,
  TaskIntakeRequest,
} from "./types";

function harness(
  shared?: {
    store: ReturnType<typeof createMemoryStore>;
    records: ReturnType<typeof createInMemoryIntakeRepository>;
    scheduler: ReturnType<typeof createFakeRuntimeScheduler>;
  },
  classifier?: MinimalLlmClassifier
) {
  let tick = 0;
  let task = 0;
  const now = () =>
    new Date(
      Date.parse("2026-10-05T00:00:00.000Z") + tick++ * 1000
    ).toISOString();
  const store = shared?.store ?? createMemoryStore(now);
  let audit = store.audit.list().length;
  const records = shared?.records ?? createInMemoryIntakeRepository();
  const scheduler = shared?.scheduler ?? createFakeRuntimeScheduler();
  const deps: IntakeDependencies = {
    ...store,
    intakeRecords: records,
    scheduler,
    workerAvailability: () => ({ claude: "available", codex: "available" }),
    nextTaskId: () => `task-${++task}`,
    nextAuditId: () => `intake-audit-${++audit}-${tick}`,
    now,
    llmClassifier: classifier,
  };
  return {
    runtime: createAgentRuntimeService(deps),
    store,
    records,
    scheduler,
    deps,
  };
}

const request = (
  overrides: Partial<TaskIntakeRequest> = {}
): TaskIntakeRequest => ({
  idempotencyKey: "req-1",
  userInstruction: "Polish the search page loading state and spacing",
  source: { type: "chat", requesterId: "user-1" },
  submittedAt: "2026-10-05T10:00:00.000Z",
  acceptanceCriteria: [
    "Search loading state remains visible until results return",
  ],
  ...overrides,
});

describe("Agent Runtime task intake", () => {
  it("deterministically persists and queues a simple UI task for Codex with no LLM", async () => {
    const classify = vi.fn();
    const h = harness(undefined, { classify });
    const result = await h.runtime.submitTask(request());
    expect(result).toMatchObject({
      outcome: "accepted",
      taskId: "task-1",
      status: { assignedWorker: "codex", risk: "green", priority: "normal" },
    });
    expect(classify).not.toHaveBeenCalled();
    expect(h.scheduler.enqueued).toHaveLength(1);
    expect(h.store.tasks.get("task-1")).toMatchObject({
      state: "queued",
      category: "layout",
      routedWorker: "codex",
      classificationPath: "deterministic",
      llmClassifierCalls: 0,
      expectedScope: ["client/"],
    });
    expect(h.records.getByTask("task-1")?.activatedIntakeCapabilities).toEqual([
      "validation",
      "normalization",
      "deterministic_classifier",
      "risk_policy",
      "priority_policy",
      "routing_policy",
      "scope_policy",
      "task_store",
      "scheduler_enqueue",
    ]);
  });

  it("routes backend/auth/general engineering to Claude and treats worker preference as advisory", async () => {
    const h = harness();
    await h.runtime.submitTask(
      request({
        idempotencyKey: "backend-1",
        userInstruction: "Add a backend API endpoint for order summaries",
        workerPreference: "codex",
      })
    );
    expect(h.scheduler.enqueued[0]).toMatchObject({
      category: "backend",
      routing: { worker: "claude", primary: "claude" },
    });
  });

  it("seeds critical priority and red approval for an explicit production incident", async () => {
    const h = harness();
    const result = await h.runtime.submitTask(
      request({
        idempotencyKey: "incident-1",
        userInstruction:
          "Production incident: delete corrupted database records in prod",
        priority: "low",
        expectedScopeHint: ["server/jobs/repair.ts"],
      })
    );
    expect(result).toMatchObject({
      outcome: "accepted",
      status: {
        priority: "critical",
        risk: "red",
        taskState: "awaiting_approval",
        approval: { required: true, phase: "pre_execution", kind: "start" },
      },
    });
    expect(h.scheduler.enqueued[0].requestedPriority).toBe("low");
  });

  it("requires clarification for a non-actionable or ambiguous destructive request and creates no task", async () => {
    const h = harness();
    const vague = await h.runtime.submitTask(
      request({ idempotencyKey: "vague-1", userInstruction: "Fix it" })
    );
    const destructive = await h.runtime.submitTask(
      request({ idempotencyKey: "vague-2", userInstruction: "Delete that" })
    );
    expect(vague).toMatchObject({ outcome: "needs_clarification" });
    expect(destructive).toMatchObject({ outcome: "needs_clarification" });
    expect(h.scheduler.enqueued).toHaveLength(0);
    expect(h.store.tasks.get("task-1")).toBeNull();
  });

  it("returns the same task for an identical idempotency key without enqueueing twice", async () => {
    const h = harness();
    const first = await h.runtime.submitTask(request());
    const second = await h.runtime.submitTask(
      request({
        submittedAt: "2026-10-05T10:01:00.000Z",
        requestId: "retry-attempt",
      })
    );
    expect(first).toMatchObject({ outcome: "accepted", taskId: "task-1" });
    expect(second).toMatchObject({ outcome: "duplicate", taskId: "task-1" });
    expect(h.scheduler.enqueued).toHaveLength(1);
  });

  it("serializes concurrent submissions around the durable idempotency binding", async () => {
    const h = harness();
    const results = await Promise.all([
      h.runtime.submitTask(request()),
      h.runtime.submitTask(request()),
    ]);
    expect(results.map(result => result.outcome).sort()).toEqual([
      "accepted",
      "duplicate",
    ]);
    expect(
      results.map(result => ("taskId" in result ? result.taskId : null))
    ).toEqual(["task-1", "task-1"]);
    expect(h.scheduler.enqueued).toHaveLength(1);
  });

  it("rejects an idempotency key reused with materially changed input", async () => {
    const h = harness();
    await h.runtime.submitTask(request());
    const changed = await h.runtime.submitTask(
      request({ userInstruction: "Add a backend endpoint" })
    );
    expect(changed).toMatchObject({
      outcome: "rejected",
      reasonCode: "idempotency_conflict",
    });
    expect(h.scheduler.enqueued).toHaveLength(1);
  });

  it.each([
    ["/etc/passwd"],
    ["../server/a.ts"],
    ["server/*.ts"],
    ["."],
    ["server\\a.ts"],
  ])("rejects unsafe scope hint %s", async path => {
    const h = harness();
    const result = await h.runtime.submitTask(
      request({ expectedScopeHint: [path] })
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reasonCode: "unsafe_scope",
    });
    expect(h.scheduler.enqueued).toHaveLength(0);
  });

  it("answers status without invoking an LLM or worker", async () => {
    const classify = vi.fn();
    const h = harness(undefined, { classify });
    await h.runtime.submitTask(request());
    classify.mockClear();
    const before = h.scheduler.enqueued.length;
    expect(h.runtime.getTaskStatus("task-1")).toMatchObject({
      taskId: "task-1",
      title: expect.any(String),
      qaState: null,
      headSha: null,
    });
    expect(classify).not.toHaveBeenCalled();
    expect(h.scheduler.enqueued).toHaveLength(before);
  });

  it("pauses a queued task without changing TaskState", async () => {
    const h = harness();
    await h.runtime.submitTask(request());
    const result = h.runtime.pauseTask("task-1");
    expect(result).toMatchObject({
      orchestrationStatus: "paused",
      taskState: "queued",
    });
    expect(h.scheduler.pauseCalls).toEqual(["task-1"]);
  });

  it("cancels a queued task while preserving records and audit", async () => {
    const h = harness();
    await h.runtime.submitTask(request());
    expect(h.runtime.cancelTask("task-1")).toMatchObject({
      orchestrationStatus: "cancelled",
      taskState: "cancelled",
    });
    expect(h.records.getByTask("task-1")).not.toBeNull();
    expect(
      h.store.audit.list({ taskId: "task-1" }).map(e => e.event)
    ).toContain("task_cancel_requested");
  });

  it("requests running worker cancellation without deleting branch or PR", async () => {
    const h = harness();
    await h.runtime.submitTask(request());
    h.scheduler.setRunning("task-1", true);
    h.store.tasks.update("task-1", {
      branch: "agent/task-task-1-ui",
      prNumber: 42,
    });
    h.runtime.cancelTask("task-1");
    expect(h.scheduler.cancelCalls).toEqual(["task-1"]);
    expect(h.store.tasks.get("task-1")).toMatchObject({
      branch: "agent/task-task-1-ui",
      prNumber: 42,
    });
    expect(
      h.store.audit.list({ taskId: "task-1" }).at(-1)?.metadata
    ).toMatchObject({ cancellationRequested: true });
  });

  it("survives service recreation without changing task, worker, or enqueue intent", async () => {
    const first = harness();
    await first.runtime.submitTask(request());
    const recreated = harness({
      store: first.store,
      records: first.records,
      scheduler: first.scheduler,
    });
    const result = await recreated.runtime.submitTask(
      request({ submittedAt: "2026-10-05T11:00:00.000Z" })
    );
    expect(result).toMatchObject({
      outcome: "duplicate",
      taskId: "task-1",
      status: { assignedWorker: "codex" },
    });
    expect(first.scheduler.enqueued).toHaveLength(1);
  });

  it("rejects implementation-shaped acceptance criteria and unsupported capabilities", async () => {
    const h = harness();
    await expect(
      h.runtime.submitTask(
        request({ acceptanceCriteria: ["Add useEffect in Search.tsx"] })
      )
    ).resolves.toMatchObject({
      outcome: "rejected",
      reasonCode: "implementation_acceptance",
    });
    await expect(
      h.runtime.submitTask(
        request({ idempotencyKey: "merge-1", userInstruction: "Merge the PR" })
      )
    ).resolves.toMatchObject({
      outcome: "rejected",
      reasonCode: "unsupported_capability",
    });
  });

  it("keeps audit metadata sanitized and excludes raw instruction text", async () => {
    const h = harness();
    await h.runtime.submitTask(request());
    for (const event of h.store.audit.list()) {
      expect(JSON.stringify(event.metadata)).not.toContain(
        "Search loading state remains"
      );
      expect(JSON.stringify(event.metadata)).not.toContain(
        "Polish the search page"
      );
    }
  });
});
