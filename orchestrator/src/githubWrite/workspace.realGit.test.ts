import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { NewBranchPlan } from "../branches/types";
import type { Approval } from "../store/types";
import { createGitInspector } from "../workers/gitInspector";
import { createNodeProcessRunner } from "../workers/processRunner";
import { COMMIT_PUBLISH_ACTION, commitApprovalBinding, normalizeCommitApprovalEvidence, type CommitApprovalEvidence } from "../workers/prompt";
import { createWorkspaceLeaseRegistry } from "./lease";
import { commitValidatedChanges, observeCommitState, prepareAssignedWorkspace } from "./workspace";

// Exercises the trusted commit boundary against real Git (local bare "origin"):
// content identities, index verification, pathspec-free commit, and metadata drift.
const PATH = "server/drift/index.ts";
const APPROVED = "export const page = 1;\n";
let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const FOREIGN = "orchestrator/src/foreign-wip.ts";

async function approvedWorkspace(opts: { foreign?: boolean } = {}) {
  root = mkdtempSync(join(tmpdir(), "oxm-trusted-commit-"));
  const repo = join(root, "work");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git("config", k, v);
  git("remote", "add", "origin", join(root, "origin.git"));
  mkdirSync(join(repo, "server", "drift"), { recursive: true });
  writeFileSync(join(repo, PATH), "export const page = 0;\n");
  git("add", "--", PATH);
  git("commit", "-q", "--no-verify", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const plan = planBranch(
    { taskId: "drift", category: "bug_fix", title: "Fix drift", expectedPaths: ["server/drift/"], baseBranch: "main", baseSha: base },
    { active: [] },
  ) as NewBranchPlan;
  git("push", "-q", "origin", `${base}:refs/heads/main`, `${base}:refs/heads/${plan.branch}`);

  const runner = createNodeProcessRunner();
  const leases = createWorkspaceLeaseRegistry();
  const leased = leases.acquire({ workspaceId: "ws", taskId: plan.taskId, lineageId: plan.lineageId, branch: plan.branch });
  if (!leased.ok) throw new Error(leased.reason);
  const deps = { runner, git: createGitInspector(runner, repo), repoRoot: repo, leases };
  const prepared = await prepareAssignedWorkspace(
    { plan, lease: leased.lease, creation: { taskId: plan.taskId, branch: plan.branch, baseSha: base, alreadyExisted: true } },
    deps,
  );
  if (!prepared.ok) throw new Error(prepared.reason);

  // Worker edit (no Git writes), then the state the Manager presents for approval.
  writeFileSync(join(repo, PATH), APPROVED);
  if (opts.foreign) {
    // Another actor's uncommitted work outside the task scope (shared workspace).
    mkdirSync(join(repo, "orchestrator", "src"), { recursive: true });
    writeFileSync(join(repo, FOREIGN), "export const wip = true;\n");
  }
  const observed = await observeCommitState(leased.lease, deps);
  if (!observed.ok) throw new Error(observed.reason);
  expect(observed.gitMetadataDigest).toBe(prepared.prepared.gitMetadataDigest);
  const owned = observed.dirtyPaths.filter((p) => p !== FOREIGN);
  const evidence: CommitApprovalEvidence = normalizeCommitApprovalEvidence({
    taskId: plan.taskId,
    branch: plan.branch,
    expectedHeadSha: base,
    changedPaths: owned,
    ...(opts.foreign ? { excludedPaths: [FOREIGN] } : {}),
    contentIdentities: observed.contentIdentities.filter((id) => owned.includes(id.path)),
    gitMetadataDigest: observed.gitMetadataDigest,
    allowedScope: ["server/drift/"],
    validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }],
    acceptance: [],
    observedRisk: "green",
    managerDecision: "accepted",
    action: COMMIT_PUBLISH_ACTION,
    authorization: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
  });
  const approval: Approval = {
    id: "approval-1",
    taskId: plan.taskId,
    kind: "commit_publish",
    requestedAction: COMMIT_PUBLISH_ACTION,
    status: "approved",
    decidedBy: "human-1",
    decidedAt: "2026-10-06T00:00:00.000Z",
    channel: "test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    bindingShaOrActionId: commitApprovalBinding(evidence),
    createdAt: "2026-10-05T00:00:00.000Z",
  };
  const commit = () => commitValidatedChanges({ plan, lease: leased.lease, evidence, approval, at: "2026-10-06T12:00:00.000Z" }, deps);
  return { repo, git, base, evidence, commit };
}

