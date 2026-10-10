import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { validateCodespaceIdentity } from "../codespace/client";
import { isSafeWorkspaceRoot } from "../codespace/policy";
import { checkLiveSafety } from "../e2e/liveAdapters";
import { createHumanOwnerSession } from "../humanInteraction/auth";
import { createInMemoryAuditRepository } from "../store/memory";
import type { ProcessExit, ProcessRunner } from "../workers/types";
import { createAgentRuntime } from "./compose";
import { AGENT_RUNTIME_CONFIRMATION, readAgentRuntimeConfig } from "./config";
import { resolveRepoRoot } from "./repoRoot";
import { createRepoFileReader, createWorkingTreeDiff } from "./reviewEvidence";

const ok = (stdout = ""): ProcessExit => ({ exitCode: 0, signal: null, stdout, stderr: "", truncated: false });
const ENV = { OXM_AGENT_EXPECTED_REPO: "oxm/oxm-platform", CODESPACE_NAME: "oxm-space", OXM_AGENT_CODESPACE_NAME: "oxm-space", OXM_AGENT_CONFIRM: AGENT_RUNTIME_CONFIRMATION };

function safetyRunner(extra: (spec: { command: string; args: readonly string[] }) => ProcessExit | null = () => null): ProcessRunner {
  return {
    spawn(spec) {
      let result = extra(spec) ?? ok();
      if (spec.command === "git" && spec.args[0] === "rev-parse") result = ok(spec.args[1] === "HEAD" ? `${"a".repeat(40)}\n` : "agent/telegram-control-plane\n");
      else if (spec.command === "gh" && spec.args[0] === "repo") result = ok(JSON.stringify({ nameWithOwner: "oxm/oxm-platform" }));
      else if (spec.command === "gh" && spec.args[0] === "api") result = ok(JSON.stringify({ name: "oxm-space", state: "Available", repository: { full_name: "oxm/oxm-platform" } }));
      return { exit: Promise.resolve(result), kill() {} };
    },
  };
}

const BASE = realpathSync(mkdtempSync(join(tmpdir(), "oxm-repo-root-")));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

/** A temporary repository whose root looks like a GitHub Actions checkout (…/home/runner/work/<repo>/<repo>). */
function runnerStyleRepo(): string {
  const root = join(BASE, "home", "runner", "work", "oxm-platform", "oxm-platform");
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "client"), { recursive: true });
  writeFileSync(join(root, "client", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, ".git", "config"), "[core]\n");
  writeFileSync(join(root, ".env"), "SECRET=do-not-read\n");
  writeFileSync(join(root, ".env.local"), "SECRET=do-not-read\n");
  mkdirSync(join(root, "server"), { recursive: true });
  writeFileSync(join(root, "server", ".env"), "SECRET=do-not-read\n");
  writeFileSync(join(BASE, "outside.txt"), "outside\n");
  symlinkSync(join(BASE, "outside.txt"), join(root, "client", "escape.txt"));
  return root;
}
const REPO = runnerStyleRepo();
const owner = () => createHumanOwnerSession({ principalId: "telegram-owner", source: "telegram", now: () => new Date().toISOString() });
const configFor = (root: string) => {
  const r = readAgentRuntimeConfig(ENV, root);
  if (!r.ok) throw new Error(r.reason);
  return r.config;
};

