import { describe, expect, it } from "vitest";
import { isPlannerApproved, planBranch } from "./planner";
import type { ActiveWork, BranchPlanRequest, ExistingBranchState } from "./types";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

const req = (over: Partial<BranchPlanRequest> = {}): BranchPlanRequest => ({
  taskId: "t1",
  category: "bug_fix",
  title: "Fix search filter",
  expectedPaths: ["client/src/pages/Search.tsx"],
  baseBranch: "main",
  baseSha: BASE,
  ...over,
});

const active = (over: Partial<ActiveWork> = {}): ActiveWork => ({
  taskId: "t9",
  lineageId: "t9",
  branch: "agent/task-t9-other",
  expectedPaths: ["server/other.ts"],
  state: "running",
  prNumber: null,
  prState: null,
  workerRunning: true,
  baseSha: BASE,
  ...over,
});

const existing = (over: Partial<ExistingBranchState> = {}): ExistingBranchState => ({
  name: "agent/task-root1-epic-search",
  headSha: HEAD,
  baseSha: BASE,
  lineageId: "root1",
  prNumber: 12,
  prState: "open",
  changedPaths: ["client/src/pages/Search.tsx"],
  workerRunning: false,
  ...over,
});

const lineage = { rootTaskId: "root1", title: "Epic search" };

describe("planBranch: new_branch", () => {
  it("plans a deterministic new branch bound to the base SHA", () => {
    const plan = planBranch(req(), { active: [active()] });
    expect(plan).toMatchObject({
      decision: "new_branch",
      taskId: "t1",
      branch: "agent/task-t1-fix-search-filter",
      baseBranch: "main",
      baseSha: BASE,
      expectedPaths: ["client/src/pages/Search.tsx"],
    });
    expect(isPlannerApproved(plan)).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(planBranch(req(), { active: [active()] })).toEqual(plan);
  });

  it("ignores terminal active entries", () => {
    const plan = planBranch(req(), { active: [active({ expectedPaths: ["client/"], state: "complete" })] });
    expect(plan.decision).toBe("new_branch");
  });

  it("copies of an approved plan are not approved", () => {
    const plan = planBranch(req(), { active: [] });
    expect(isPlannerApproved({ ...plan })).toBe(false);
    expect(isPlannerApproved(JSON.parse(JSON.stringify(plan)))).toBe(false);
  });
});

describe("planBranch: reject", () => {
  it.each([
    ["protected requested", { requestedBranch: "main" }],
    ["protected requested (ref)", { requestedBranch: "refs/heads/master" }],
    ["arbitrary requested", { requestedBranch: "agent/task-t1-whatever" }],
    ["non-main base", { baseBranch: "develop" }],
    ["base main spelled as ref", { baseBranch: "refs/heads/main" }],
    ["bad base sha", { baseSha: "abc" }],
    ["uppercase base sha", { baseSha: "A".repeat(40) }],
    ["no paths", { expectedPaths: [] }],
    ["traversal path", { expectedPaths: ["../etc/passwd"] }],
    ["absolute path", { expectedPaths: ["/etc/passwd"] }],
    ["bad task id", { taskId: "T 1" }],
    ["bad category", { category: "deploy" as never }],
    ["injection task id", { taskId: "t1;rm -rf /" }],
  ])("%s", (_n, over) => {
    const plan = planBranch(req(over as Partial<BranchPlanRequest>), { active: [] });
    expect(plan.decision).toBe("reject");
    expect(isPlannerApproved(plan)).toBe(false);
  });

  it("rejects duplicate dispatch of an active task", () => {
    expect(planBranch(req(), { active: [active({ taskId: "t1", lineageId: "t1" })] }).reasons[0]).toMatch(/duplicate/);
  });

  it("rejects when the derived branch is owned by another lineage", () => {
    const plan = planBranch(req(), { active: [active({ branch: "agent/task-t1-fix-search-filter", lineageId: "zz" })] });
    expect(plan).toMatchObject({ decision: "reject", reasons: [expect.stringMatching(/another lineage/)] });
  });

  it("rejects malformed active entries (fail closed)", () => {
    expect(planBranch(req(), { active: [active({ expectedPaths: [] })] }).decision).toBe("reject");
    expect(planBranch(req(), { active: [active({ expectedPaths: ["/abs"] })] }).decision).toBe("reject");
  });

  it("rejects invalid high-conflict config", () => {
    expect(planBranch(req(), { active: [], highConflictPaths: ["../x"] }).decision).toBe("reject");
  });
});

