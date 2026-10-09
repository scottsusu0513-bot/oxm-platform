import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { CommitRelation } from "../branches/taskBase";
import type { NewBranchPlan } from "../branches/types";
import { createGitHubWriteClient } from "../githubWrite/client";
import { createWorkspaceLeaseRegistry } from "../githubWrite/lease";
import type { GitHubWriteTransport, RepoRef } from "../githubWrite/types";
import { buildRuntimeSwitchArgs, prepareAssignedWorkspace, restoreRuntimeWorkspace } from "../githubWrite/workspace";
import { createRepoStatePort } from "../scheduler/adapters";
import { createInMemoryAuditRepository } from "../store/memory";
import { createGitInspector } from "../workers/gitInspector";
import { createNodeProcessRunner } from "../workers/processRunner";
import { loadRecordedBaseline, recordBaseline } from "./runtimeBaseline";

// Regression for the cold-start blocker: a task branch planned from an older main
// lacked the runtime/startup code, and the Codespace stayed on it after the task.
// Real Git with a local bare "origin"; GitHub refs/compare are served from it.
const RUNTIME_BRANCH = "agent/gpt-manager-live-e2e";
const STARTUP_FILES = [".devcontainer/devcontainer.json", "scripts/codespace-post-start.sh", "scripts/orchestrator-telegram-supervisor.ts"];
const REPO: RepoRef = { owner: "oxm", repo: "oxm-platform" };
let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function fixture() {
  root = mkdtempSync(join(tmpdir(), "oxm-runtime-baseline-"));
  const repo = join(root, "work");
  const origin = join(root, "origin.git");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const originGit = (...args: string[]) => execFileSync("git", ["--git-dir", origin, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git("config", k, v);
  git("remote", "add", "origin", origin);
  const write = (path: string, body: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), body);
  };
  // Old main baseline: no Wake Gateway / supervisor / devcontainer startup runtime.
  write("client/app.ts", "export const app = 1;\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "old main");
  const mainSha = git("rev-parse", "HEAD");
  // Runtime branch (not merged yet) adds the startup runtime.
  git("switch", "-q", "-c", RUNTIME_BRANCH);
  for (const f of STARTUP_FILES) write(f, `// ${f}\n`);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "runtime startup");
  const runtimeSha = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "main", RUNTIME_BRANCH);

  const ref = (branch: string) => {
    try {
      return originGit("rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`);
    } catch {
      return null;
    }
  };
  // GitHub-shaped transport over the bare origin (refs + compare).
  const transport: GitHubWriteTransport & { compareCommits(r: RepoRef, base: string, head: string): Promise<CommitRelation | null> } = {
    getBranchHead: async (_r, branch) => ref(branch),
    createBranchRef: async (_r, branch, at) => {
      originGit("update-ref", `refs/heads/${branch}`, at, "0".repeat(40));
      return { ref: `refs/heads/${branch}`, object: { sha: at } };
    },
    compareCommits: async (_r, base, head) => {
      if (base === head) return "identical";
      const isAncestor = (a: string, b: string) => {
        try {
          originGit("merge-base", "--is-ancestor", a, b);
          return true;
        } catch {
          return false;
        }
      };
      if (isAncestor(base, head)) return "ahead";
      if (isAncestor(head, base)) return "behind";
      return "diverged";
    },
    createPullRequest: async () => {
      throw new Error("not used");
    },
    getPullRequest: async () => {
      throw new Error("not used");
    },
    updatePullRequestText: async () => {
      throw new Error("not used");
    },
  };
  const runner = createNodeProcessRunner();
  const inspector = createGitInspector(runner, repo);
  return { repo, git, write, mainSha, runtimeSha, transport, runner, inspector };
}

async function startTask(f: ReturnType<typeof fixture>, baseline: { branch: string; sha: string }, taskId = "t261009-882d30") {
  const repoState = createRepoStatePort(f.transport, REPO, baseline);
  const github = createGitHubWriteClient(REPO, { transport: f.transport, push: { pushBranch: async () => {} }, taskBaseSha: () => repoState.taskBaseSha() });
  const baseSha = await repoState.taskBaseSha();
  const plan = planBranch({ taskId, category: "bug_fix", title: "oxm", expectedPaths: ["client/"], baseBranch: "main", baseSha }, { active: [] }) as NewBranchPlan;
  const created = await github.createTaskBranch(plan);
  if (!created.ok) throw new Error(created.reason);
  const leases = createWorkspaceLeaseRegistry();
  const leased = leases.acquire({ workspaceId: "ws", taskId: plan.taskId, lineageId: plan.lineageId, branch: plan.branch });
  if (!leased.ok) throw new Error(leased.reason);
  const deps = { runner: f.runner, git: f.inspector, repoRoot: f.repo, leases };
  const prepared = await prepareAssignedWorkspace({ plan, lease: leased.lease, creation: created.creation }, deps);
  if (!prepared.ok) throw new Error(prepared.reason);
  return { plan, deps, leases, lease: leased.lease, baseSha };
}