describe("portable repository root", () => {
  it("accepts any absolute normalized root regardless of host layout", () => {
    for (const p of ["/workspaces/oxm-platform", "/home/runner/work/oxm-platform/oxm-platform", BASE, REPO]) expect(isSafeWorkspaceRoot(p), p).toBe(true);
    for (const p of ["", "/", "relative/repo", "/a/../b", "/a/./b", "/a//b", "/a/", "/a\0b"]) expect(isSafeWorkspaceRoot(p), JSON.stringify(p)).toBe(false);
  });

  it("resolves temporary and runner-style roots; nonexistent / non-directory / relative roots fail closed", () => {
    expect(resolveRepoRoot(BASE)).toEqual({ ok: true, root: BASE });
    expect(resolveRepoRoot(REPO)).toEqual({ ok: true, root: REPO });
    expect(resolveRepoRoot(join(BASE, "missing"))).toEqual({ ok: false, reason: "repository root does not exist or is not readable" });
    expect(resolveRepoRoot(join(BASE, "outside.txt"))).toEqual({ ok: false, reason: "repository root is not a directory" });
    expect(resolveRepoRoot("oxm-platform")).toMatchObject({ ok: false });
    expect(resolveRepoRoot("/")).toMatchObject({ ok: false });
  });

  it("config takes the injected root as-is and rejects unsafe roots", () => {
    expect(configFor("/home/runner/work/oxm-platform/oxm-platform").base).toMatchObject({ repoRoot: "/home/runner/work/oxm-platform/oxm-platform", workspacePath: "/home/runner/work/oxm-platform/oxm-platform" });
    expect(readAgentRuntimeConfig(ENV, "relative")).toEqual({ ok: false, reason: "repository root must be an absolute, normalized path" });
    expect(readAgentRuntimeConfig(ENV, "/home/runner/../etc")).toMatchObject({ ok: false });
  });

  it("live safety gate and Codespace identity no longer require a /workspaces prefix but keep traversal/binding checks", async () => {
    const good = await checkLiveSafety(configFor("/home/runner/work/oxm-platform/oxm-platform").base, safetyRunner(), { expectedConfirmation: AGENT_RUNTIME_CONFIRMATION, workerCommands: [{ kind: "codex", command: "codex" }] });
    expect(good.checks.find((c) => c.name === "workspace_binding")?.ok).toBe(true);
    const mismatch = await checkLiveSafety({ ...configFor(REPO).base, workspacePath: "/home/runner/work/other" }, safetyRunner(), { expectedConfirmation: AGENT_RUNTIME_CONFIRMATION });
    expect(mismatch).toMatchObject({ ok: false, failureCode: "safety_workspace_binding" });
    const traversal = await checkLiveSafety({ ...configFor(REPO).base, repoRoot: "/home/runner/../x", workspacePath: "/home/runner/../x" }, safetyRunner(), { expectedConfirmation: AGENT_RUNTIME_CONFIRMATION });
    expect(traversal.checks.find((c) => c.name === "workspace_binding")?.ok).toBe(false);

    const identity = { codespaceName: "oxm-space", repository: { owner: "oxm", repository: "oxm-platform" }, expectedRepository: { owner: "oxm", repository: "oxm-platform" }, sourceRepository: { owner: "oxm", repository: "oxm-platform" }, expectedBranch: "main" };
    expect(validateCodespaceIdentity({ ...identity, workspacePath: "/home/runner/work/oxm-platform/oxm-platform" })).toEqual({ ok: true });
    expect(validateCodespaceIdentity({ ...identity, workspacePath: "/workspaces/oxm-platform" })).toEqual({ ok: true });
    expect(validateCodespaceIdentity({ ...identity, workspacePath: "/workspaces/../etc" })).toEqual({ ok: false, reason: "unsafe workspace path" });
    expect(validateCodespaceIdentity({ ...identity, workspacePath: "relative" })).toEqual({ ok: false, reason: "unsafe workspace path" });
  });
});

describe("agent runtime outside /workspaces", () => {
  it("starts with a runner-style temporary repository root", async () => {
    const r = await createAgentRuntime(configFor(REPO), { audit: createInMemoryAuditRepository(() => "t"), owner: owner(), runner: safetyRunner() });
    expect(r.ok).toBe(true);
  });

  it("starts with the actual current repository root (Codespace or CI checkout)", async () => {
    const actual = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim());
    const r = await createAgentRuntime(configFor(actual), { audit: createInMemoryAuditRepository(() => "t"), owner: owner(), runner: safetyRunner() });
    expect(r.ok).toBe(true);
  });

  it("fails closed with a clear code when the repository root does not exist (no fallback)", async () => {
    const spawned: string[] = [];
    const runner: ProcessRunner = { spawn: (spec) => (spawned.push(spec.command), safetyRunner().spawn(spec)) };
    const r = await createAgentRuntime(configFor(join(BASE, "does-not-exist")), { audit: createInMemoryAuditRepository(() => "t"), owner: owner(), runner });
    expect(r).toMatchObject({ ok: false, code: "repo_root_unavailable", reason: "repository root does not exist or is not readable" });
    expect(spawned).toEqual([]);
  });
});

describe("repository file reader containment (portable root)", () => {
  const read = createRepoFileReader(REPO);

  it("reads regular files inside the root", () => {
    expect(read("client/a.ts")).toBe("export const a = 1;\n");
  });

  it("rejects traversal, absolute paths, symlink escapes, .git and .env files", () => {
    for (const p of ["../outside.txt", "client/../../outside.txt", join(BASE, "outside.txt"), "client/escape.txt", ".git/config", ".env", ".env.local", "server/.env", "client", "", "client//a.ts"]) expect(read(p), p).toBeNull();
  });

  it("throws clearly for a nonexistent root instead of reading elsewhere", () => {
    expect(() => createRepoFileReader(join(BASE, "missing"))).toThrow("repository file reader: repository root does not exist or is not readable");
    expect(() => createRepoFileReader("relative")).toThrow(/absolute, normalized path/);
  });

  it("working-tree diff never inlines protected untracked files", async () => {
    const runner = safetyRunner((spec) => (spec.command === "git" && spec.args[0] === "ls-files" ? ok(".env\nserver/.env\nclient/a.ts\n") : spec.command === "git" && spec.args[0] === "diff" ? ok("") : null));
    const diff = await createWorkingTreeDiff(runner, REPO)("a".repeat(40), ["client/a.ts", ".env", "server/.env"]);
    expect(diff).not.toContain("do-not-read");
    expect(diff).toContain("+export const a = 1;");
  });
});
