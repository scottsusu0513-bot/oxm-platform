import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexAdapter } from "./codex";
import { createFakeGit, createFakePromptFiles, createFakeRunner, createFakeTimer } from "./fake";
import { gitMetadataSnapshot, type GitMetadataSnapshot } from "./gitIntegrity";
import { configKeyClass, gitMetadataEvidence, type GitMetadataEvidence } from "./gitMetadataPolicy";
import type { GitStatus, WorkerReport, WorkerResult, WorkerTaskContract } from "./types";

/**
 * Component-level Git metadata model, classification and attribution (regression t261010-a61cac:
 * a background repack rewrote .git/info/refs 7s into a Codex run and the single opaque digest
 * turned a green frontend task into `worker failure: git_metadata_changed`).
 */

const TASK = "agent/task-t1-frontend-styling";
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oxm-gitmeta-"));
  const home = mkdtempSync(join(tmpdir(), "oxm-gitmeta-home-"));
  dirs.push(root, home);
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), GIT_CONFIG_SYSTEM: join(home, "system-gitconfig") };
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") } });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  git("commit", "-q", "--no-verify", "-m", "base");
  git("switch", "-q", "-c", TASK);
  git("config", "--local", "branch.main.remote", "origin");
  const snapshot = () => gitMetadataSnapshot(root, env);
  return { root, home, env, git, snapshot };
}

/** Before/after snapshots around `mutate`, classified as the Worker run window. */
async function during(mutate: (f: ReturnType<typeof fixture>) => void): Promise<{ before: GitMetadataSnapshot; after: GitMetadataSnapshot; evidence: GitMetadataEvidence }> {
  const f = fixture();
  const before = await f.snapshot();
  mutate(f);
  const after = await f.snapshot();
  return { before, after, evidence: gitMetadataEvidence(before, after, "worker_run") };
}

const only = (e: GitMetadataEvidence) => e.changes.map((c) => [c.component, c.classification]);

