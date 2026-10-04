import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../store/memory";
import { workerFinishIntent, workerStartIntent } from "./lifecycle";
import type { WorkerResult } from "./types";

const HASH = "f".repeat(64);
const result = (over: Partial<WorkerResult> = {}): WorkerResult => ({
  status: "success",
  summary: "done",
  filesChanged: ["server/db.ts"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: "agent/x",
  headSha: "a".repeat(40),
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  workerErrorCode: null,
  ...over,
});
const finish = (r: WorkerResult, currentState: "running" | "queued" | "complete" = "running", riskLevel: "green" | "yellow" | "red" = "green") =>
  workerFinishIntent({
    currentState,
    riskLevel,
    taskId: "t1",
    runId: "r1",
    result: r,
    endedAt: "2026-10-04T01:00:00.000Z",
  });

describe("workerStartIntent", () => {
  const base = {
    riskLevel: "green" as const,
    taskId: "t1",
    runId: "r1",
    worker: "claude" as const,
    model: "claude-opus-5-5",
    promptHash: HASH,
    branch: "agent/x",
  };

  it("maps queued -> running with a TaskRun that stores only the prompt hash", () => {
    const i = workerStartIntent({ ...base, currentState: "queued" });
    if (!i.ok) throw new Error(i.reason);
    expect(i.taskRun).toEqual({
      id: "r1",
      taskId: "t1",
      worker: "claude",
      model: "claude-opus-5-5",
      promptHash: HASH,
    });
    expect(i.audit).toMatchObject({
      event: "worker_started",
      fromState: "queued",
      toState: "running",
    });
  });

  it("records the selected runtime without changing lifecycle policy", () => {
    const i = workerStartIntent({
      ...base,
      worker: "codex",
      model: "gpt-6.1-codex",
      currentState: "queued",
    });
    if (!i.ok) throw new Error(i.reason);
    expect(i.taskRun).toMatchObject({
      worker: "codex",
      model: "gpt-6.1-codex",
    });
    expect(i.audit.metadata).toMatchObject({ worker: "codex" });
  });

  it("does not bypass taskState policy", () => {
    expect(workerStartIntent({ ...base, currentState: "routed" }).ok).toBe(false);
    expect(
      workerStartIntent({
        ...base,
        currentState: "awaiting_approval",
        riskLevel: "red",
      }).ok,
    ).toBe(false);
    expect(workerStartIntent({ ...base, currentState: "queued", promptHash: null }).ok).toBe(false);
  });
});

describe("workerFinishIntent", () => {
  it.each([
    [result(), null, "worker_success"],
    [result({ status: "failure", errorType: "malformed_output" }), "failed", "worker_failure"],
    [result({ status: "timeout", errorType: "timeout" }), "failed", "worker_timeout"],
    [result({ status: "cancelled", errorType: "cancelled" }), "cancelled", "worker_cancelled"],
  ] as const)("maps %#", (r, to, event) => {
    const i = finish(r);
    if (!i.ok) throw new Error(i.reason);
    expect(i.transition).toBe(to);
    expect(i.audit.event).toBe(event);
    expect(i.taskRunPatch.exitStatus).toBe(r.status);
  });

  it("rejects transitions taskState does not allow", () => {
    expect(finish(result({ status: "failure", errorType: "worker_failure" }), "complete").ok).toBe(false);
  });

  it("a fabricated prNumber can never produce pr_opened", () => {
    const forged = result({ prNumber: 9 as unknown as null });
    const i = finish(forged);
    expect(i.ok).toBe(false);
    const ok = finish(result());
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.transition).toBeNull();
    expect(ok.audit.toState).toBeNull();
  });

  it.each([
    ["green", "yellow", { riskLevel: "yellow" }],
    ["green", "red", { riskLevel: "red" }],
    ["yellow", "red", { riskLevel: "red" }],
    ["green", "green", null],
    ["yellow", "yellow", null],
    ["red", "green", null],
    ["yellow", "green", null],
  ] as const)("stored %s + observed %s -> risk update %j", (stored, observed, expected) => {
    for (const status of ["success", "failure"] as const) {
      const i = finish(result({ status, riskObserved: { level: observed, notes: [] } }), "running", stored);
      if (!i.ok) throw new Error(i.reason);
      expect(i.taskRiskUpdate).toEqual(expected);
    }
  });

  it("audit metadata is sanitized", () => {
    const i = finish(
      result({
        summary: "x",
        filesChanged: ["a.ts"],
        riskObserved: { level: "green", notes: ["ghp_abcdefghijklmnop"] },
      }),
    );
    if (!i.ok) throw new Error(i.reason);
    expect(JSON.stringify(i.audit.metadata)).not.toContain("ghp_");
    expect(i.audit.metadata).not.toHaveProperty("summary");
  });

  it("intents apply cleanly through the store's validated repositories", () => {
    const store = createMemoryStore(() => "2026-10-04T00:00:00.000Z");
    store.tasks.create({
      id: "t1",
      source: "manual",
      requesterId: "u",
      rawText: "x",
    });
    store.tasks.update("t1", { riskLevel: "green" });
    for (const s of ["classified", "routed", "queued"] as const) store.tasks.transition("t1", s);

    const start = workerStartIntent({
      currentState: "queued",
      riskLevel: "green",
      taskId: "t1",
      runId: "r1",
      worker: "claude",
      model: "m",
      promptHash: HASH,
      branch: "agent/x",
    });
    if (!start.ok) throw new Error(start.reason);
    store.runs.create(start.taskRun);
    store.tasks.transition("t1", start.transition);
    store.audit.append({ id: "e1", ...start.audit });

    const end = finish(
      result({
        riskObserved: { level: "yellow", notes: ["policy: dependency change"] },
      }),
    );
    if (!end.ok) throw new Error(end.reason);
    store.runs.update("r1", end.taskRunPatch);
    if (end.taskRiskUpdate) store.tasks.update("t1", end.taskRiskUpdate);
    if (end.transition) store.tasks.transition("t1", end.transition);
    store.audit.append({ id: "e2", ...end.audit });

    expect(store.tasks.get("t1")).toMatchObject({
      state: "running",
      riskLevel: "yellow",
    });
    expect(store.runs.get("r1")).toMatchObject({
      exitStatus: "success",
      promptHash: HASH,
    });
    expect(store.audit.list({ taskId: "t1" }).map((e) => e.event)).toEqual(["worker_started", "worker_success"]);
  });

  it("escalation to red persists through the store and a later green result never lowers it", () => {
    const store = createMemoryStore(() => "2026-10-04T00:00:00.000Z");
    store.tasks.create({
      id: "t1",
      source: "manual",
      requesterId: "u",
      rawText: "x",
    });
    store.tasks.update("t1", { riskLevel: "green" });
    for (const s of ["classified", "routed", "queued", "running"] as const) store.tasks.transition("t1", s);

    const red = finish(
      result({
        status: "failure",
        errorType: "scope_violation",
        riskObserved: { level: "red", notes: [] },
      }),
    );
    if (!red.ok) throw new Error(red.reason);
    expect(red.taskRiskUpdate).toEqual({ riskLevel: "red" });
    store.tasks.update("t1", red.taskRiskUpdate!);
    store.tasks.transition("t1", red.transition!);
    expect(store.tasks.get("t1")).toMatchObject({
      state: "failed",
      riskLevel: "red",
    });

    const later = finish(result({ riskObserved: { level: "green", notes: [] } }), "running", "red");
    if (!later.ok) throw new Error(later.reason);
    expect(later.taskRiskUpdate).toBeNull();
    expect(() => store.tasks.update("t1", { riskLevel: "green" })).toThrow();
  });
});
