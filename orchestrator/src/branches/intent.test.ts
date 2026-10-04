import { describe, expect, it } from "vitest";
import { branchAuditMetadata, branchPlanIntent } from "./intent";
import { planBranch } from "./planner";
import type { BranchPlanRequest } from "./types";

const BASE = "a".repeat(40);
const req = (over: Partial<BranchPlanRequest> = {}): BranchPlanRequest => ({
  taskId: "t1",
  category: "bug_fix",
  title: "Fix",
  expectedPaths: ["client/x.ts"],
  baseBranch: "main",
  baseSha: BASE,
  ...over,
});

describe("branchPlanIntent", () => {
  it("new_branch → branch_planned audit + branch patch, no transition", () => {
    const intent = branchPlanIntent({ currentState: "queued", riskLevel: "green", plan: planBranch(req(), { active: [] }) });
    expect(intent).toMatchObject({
      ok: true,
      auditEvent: "branch_planned",
      transition: null,
      taskPatch: { branch: "agent/task-t1-fix" },
      audit: { event: "branch_planned", actor: "manager", metadata: { taskId: "t1", branch: "agent/task-t1-fix", baseSha: BASE, decision: "new_branch" } },
    });
  });

  it("queue from routed → queued via taskState policy; red-risk cannot skip approval", () => {
    const plan = planBranch(req(), {
      active: [{ taskId: "t9", lineageId: "t9", branch: "agent/task-t9-x", expectedPaths: ["client/"], state: "running", prNumber: null, prState: null, workerRunning: true, baseSha: BASE }],
    });
    expect(branchPlanIntent({ currentState: "routed", riskLevel: "green", plan })).toMatchObject({
      ok: true,
      auditEvent: "branch_queued",
      transition: "queued",
      audit: { metadata: { blockedBy: ["t9"] } },
    });
    expect(branchPlanIntent({ currentState: "routed", riskLevel: "red", plan }).ok).toBe(false);
    expect(branchPlanIntent({ currentState: "queued", riskLevel: "red", plan })).toMatchObject({ ok: true, transition: null });
  });

  it("refuses forged plans and non-plannable states", () => {
    const plan = planBranch(req(), { active: [] });
    expect(branchPlanIntent({ currentState: "queued", riskLevel: "green", plan: { ...plan } as never }).ok).toBe(false);
    expect(branchPlanIntent({ currentState: "running", riskLevel: "green", plan }).ok).toBe(false);
  });

  it("reject → branch_rejected audit only", () => {
    const plan = planBranch(req({ requestedBranch: "main" }), { active: [] });
    expect(branchPlanIntent({ currentState: "queued", riskLevel: "green", plan })).toMatchObject({ ok: true, auditEvent: "branch_rejected", transition: null, taskPatch: null });
  });
});

describe("branchAuditMetadata sanitization", () => {
  it("keeps only whitelisted fields and redacts credential-looking values", () => {
    const m = branchAuditMetadata({
      taskId: "t1",
      branch: "agent/task-t1-x",
      baseSha: BASE,
      headSha: null,
      prNumber: null,
      decision: "new_branch",
      reasons: ["token ghp_abcdefghijklmnopqrst", "Bearer abc.def.ghi"],
      ...({ rawBody: "{...}", token: "x", prompt: "full prompt" } as object),
    });
    expect(Object.keys(m).sort()).toEqual(["baseSha", "branch", "decision", "headSha", "prNumber", "reasons", "taskId"]);
    expect(JSON.stringify(m)).not.toMatch(/ghp_|abc\.def/);
  });
});