describe("runtime baseline vs task branches (real Git)", () => {
  it("runtime newer than main: the task branch starts from the runtime baseline and contains the startup files", async () => {
    const f = fixture();
    const baseline = { branch: RUNTIME_BRANCH, sha: f.runtimeSha };
    const { plan, baseSha } = await startTask(f, baseline);
    expect(baseSha).toBe(f.runtimeSha);
    expect(baseSha).not.toBe(f.mainSha);
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(plan.branch);
    expect(f.git("rev-parse", "HEAD")).toBe(f.runtimeSha);
    for (const file of STARTUP_FILES) {
      expect(existsSync(join(f.repo, file)), file).toBe(true);
      expect(() => f.git("cat-file", "-e", `${plan.branch}:${file}`)).not.toThrow();
    }
    // main itself was never touched.
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(f.mainSha);
  });

  it("after main absorbs the runtime (post-merge), task branches start from main again", async () => {
    const f = fixture();
    f.git("push", "-q", "origin", `${f.runtimeSha}:refs/heads/main`);
    const { baseSha } = await startTask(f, { branch: RUNTIME_BRANCH, sha: f.runtimeSha });
    expect(baseSha).toBe(f.runtimeSha); // == main now
  });

  it("returns the idle workspace to the runtime baseline after the task, never while it is active or dirty", async () => {
    const f = fixture();
    const baseline = { branch: RUNTIME_BRANCH, sha: f.runtimeSha };
    const { plan, deps, leases, lease } = await startTask(f, baseline);

    // Active task / same-task repair: stays on the task branch.
    expect(await restoreRuntimeWorkspace({ baseline, taskActive: true }, deps)).toEqual({ ok: true, decision: { action: "stay", reason: "task_active" } });
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(plan.branch);
    // Uncommitted Worker edits are never carried or discarded.
    f.write("client/app.ts", "export const app = 2;\n");
    expect(await restoreRuntimeWorkspace({ baseline, taskActive: false }, deps)).toEqual({ ok: true, decision: { action: "stay", reason: "dirty_worktree" } });
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(plan.branch);
    f.git("checkout", "--", "client/app.ts");

    // Terminal: lease released, clean tree → back on the runtime branch at the exact baseline.
    leases.release(lease);
    expect(await restoreRuntimeWorkspace({ baseline, taskActive: false }, deps)).toEqual({ ok: true, decision: { action: "return", branch: RUNTIME_BRANCH, sha: f.runtimeSha } });
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(RUNTIME_BRANCH);
    expect(f.git("rev-parse", "HEAD")).toBe(f.runtimeSha);
    for (const file of STARTUP_FILES) expect(existsSync(join(f.repo, file)), file).toBe(true);

    // A later same-lineage repair re-prepares its task branch from the runtime branch.
    const again = leases.acquire({ workspaceId: "ws", taskId: plan.taskId, lineageId: plan.lineageId, branch: plan.branch });
    if (!again.ok) throw new Error(again.reason);
    const reprepared = await prepareAssignedWorkspace({ plan, lease: again.lease, creation: { taskId: plan.taskId, branch: plan.branch, baseSha: plan.baseSha, alreadyExisted: true } }, deps);
    expect(reprepared.ok).toBe(true);
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(plan.branch);
  });

  it("never switches the workspace onto main/master, even with a forged baseline", async () => {
    const f = fixture();
    const { plan, deps, leases, lease } = await startTask(f, { branch: RUNTIME_BRANCH, sha: f.runtimeSha });
    leases.release(lease);
    for (const branch of ["main", "master"]) {
      expect(await restoreRuntimeWorkspace({ baseline: { branch, sha: f.mainSha }, taskActive: false }, deps)).toEqual({ ok: true, decision: { action: "stay", reason: "unsafe_runtime_branch" } });
      expect(() => buildRuntimeSwitchArgs(branch)).toThrow(/not a runtime branch/);
    }
    expect(f.git("rev-parse", "--abbrev-ref", "HEAD")).toBe(plan.branch);
    expect(f.git("rev-parse", "main")).toBe(f.mainSha);
  });

  it("crash/restart on a task branch keeps the durable baseline identity", () => {
    const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
    expect(loadRecordedBaseline(audit)).toBeNull();
    recordBaseline(audit, "b1", { branch: RUNTIME_BRANCH, sha: "a".repeat(40) });
    recordBaseline(audit, "b2", { branch: RUNTIME_BRANCH, sha: "b".repeat(40) });
    expect(loadRecordedBaseline(audit)).toEqual({ branch: RUNTIME_BRANCH, sha: "b".repeat(40) });
  });
});
