import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeGit } from "../workers/fake";
import { gitMetadataSnapshot, type GitMetadataSnapshot } from "../workers/gitIntegrity";
import type { GitStatus, ProcessRunner, WorkerTaskContract } from "../workers/types";
import { createWorkspaceLeaseRegistry } from "./lease";
import { refreshGitMetadataBinding } from "./workspace";

/** Trusted re-binding before a repair run, against real Git metadata snapshots. */

const BRANCH = "agent/task-t2-repair-rebind";
const HEAD = "a".repeat(40);
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

async function snapshots(mutate: (root: string, home: string, git: (...a: string[]) => string) => void): Promise<[GitMetadataSnapshot, GitMetadataSnapshot]> {
  const root = mkdtempSync(join(tmpdir(), "oxm-rebind-"));
  const home = mkdtempSync(join(tmpdir(), "oxm-rebind-home-"));
  dirs.push(root, home);
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), GIT_CONFIG_SYSTEM: join(home, "system-gitconfig") };
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") } });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.ts"), "1\n");
  git("add", "a.ts");
  git("commit", "-q", "--no-verify", "-m", "base");
  git("switch", "-q", "-c", BRANCH);
  const before = await gitMetadataSnapshot(root, env);
  mutate(root, home, git);
  return [before, await gitMetadataSnapshot(root, env)];
}

function deps(now: GitMetadataSnapshot, status: GitStatus = { branch: BRANCH, headSha: HEAD, dirtyPaths: [] }) {
  const leases = createWorkspaceLeaseRegistry();
  const acquired = leases.acquire({ workspaceId: "ws-1", taskId: "t2", lineageId: "t2", branch: BRANCH });
  if (!acquired.ok) throw new Error(acquired.reason);
  return { lease: acquired.lease, deps: { runner: {} as ProcessRunner, repoRoot: "/repo", leases, git: createFakeGit([status], [], [now]) } };
}

const contract = (digest: string): WorkerTaskContract => ({
  taskId: "t2",
  runId: "t2-run-2",
  category: "frontend_styling",
  actions: [{ kind: "code_edit" }],
  objective: "repair",
  allowedScope: ["client/"],
  acceptanceCriteria: ["x"],
  requiredValidations: [],
  branch: BRANCH,
  expectedHeadSha: HEAD,
  gitMetadataDigest: digest,
});

describe("refreshGitMetadataBinding (trusted Git layer)", () => {
  it("re-binds environment / housekeeping / Git-inert deltas to the current digest, without blame", async () => {
    const [before, after] = await snapshots((root, home, git) => {
      writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = x\n");
      git("update-server-info");
      git("config", "--local", `branch.${BRANCH}.github-pr-owner-number`, "o#r#1");
      git("config", "--local", `branch.${BRANCH}.vscode-merge-base`, "origin/main");
    });
    const { lease, deps: d } = deps(after);
    const r = await refreshGitMetadataBinding({ lease, contract: contract(before.digest), prior: before }, d);
    expect(r).toMatchObject({ ok: true, gitMetadataDigest: after.digest });
    if (!r.ok) throw new Error();
    expect(r.evidence?.workerViolation).toBe(false);
    expect(r.evidence?.window).toBe("before_worker_start");
    expect(r.evidence?.changes.map((c) => c.classification).sort()).toEqual(["benign_integration_change", "benign_integration_change", "environment_change", "unattributed_change"]);
  });

  it("refuses security-relevant deltas (HEAD, remote, pushRemote, hooks, replace refs) and never calls them Worker violations", async () => {
    const cases: [string, (root: string, home: string, git: (...a: string[]) => string) => void][] = [
      ["HEAD", (_r, _h, git) => git("switch", "-q", "main")],
      ["remote", (_r, _h, git) => git("config", "--local", "remote.origin.url", "https://example.invalid/evil")],
      ["pushRemote", (_r, _h, git) => git("config", "--local", `branch.${BRANCH}.pushRemote`, "evil")],
      ["hooks", (root) => writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\n")],
      ["replace", (_r, _h, git) => git("replace", "-f", git("rev-parse", "HEAD").trim(), git("rev-parse", "HEAD").trim())],
    ];
    for (const [name, mutate] of cases) {
      const [before, after] = await snapshots(mutate);
      const { lease, deps: d } = deps(after);
      const r = await refreshGitMetadataBinding({ lease, contract: contract(before.digest), prior: before }, d);
      expect(r.ok, name).toBe(false);
      if (r.ok) continue;
      expect(r.reason, name).toMatch(/^security-relevant Git metadata changed/);
      expect(r.evidence?.workerViolation, name).toBe(false);
    }
  });

  it("keeps lineage/branch/HEAD safety and fails closed without a trusted component baseline", async () => {
    const [before, after] = await snapshots((_r, home) => writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = x\n"));
    // HEAD moved since the repair plan
    const moved = deps(after, { branch: BRANCH, headSha: "b".repeat(40), dirtyPaths: [] });
    expect(await refreshGitMetadataBinding({ lease: moved.lease, contract: contract(before.digest), prior: before }, moved.deps)).toMatchObject({ ok: false, reason: "workspace is not on the bound branch/HEAD" });
    // another task's contract
    const other = deps(after);
    expect(await refreshGitMetadataBinding({ lease: other.lease, contract: { ...contract(before.digest), taskId: "t3" }, prior: before }, other.deps)).toMatchObject({ ok: false });
    // restart: no in-memory baseline while the digest moved
    const restarted = deps(after);
    expect(await refreshGitMetadataBinding({ lease: restarted.lease, contract: contract(before.digest), prior: null }, restarted.deps)).toMatchObject({ ok: false });
    // nothing moved: binding unchanged even without a baseline
    const same = deps(before);
    expect(await refreshGitMetadataBinding({ lease: same.lease, contract: contract(before.digest), prior: null }, same.deps)).toMatchObject({ ok: true, gitMetadataDigest: before.digest, evidence: null });
  });
});