describe("planBranch: queue", () => {
  it("exact file overlap with another active task", () => {
    const plan = planBranch(req(), { active: [active({ expectedPaths: ["client/src/pages/Search.tsx"] })] });
    expect(plan).toMatchObject({ decision: "queue", blockedBy: [{ taskId: "t9", branch: "agent/task-t9-other" }] });
  });

  it("directory overlap in either direction", () => {
    expect(planBranch(req(), { active: [active({ expectedPaths: ["client/"] })] }).decision).toBe("queue");
    expect(planBranch(req({ expectedPaths: ["client/src/"] }), { active: [active({ expectedPaths: ["client/src/pages/Home.tsx"] })] }).decision).toBe("queue");
  });

  it("indirect high-conflict overlap (both touch shared hot files)", () => {
    const plan = planBranch(req({ expectedPaths: ["package.json", "client/a.tsx"] }), {
      active: [active({ expectedPaths: ["pnpm-lock.yaml"], workerRunning: false })],
    });
    expect(plan).toMatchObject({ decision: "queue", reasons: [expect.stringMatching(/high-conflict/)] });
  });

  it("high-conflict via directory entry covering a hot file", () => {
    const plan = planBranch(req({ expectedPaths: ["server/"] }), { active: [active({ expectedPaths: ["drizzle/schema.ts"] })] });
    expect(plan.decision).toBe("queue");
  });

  it("configurable high-conflict list", () => {
    const ctx = { active: [active({ expectedPaths: ["b.ts"] })] };
    expect(planBranch(req({ expectedPaths: ["a.ts"] }), ctx).decision).toBe("new_branch");
    expect(planBranch(req({ expectedPaths: ["a.ts"] }), { ...ctx, highConflictPaths: ["a.ts", "b.ts"] }).decision).toBe("queue");
  });

  it("lists every blocker deterministically, sorted by task id", () => {
    const plan = planBranch(req({ expectedPaths: ["client/"] }), {
      active: [
        active({ taskId: "t9", lineageId: "t9", expectedPaths: ["client/x.ts"] }),
        active({ taskId: "t3", lineageId: "t3", branch: "agent/task-t3-x", expectedPaths: ["client/y.ts"] }),
      ],
    });
    expect(plan.decision === "queue" && plan.blockedBy.map((b) => b.taskId)).toEqual(["t3", "t9"]);
  });

  it("concurrency: of two overlapping tasks only the first is dispatched", () => {
    const first = planBranch(req({ taskId: "t1" }), { active: [] });
    expect(first.decision).toBe("new_branch");
    if (first.decision !== "new_branch") return;
    const nowActive: ActiveWork = {
      taskId: "t1",
      lineageId: "t1",
      branch: first.branch,
      expectedPaths: first.expectedPaths,
      state: "running",
      prNumber: null,
      prState: null,
      workerRunning: true,
      baseSha: first.baseSha,
    };
    const second = planBranch(req({ taskId: "t2", title: "Other" }), { active: [nowActive] });
    expect(second.decision).toBe("queue");
    const unrelated = planBranch(req({ taskId: "t3", expectedPaths: ["server/x.ts"] }), { active: [nowActive] });
    expect(unrelated.decision).toBe("new_branch");
  });
});

describe("planBranch: reuse_branch", () => {
  const lineageActive = active({
    taskId: "root1",
    lineageId: "root1",
    branch: "agent/task-root1-epic-search",
    expectedPaths: ["client/src/pages/Search.tsx"],
    state: "qa_running",
    prNumber: 12,
    prState: "open",
    workerRunning: false,
  });

  it("reuses the lineage branch only when explicitly allowed", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing(), allowReuse: true }), { active: [lineageActive] });
    expect(plan).toMatchObject({
      decision: "reuse_branch",
      branch: "agent/task-root1-epic-search",
      baseSha: BASE,
      headSha: HEAD,
      prNumber: 12,
      lineageId: "root1",
    });
    expect(isPlannerApproved(plan)).toBe(true);
  });

  it("same-lineage path overlap does not queue", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing(), allowReuse: true }), { active: [lineageActive] });
    expect(plan.decision).toBe("reuse_branch");
  });

  it("rejects reuse without explicit authorization", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing() }), { active: [] });
    expect(plan).toMatchObject({ decision: "reject", reasons: [expect.stringMatching(/not explicitly authorized/)] });
  });

  it("never reuses an unrelated lineage's branch", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing({ lineageId: "other" }), allowReuse: true }), { active: [] });
    expect(plan).toMatchObject({ decision: "reject", reasons: [expect.stringMatching(/lineage mismatch/)] });
    const foreign = planBranch(req({ taskId: "t2", existingBranch: existing(), allowReuse: true }), { active: [] });
    expect(foreign.decision).toBe("reject");
  });

  it.each(["merged", "closed"] as const)("rejects stale %s PR context", (prState) => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing({ prState }), allowReuse: true }), { active: [] });
    expect(plan).toMatchObject({ decision: "reject", reasons: [expect.stringMatching(/stale/)] });
  });

  it("rejects when unrelated work is present on the branch", () => {
    const plan = planBranch(
      req({ taskId: "t2", lineage, existingBranch: existing({ changedPaths: ["client/src/pages/Search.tsx", "server/billing.ts"] }), allowReuse: true }),
      { active: [] },
    );
    expect(plan).toMatchObject({ decision: "reject", reasons: [expect.stringMatching(/unrelated work: server\/billing.ts/)] });
  });

  it("queues while a worker is running on the lineage branch", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing({ workerRunning: true }), allowReuse: true }), { active: [] });
    expect(plan.decision).toBe("queue");
  });

  it("rejects invalid SHA state on the existing branch", () => {
    const plan = planBranch(req({ taskId: "t2", lineage, existingBranch: existing({ headSha: "zz" }), allowReuse: true }), { active: [] });
    expect(plan.decision).toBe("reject");
  });

  it("rejects when the lineage branch is active but its remote state is unknown", () => {
    const plan = planBranch(req({ taskId: "t2", lineage }), { active: [lineageActive] });
    expect(plan.decision).toBe("reject");
  });
});
