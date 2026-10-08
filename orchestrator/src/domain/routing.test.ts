import { describe, expect, it } from "vitest";
import { primaryWorkerFor, routeTask } from "./routing";
import type { ClassificationResult, TaskCategory, WorkerAvailability } from "./types";

const cls = (category: TaskCategory): ClassificationResult => ({
  taskId: "t1",
  category,
  risk: { level: "green", reasons: [], requiresApproval: false },
});
const both: WorkerAvailability = { claude: "available", codex: "available" };

describe("routing", () => {
  it.each<TaskCategory>(["backend", "business_logic", "database", "auth", "security", "bug_fix", "architecture", "general_coding"])("%s → claude", (c) => {
    expect(primaryWorkerFor(c)).toBe("claude");
    expect(routeTask(cls(c), both)).toMatchObject({
      worker: "claude",
      isFallback: false,
    });
  });

  it.each<TaskCategory>(["ui", "css", "layout", "visual_polish", "frontend_styling"])("%s → codex", (c) => {
    expect(primaryWorkerFor(c)).toBe("codex");
    expect(routeTask(cls(c), both)).toMatchObject({
      worker: "codex",
      isFallback: false,
    });
  });

  it("claude quota_exhausted → codex temporarily covers coding", () => {
    const d = routeTask(cls("backend"), {
      claude: "quota_exhausted",
      codex: "available",
    });
    expect(d).toMatchObject({
      worker: "codex",
      primary: "claude",
      isFallback: true,
    });
  });

  it.each(["unavailable", "misconfigured"] as const)("claude %s (not quota) → no codex takeover; waits for claude", (status) => {
    expect(routeTask(cls("backend"), { claude: status, codex: "available" })).toMatchObject({ worker: null, primary: "claude", reasonCode: "fallback_forbidden" });
  });

  it("no worker when claude and codex both unavailable", () => {
    expect(
      routeTask(cls("database"), {
        claude: "quota_exhausted",
        codex: "unavailable",
      }),
    ).toMatchObject({ worker: null, reasonCode: "worker_unavailable" });
  });

  it("does not fallback when policy forbids it", () => {
    expect(routeTask(cls("backend"), { claude: "quota_exhausted", codex: "available" }, { allowClaudeToCodexFallback: false })).toMatchObject({
      worker: null,
      reasonCode: "fallback_forbidden",
    });
  });

  it("does not silently substitute when Codex is unavailable", () => {
    expect(routeTask(cls("ui"), { claude: "available", codex: "misconfigured" })).toMatchObject({
      worker: null,
      primary: "codex",
      reasonCode: "worker_unavailable",
    });
  });

  it("codex-primary tasks do not fall back to claude", () => {
    expect(routeTask(cls("css"), { claude: "available", codex: "unavailable" })).toMatchObject({ worker: null, primary: "codex" });
  });

  it("is deterministic", () => {
    expect(routeTask(cls("ui"), both)).toEqual(routeTask(cls("ui"), both));
  });
});