describe("trusted commit against a real Git repository", () => {
  it("shared workspace: commits only the approved task paths and leaves the excluded foreign change untouched", async () => {
    const { git, base, commit } = await approvedWorkspace({ foreign: true });
    const result = await commit();
    expect(result.ok).toBe(true);
    expect(git("diff", "--name-only", base, "HEAD")).toBe(PATH);
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe(`?? ${FOREIGN}`);
  });

  it("binds the real Git blob id and commits exactly the approved bytes once", async () => {
    const { repo, git, base, evidence, commit } = await approvedWorkspace();
    expect(evidence.contentIdentities).toEqual([{ path: PATH, mode: "100644", blob: git("hash-object", "--no-filters", "--", PATH) }]);
    const result = await commit();
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(git("rev-parse", "HEAD")).toBe(result.headSha);
    expect(git("rev-parse", `HEAD:${PATH}`)).toBe(evidence.contentIdentities[0].blob);
    expect(git("rev-list", "--count", `${base}..HEAD`)).toBe("1");
    expect(git("status", "--porcelain")).toBe("");
    // The trusted commit itself leaves the metadata baseline intact (later repairs stay verifiable).
    expect(await createGitInspector(createNodeProcessRunner(), repo).metadataDigest()).toBe(evidence.gitMetadataDigest);
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo, encoding: "utf8" }).trim()).toBe("chore(agent): apply task drift");
    // The same approval can never produce a second commit.
    expect(await commit()).toMatchObject({ ok: false, error: "verification_failed" });
    expect(git("rev-list", "--count", `${base}..HEAD`)).toBe("1");
  });

  it.each([
    ["one-byte change", (repo: string) => writeFileSync(join(repo, PATH), "export const page = 2;\n"), "verification_failed"],
    ["deletion", (repo: string) => rmSync(join(repo, PATH)), "verification_failed"],
    ["rename", (repo: string) => renameSync(join(repo, PATH), join(repo, "server/drift/renamed.ts")), "dirty_worktree"],
    ["Git config change", (repo: string) => execFileSync("git", ["config", "core.attributesFile", "/tmp/x"], { cwd: repo }), "verification_failed"],
    ["new hook", (repo: string) => writeFileSync(join(repo, ".git", "hooks", "post-commit"), "#!/bin/sh\n"), "verification_failed"],
    ["info/attributes change", (repo: string) => writeFileSync(join(repo, ".git", "info", "attributes"), "*.ts filter=evil\n"), "verification_failed"],
  ] as const)("%s after approval is stale and leaves HEAD and the index untouched", async (_name, drift, error) => {
    const { repo, git, base, commit } = await approvedWorkspace();
    drift(repo);
    expect(await commit()).toMatchObject({ ok: false, error });
    expect(git("rev-parse", "HEAD")).toBe(base);
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  it("trusted Git operations themselves do not disturb the metadata baseline, but index hiding flags do", async () => {
    const { repo, git } = await approvedWorkspace();
    const inspector = createGitInspector(createNodeProcessRunner(), repo);
    const before = await inspector.metadataDigest();
    git("status");
    git("fetch", "-q", "origin");
    expect(await inspector.metadataDigest()).toBe(before);
    git("update-index", "--skip-worktree", "--", PATH);
    expect(await inspector.metadataDigest()).not.toBe(before);
  });
});
