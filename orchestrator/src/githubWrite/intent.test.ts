import { describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { NewBranchPlan } from "../branches/types";
import { workerFinishIntent } from "../workers/lifecycle";
import type { WorkerResult } from "../workers/types";
import { createGitHubWriteClient } from "./client";
import { createFakeRemote } from "./fake";
import { assignWorkerBranch, pushInputFromWorkerResult } from "./flow";
import { branchCreatedIntent, branchPushedIntent, prOpenedIntent } from "./intent";

const BASE = "a".repeat(40);
const C1 = "c".repeat(40);

const workerResult = (over: Partial<WorkerResult> = {}): WorkerResult => ({
  status: "success",
  summary: "done",
  filesChanged: ["client/x.ts"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: "agent/task-t1-fix",
  headSha: C1,
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  workerErrorCode: null,
  ...over,
});

const contract = {
  taskId: "t1",
  runId: "r1",
  category: "bug_fix" as const,
  actions: [{ kind: "code_edit" as const }],
  objective: "fix",
  allowedScope: ["client/"],
  acceptanceCriteria: [],
  requiredValidations: ["tests" as const],
};

async function fullFlow() {
  const remote = createFakeRemote({ refs: { main: BASE }, parents: { [C1]: BASE } });
  const client = createGitHubWriteClient({ owner: "o", repo: "r" }, { transport: remote, push: remote });
  const plan = planBranch(
    { taskId: "t1", category: "bug_fix", title: "Fix", expectedPaths: ["client/x.ts"], baseBranch: "main", baseSha: BASE },
    { active: [] },
  ) as NewBranchPlan;
  return { remote, client, plan };
}

describe("orchestrated flow: plan → create → worker → push → PR", () => {
  it("runs end to end with trusted state/audit intents", async () => {
    const { client, plan } = await fullFlow();
    const created = await client.createTaskBranch(plan);
    if (!created.ok) throw new Error(created.reason);
    expect(branchCreatedIntent({ currentState: "queued", plan, creation: created.creation })).toMatchObject({
      ok: true,
      transition: null,
      audit: { event: "branch_created", metadata: { branch: plan.branch, baseSha: BASE, headSha: BASE } },
    });

    const assigned = assignWorkerBranch(contract, plan);
    expect(assigned).toMatchObject({ ok: true, contract: { branch: "agent/task-t1-fix" } });

    // Worker success without a PR stays valid: no transition yet.
    const finish = workerFinishIntent({ currentState: "running", riskLevel: "green", taskId: "t1", runId: "r1", result: workerResult(), endedAt: "2026-10-04T00:00:00Z" });
    expect(finish).toMatchObject({ ok: true, transition: null });

    const input = pushInputFromWorkerResult(plan, workerResult());
    if (!input.ok) throw new Error(input.reason);
    expect(input).toEqual({ ok: true, localHeadSha: C1, expectedRemoteSha: BASE });
    const pushed = await client.pushTaskBranch(plan, input);
    if (!pushed.ok) throw new Error(pushed.reason);
    expect(branchPushedIntent({ currentState: "running", receipt: pushed.receipt })).toMatchObject({
      ok: true,
      audit: { event: "branch_pushed", metadata: { headSha: C1, baseSha: BASE, prNumber: null } },
    });

    const opened = await client.openPullRequest(plan, pushed.receipt, { title: "Fix", summary: "s", acceptanceCriteria: [] }, { draft: false });
    if (!opened.ok) throw new Error(opened.reason);
    expect(prOpenedIntent({ currentState: "running", riskLevel: "green", pr: opened.pr })).toMatchObject({
      ok: true,
      transition: "pr_opened",
      taskPatch: { branch: plan.branch, prNumber: 100 },
      audit: { event: "pr_opened", fromState: "running", toState: "pr_opened", metadata: { prNumber: 100, headSha: C1, decision: "ready_pr" } },
    });
  });

  it("fabricated worker / caller PR numbers are ignored or rejected", async () => {
    const { plan } = await fullFlow();
    const fabricated = { taskId: "t1", number: 999, branch: plan.branch, baseSha: BASE, headSha: C1, draft: false };
    expect(prOpenedIntent({ currentState: "running", riskLevel: "green", pr: fabricated })).toMatchObject({ ok: false });
    // A worker result carrying a prNumber is never read for pushing and is rejected by the finish intent.
    const lying = workerResult({ prNumber: 999 as never });
    expect(pushInputFromWorkerResult(plan, lying)).toEqual({ ok: true, localHeadSha: C1, expectedRemoteSha: BASE });
    expect(workerFinishIntent({ currentState: "running", riskLevel: "green", taskId: "t1", runId: "r1", result: lying, endedAt: "x" }).ok).toBe(false);
  });

  it("pr_opened goes through taskState policy", async () => {
    const { client, plan } = await fullFlow();
    await client.createTaskBranch(plan);
    const pushed = await client.pushTaskBranch(plan, { localHeadSha: C1, expectedRemoteSha: BASE });
    if (!pushed.ok) throw new Error(pushed.reason);
    const opened = await client.openPullRequest(plan, pushed.receipt, { title: "t", summary: "", acceptanceCriteria: [] }, { draft: true });
    if (!opened.ok) throw new Error(opened.reason);
    expect(prOpenedIntent({ currentState: "queued", riskLevel: "green", pr: opened.pr }).ok).toBe(false);
    expect(branchPushedIntent({ currentState: "queued", receipt: pushed.receipt }).ok).toBe(false);
    expect(branchPushedIntent({ currentState: "running", receipt: { ...pushed.receipt } }).ok).toBe(false);
  });

  it("worker cannot choose its own branch", async () => {
    const { plan } = await fullFlow();
    expect(assignWorkerBranch({ ...contract, branch: "agent/task-t1-other" }, plan).ok).toBe(false);
    expect(assignWorkerBranch({ ...contract, taskId: "t2" }, plan).ok).toBe(false);
    expect(assignWorkerBranch(contract, { ...plan }).ok).toBe(false);
  });

  it("only verified, passing, same-branch worker results are pushed", async () => {
    const { plan } = await fullFlow();
    expect(pushInputFromWorkerResult(plan, workerResult({ status: "failure", errorType: "worker_failure" })).ok).toBe(false);
    expect(pushInputFromWorkerResult(plan, workerResult({ checkResult: "failed" })).ok).toBe(false);
    expect(pushInputFromWorkerResult(plan, workerResult({ branch: "main" })).ok).toBe(false);
    expect(pushInputFromWorkerResult(plan, workerResult({ headSha: null })).ok).toBe(false);
  });

  it("branchCreatedIntent requires a creation matching the approved plan", async () => {
    const { plan } = await fullFlow();
    const creation = { taskId: "t1", branch: plan.branch, baseSha: "f".repeat(40), alreadyExisted: false };
    expect(branchCreatedIntent({ currentState: "queued", plan, creation }).ok).toBe(false);
  });
});