describe("component-level Git metadata snapshot and classification (real repositories)", () => {
  it("1. VS Code merge-base written during the worker run: benign integration change, integrity digest unchanged", async () => {
    const { before, after, evidence } = await during((f) => f.git("config", "--local", `branch.${TASK}.vscode-merge-base`, "origin/main"));
    expect(after.digest).toBe(before.digest);
    expect(only(evidence)).toEqual([["repo.config_integration", "benign_integration_change"]]);
    expect(evidence.changes[0].keys).toEqual([`branch.${TASK}.vscode-merge-base`]);
    expect(evidence).toMatchObject({ workerViolation: false, publicationTrust: "trusted" });
  });

  it("2. GitHub PR base branch written during the worker run: benign integration change", async () => {
    const { before, after, evidence } = await during((f) => f.git("config", "--local", `branch.${TASK}.github-pr-base-branch`, "owner-1#oxm-platform#agent/gpt-manager-live-e2e"));
    expect(after.digest).toBe(before.digest);
    expect(only(evidence)).toEqual([["repo.config_integration", "benign_integration_change"]]);
    expect(evidence.publicationTrust).toBe("trusted");
  });

  it("t261010 root cause: a repack rewriting .git/info/refs is Git housekeeping, not a security change", async () => {
    const { before, after, evidence } = await during((f) => f.git("update-server-info"));
    expect(after.digest).toBe(before.digest);
    expect(only(evidence)).toEqual([["repo.info_server", "benign_integration_change"]]);
    expect(evidence.changes[0].entries).toEqual(["git:info/refs"]);
    // .git/info/exclude stays security-relevant
    const exclude = await during((f) => writeFileSync(join(f.root, ".git", "info", "exclude"), "client/\n"));
    expect(exclude.after.digest).not.toBe(exclude.before.digest);
    expect(only(exclude.evidence)).toEqual([["repo.info", "worker_security_violation"]]);
  });

  it("3. global/system Git config changes: environment change, never a Worker violation; publication needs trust", async () => {
    const global = await during((f) => writeFileSync(join(f.home, ".gitconfig"), "[core]\n\thooksPath = /tmp/hooks\n"));
    // the hooksPath target it now names is tracked as its own environment component
    expect(only(global.evidence)).toEqual([
      ["env.config_paths", "environment_change"],
      ["env.global_config", "environment_change"],
    ]);
    expect(global.evidence).toMatchObject({ workerViolation: false, publicationTrust: "refresh_required" });
    expect(global.evidence.changes[1].keys).toEqual(["core.hookspath"]);
    const system = await during((f) => writeFileSync(f.env.GIT_CONFIG_SYSTEM, "[user]\n\tname = x\n"));
    expect(only(system.evidence)).toEqual([["env.system_config", "environment_change"]]);
    expect(system.evidence.workerViolation).toBe(false);
    const attrs = await during((f) => {
      mkdirSync(join(f.home, ".config", "git"), { recursive: true });
      writeFileSync(join(f.home, ".config", "git", "attributes"), "*.ts filter=x\n");
    });
    expect(only(attrs.evidence)).toEqual([["env.global_attributes_ignore", "environment_change"]]);
  });

  it("4. HEAD / branch identity changed by the Worker: hard violation", async () => {
    const { evidence } = await during((f) => f.git("switch", "-q", "main"));
    expect(only(evidence)).toEqual([["repo.head", "worker_security_violation"]]);
    expect(evidence).toMatchObject({ workerViolation: true, publicationTrust: "blocked" });
  });

  it("5. remote / pushRemote / merge target changed by the Worker: hard violation, key names only (no values)", async () => {
    for (const [key, value] of [
      ["remote.origin.url", "https://example.invalid/evil/value-must-not-leak"],
      [`branch.${TASK}.pushRemote`, "evil"],
      [`branch.${TASK}.merge`, "refs/heads/evil"],
      [`branch.${TASK}.remote`, "evil"],
    ]) {
      const { evidence } = await during((f) => f.git("config", "--local", key, value));
      expect(only(evidence), key).toEqual([["repo.config", "worker_security_violation"]]);
      expect(evidence.changes[0].keys, key).toEqual([key.toLowerCase().replace(`branch.${TASK.toLowerCase()}`, `branch.${TASK}`)]);
      expect(JSON.stringify(evidence), key).not.toContain(value);
    }
  });

  it("6. hook added or changed: hard violation", async () => {
    const { evidence } = await during((f) => writeFileSync(join(f.root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n", { mode: 0o755 }));
    expect(only(evidence)).toEqual([["repo.hooks", "worker_security_violation"]]);
    expect(evidence.changes[0].entries).toEqual(["git:hooks/pre-commit"]);
  });

  it("7. replace ref added: hard violation", async () => {
    const { evidence } = await during((f) => {
      const head = f.git("rev-parse", "HEAD").trim();
      f.git("replace", "-f", head, head);
    });
    expect(only(evidence)).toEqual([["repo.replace_refs", "worker_security_violation"]]);
  });

  it("8. Git-behaviour config (hooksPath, filter, includes, fsmonitor) changed by the Worker: hard violation", async () => {
    for (const [key, value] of [
      ["core.hooksPath", "/tmp/hooks"],
      ["filter.x.clean", "evil"],
      ["core.fsmonitor", "true"],
      ["include.path", "/tmp/other-config"],
    ]) {
      const { evidence } = await during((f) => f.git("config", "--local", key, value));
      expect(evidence.workerViolation, key).toBe(true);
      expect(evidence.changes.find((c) => c.component === "repo.config")?.classification, key).toBe("worker_security_violation");
    }
  });

  it("9. unattributable metadata deltas never accuse the Worker; publication may be paused instead", async () => {
    // A branch key Git never reads (the PR extension's github-pr-owner-number): rebindable.
    const inert = await during((f) => f.git("config", "--local", `branch.${TASK}.github-pr-owner-number`, "owner#repo#12"));
    expect(only(inert.evidence)).toEqual([["repo.config", "unattributed_change"]]);
    expect(inert.evidence).toMatchObject({ workerViolation: false, publicationTrust: "rebind_allowed" });
    // git-lfs's own cache key: not the Worker's, but Git-LFS acts on it: publication needs refreshed trust.
    const lfs = await during((f) => f.git("config", "--local", "lfs.https://example.invalid/info/lfs.access", "basic"));
    expect(only(lfs.evidence)).toEqual([["repo.config", "unattributed_change"]]);
    expect(lfs.evidence).toMatchObject({ workerViolation: false, publicationTrust: "refresh_required" });
    // A security-relevant change observed OUTSIDE the Worker's run window is never attributed to it.
    const f = fixture();
    const before = await f.snapshot();
    writeFileSync(join(f.root, ".git", "hooks", "pre-push"), "#!/bin/sh\n");
    const later = gitMetadataEvidence(before, await f.snapshot(), "after_worker_run");
    expect(only(later)).toEqual([["repo.hooks", "unattributed_change"]]);
    expect(later).toMatchObject({ workerViolation: false, publicationTrust: "refresh_required" });
  });

  it("classifies config keys: integration / inert / tool-managed / Git behaviour", () => {
    expect(configKeyClass(`branch.${TASK}.vscode-merge-base`)).toBe("integration");
    expect(configKeyClass("branch.a.b.github-pr-base-branch")).toBe("integration");
    expect(configKeyClass("branch.x.github-pr-owner-number")).toBe("inert");
    expect(configKeyClass("branch.x.pushremote")).toBe("git_behavior");
    expect(configKeyClass("branch.x.merge")).toBe("git_behavior");
    expect(configKeyClass("lfs.repositoryformatversion")).toBe("tool_managed");
    expect(configKeyClass("core.vscode-merge-base")).toBe("git_behavior");
    expect(configKeyClass("(unparsed).(unparsed)")).toBe("git_behavior");
  });
});

// ---------------------------------------------------------------------------
// Runtime adapter: before/after snapshots around the Worker process.

const BASE = "a".repeat(40);
const clean: GitStatus = { branch: TASK, headSha: BASE, dirtyPaths: [] };
const edited: GitStatus = { branch: TASK, headSha: BASE, dirtyPaths: ["client/src/components/admin/AnalyticsDashboardCard.tsx"] };
const contract = (digest: string): WorkerTaskContract => ({
  taskId: "t1",
  runId: "run-1",
  category: "frontend_styling",
  actions: [{ kind: "code_edit" }],
  objective: "show hourly views under each bar",
  allowedScope: ["client/"],
  acceptanceCriteria: ["hourly views visible without hover"],
  requiredValidations: ["typecheck"],
  branch: TASK,
  expectedHeadSha: BASE,
  gitMetadataDigest: digest,
});
const report: WorkerReport = {
  status: "success",
  summary: "Rendered hourly counts below each bar",
  filesChanged: ["client/src/components/admin/AnalyticsDashboardCard.tsx"],
  testsRun: [],
  checkResult: "passed",
  branch: TASK,
  headSha: BASE,
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
};

async function runWith(before: GitMetadataSnapshot, after: GitMetadataSnapshot): Promise<WorkerResult> {
  const runner = createFakeRunner(() => ({ exit: { stdout: JSON.stringify(report) } }));
  const git = createFakeGit([clean, edited], [...edited.dirtyPaths], [before, after]);
  const adapter = createCodexAdapter(
    { repoRoot: "/workspaces/oxm-platform", timeoutMs: 600_000 },
    { runner, git, promptFiles: createFakePromptFiles(), timer: createFakeTimer(), policyRuntime: { verify: async () => ({ ok: true }) } },
  );
  return adapter.start({ contract: contract(before.digest), now: "2026-10-10T03:51:09.000Z" }).result;
}

describe("runtime Worker: classified metadata delta instead of an opaque digest", () => {
  it("11. t261010-a61cac: frontend task + IDE caches + repack during the run reaches review as a success", async () => {
    const { before, after } = await during((f) => {
      f.git("config", "--local", `branch.${TASK}.github-pr-base-branch`, "scottsusu0513-bot#oxm-platform#agent/gpt-manager-live-e2e");
      f.git("config", "--local", `branch.${TASK}.vscode-merge-base`, "origin/main");
      f.git("update-server-info");
    });
    const r = await runWith(before, after);
    expect(r).toMatchObject({ status: "success", errorType: null, filesChanged: edited.dirtyPaths });
    expect(r.riskObserved.level).toBe("green");
    expect(r.gitMetadata).toMatchObject({ workerViolation: false, publicationTrust: "trusted" });
    expect(r.gitMetadata?.changes.map((c) => [c.component, c.classification])).toEqual([
      ["repo.config_integration", "benign_integration_change"],
      ["repo.info_server", "benign_integration_change"],
    ]);
  });

  it("environment change during the run: implementation kept, publication needs re-established trust", async () => {
    const { before, after } = await during((f) => writeFileSync(join(f.home, ".gitconfig"), "[user]\n\tname = someone\n"));
    const r = await runWith(before, after);
    expect(r).toMatchObject({ status: "success", errorType: null });
    expect(r.riskObserved.level).toBe("green");
    expect(r.gitMetadata).toMatchObject({ workerViolation: false, publicationTrust: "refresh_required", changes: [{ component: "env.global_config", classification: "environment_change" }] });
    expect(r.riskObserved.notes.join(" ")).toMatch(/not attributed to the Worker/);
  });

  it("security-relevant change attributable to the Worker: hard failure with the component named", async () => {
    const { before, after } = await during((f) => writeFileSync(join(f.root, ".git", "hooks", "post-checkout"), "#!/bin/sh\n"));
    const r = await runWith(before, after);
    expect(r).toMatchObject({ status: "failure", errorType: "git_metadata_changed", needsApproval: true, filesChanged: [] });
    expect(r.riskObserved.level).toBe("red");
    expect(r.summary).toContain("repo.hooks=worker_security_violation");
    expect(r.gitMetadata).toMatchObject({ workerViolation: true, publicationTrust: "blocked", changes: [{ component: "repo.hooks", entries: ["git:hooks/post-checkout"] }] });
  });
});
