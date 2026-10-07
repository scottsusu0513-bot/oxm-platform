import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "./claudeCode";
import { createCodexAdapter } from "./codex";
import { createFakeGit, createFakePromptFiles, createFakeRunner, createFakeTimer, type FakeProcessBehavior } from "./fake";
import {
  decideWorkerAction,
  looksLikeInteractivePrompt,
  nonInteractiveViolation,
  WORKER_INTERACTIVE_PROMPTS_ALLOWED,
  type WorkerAction,
} from "./permissions";
import { createNodeProcessRunner } from "./processRunner";
import { buildClaudeArgs, buildCodexArgs, CLAUDE_ALLOWED_TOOLS, CLAUDE_DISALLOWED_TOOLS, CLAUDE_TOOLS, CLAUDE_WORKER_SETTINGS } from "./prompt";
import { createRuntimeWorkerAdapter } from "./runtimeWorker";
import type { GitStatus, ProcessSpec, WorkerReport, WorkerTaskContract } from "./types";
import { CODEX_POLICY_PROBES, CODEX_WORKER_RULES_PATH, createNativeCodexPolicyRuntime, requiredCodexPolicyDecision } from "./workerAdapter";

/**
 * Workers run unattended: ALLOW executes without confirmation, DENY fails
 * immediately, ORCHESTRATOR_APPROVAL_REQUIRED returns to the Manager. There
 * is no Yes/No prompt anywhere on the Worker path.
 */

const REPO = "/workspaces/oxm-platform";
const BRANCH = "agent/task-42";
const BASE = "a".repeat(40);
const NOW = "2026-10-04T00:00:00.000Z";
const SCOPE = ["server/db.ts", "server/search/"];

const contract = (over: Partial<WorkerTaskContract> = {}): WorkerTaskContract => ({
  taskId: "task-42",
  runId: "run-1",
  category: "backend",
  actions: [{ kind: "code_edit" }, { kind: "run_tests" }],
  objective: "Fix the factory search pagination bug",
  allowedScope: ["server/db.ts"],
  acceptanceCriteria: ["page 2 returns the next 20 results"],
  requiredValidations: ["tests", "typecheck"],
  branch: BRANCH,
  ...over,
});
const report = (over: Partial<WorkerReport> = {}): WorkerReport => ({
  status: "success",
  summary: "Fixed offset calculation",
  filesChanged: ["server/db.ts"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: BRANCH,
  headSha: BASE,
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  ...over,
});
const envelope = (r: unknown) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(r) });
const clean: GitStatus = { branch: BRANCH, headSha: BASE, dirtyPaths: [] };
const edited: GitStatus = { branch: BRANCH, headSha: BASE, dirtyPaths: ["server/db.ts"] };

function claude(behavior: (s: ProcessSpec) => FakeProcessBehavior, changed = ["server/db.ts"]) {
  const runner = createFakeRunner(behavior);
  const timer = createFakeTimer();
  const adapter = createClaudeCodeAdapter({ model: "claude-opus-5-5", repoRoot: REPO, timeoutMs: 600_000 }, { runner, git: createFakeGit([clean, edited], changed), promptFiles: createFakePromptFiles(), timer });
  return { runner, timer, adapter };
}
const flush = async (until: () => boolean) => {
  for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setImmediate(r));
};
const argAfter = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];
const listAfter = (args: readonly string[], name: string, end?: string) => args.slice(args.indexOf(name) + 1, end ? args.indexOf(end) : undefined);

/** Representative argv for a Claude "Bash(prefix:*)" / "Bash(cmd)" rule. */
const bashArgv = (rule: string) => rule.replace(/^Bash\(/, "").replace(/\)$/, "").replace(/:\*$/, "").split(" ");
const toolAction = (rule: string): WorkerAction => {
  const m = /^(Edit|Write|Read)\((.+)\)$/.exec(rule);
  if (m) return { kind: m[1].toLowerCase() as "edit" | "write" | "read", path: m[2].replace(/\*\*$/, "x").replace(/\.\*$/, ".local") };
  return { kind: "command", argv: bashArgv(rule) };
};

describe("ALLOW / DENY / ORCHESTRATOR_APPROVAL_REQUIRED model", () => {
  it.each<[string, WorkerAction, string]>([
    ["read", { kind: "read", path: "server/db.ts" }, "ALLOW"],
    ["search", { kind: "search" }, "ALLOW"],
    ["in-scope edit", { kind: "edit", path: "server/search/filter.ts" }, "ALLOW"],
    ["in-scope write", { kind: "write", path: "server/db.ts" }, "ALLOW"],
    ["pnpm test", { kind: "command", argv: ["pnpm", "test"] }, "ALLOW"],
    ["pnpm check", { kind: "command", argv: ["pnpm", "check"] }, "ALLOW"],
    ["pnpm build", { kind: "command", argv: ["pnpm", "build"] }, "ALLOW"],
    ["vitest", { kind: "command", argv: ["pnpm", "vitest", "run", "x.test.ts"] }, "ALLOW"],
    ["git status", { kind: "command", argv: ["git", "status", "--short"] }, "ALLOW"],
    ["git diff", { kind: "command", argv: ["git", "diff"] }, "ALLOW"],
    ["git log", { kind: "command", argv: ["git", "log", "-1"] }, "ALLOW"],
    ["git rev-parse", { kind: "command", argv: ["git", "rev-parse", "HEAD"] }, "ALLOW"],
    ["git ls-files", { kind: "command", argv: ["git", "ls-files"] }, "ALLOW"],
    ["ls", { kind: "command", argv: ["ls", "-la"] }, "ALLOW"],
    ["git add", { kind: "command", argv: ["git", "add", "."] }, "DENY"],
    ["git commit", { kind: "command", argv: ["git", "commit", "-m", "x"] }, "DENY"],
    ["git push", { kind: "command", argv: ["git", "push", "--force"] }, "DENY"],
    ["git switch", { kind: "command", argv: ["git", "switch", "main"] }, "DENY"],
    ["git config", { kind: "command", argv: ["git", "config", "user.name", "x"] }, "DENY"],
    ["git remote", { kind: "command", argv: ["git", "remote", "add", "x", "y"] }, "DENY"],
    ["gh", { kind: "command", argv: ["gh", "pr", "merge", "1"] }, "DENY"],
    ["deploy", { kind: "command", argv: ["vercel", "--prod"] }, "DENY"],
    ["db push", { kind: "command", argv: ["pnpm", "db:push"] }, "DENY"],
    ["nested agent", { kind: "command", argv: ["claude", "--dangerously-skip-permissions"] }, "DENY"],
    ["unknown command", { kind: "command", argv: ["python3", "-c", "1"] }, "DENY"],
    [".git write", { kind: "write", path: ".git/config" }, "DENY"],
    [".git/HEAD edit", { kind: "edit", path: ".git/HEAD" }, "DENY"],
    ["own permissions file", { kind: "edit", path: ".claude/settings.json" }, "DENY"],
    ["codex rules", { kind: "write", path: ".codex/rules/worker.rules" }, "DENY"],
    ["change permission mode", { kind: "change_permissions" }, "DENY"],
    [".env read", { kind: "read", path: ".env" }, "DENY"],
    ["out-of-scope write", { kind: "write", path: "client/src/App.tsx" }, "ORCHESTRATOR_APPROVAL_REQUIRED"],
  ])("%s", (_label, action, expected) => {
    expect(decideWorkerAction(action, SCOPE).decision).toBe(expected);
  });

  it("the Claude allow/deny lists agree with the model (allowed = ALLOW, disallowed = DENY)", () => {
    for (const rule of CLAUDE_ALLOWED_TOOLS.filter((r) => r.startsWith("Bash("))) expect(decideWorkerAction(toolAction(rule), SCOPE).decision, rule).toBe("ALLOW");
    for (const rule of CLAUDE_DISALLOWED_TOOLS.filter((r) => /^(Bash|Edit|Write|Read)\(/.test(r))) expect(decideWorkerAction(toolAction(rule), SCOPE).decision, rule).toBe("DENY");
  });

  it("the Codex exec policy agrees with the model and contains no prompt decisions", () => {
    for (const probe of CODEX_POLICY_PROBES) {
      expect(decideWorkerAction({ kind: "command", argv: probe.command }, SCOPE).decision, probe.command.join(" ")).toBe(probe.decision === "forbidden" ? "DENY" : "ALLOW");
    }
    for (const op of "add commit switch checkout branch merge rebase reset push config remote".split(" ")) {
      expect(requiredCodexPolicyDecision(["git", op])).toBe("forbidden");
      expect(decideWorkerAction({ kind: "command", argv: ["git", op] }, SCOPE).decision).toBe("DENY");
    }
    const rules = readFileSync(join(resolve(__dirname, "../../.."), CODEX_WORKER_RULES_PATH), "utf8");
    expect(rules).not.toMatch(/decision\s*=\s*"prompt"/);
    expect(rules.match(/decision\s*=\s*"(\w+)"/g)?.every((d) => d.includes("forbidden"))).toBe(true);
  });
});

describe("non-interactive runtime configuration", () => {
  it("workerInteractivePromptsAllowed is false", () => {
    expect(WORKER_INTERACTIVE_PROMPTS_ALLOWED).toBe(false);
  });

  it("Claude runs headless with dontAsk, no prompt answerer, no external settings/MCP, bypass disabled", () => {
    const args = buildClaudeArgs("claude-opus-5-5");
    expect(nonInteractiveViolation("claude", args)).toBeNull();
    expect(argAfter(args, "--permission-mode")).toBe("dontAsk");
    expect(argAfter(args, "--permission-prompts")).toBe("none");
    expect(argAfter(args, "--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(argAfter(args, "--settings"))).toEqual({ permissions: { defaultMode: "dontAsk", disableBypassPermissionsMode: "disable" } });
    expect(argAfter(args, "--tools")).toBe(CLAUDE_TOOLS.join(","));
    expect(JSON.parse(CLAUDE_WORKER_SETTINGS).permissions.allow).toBeUndefined(); // settings never widen the allowlist
    for (const t of ["Read", "Edit", "Write", "Bash(pnpm test:*)", "Bash(pnpm check)", "Bash(pnpm vitest run:*)"]) {
      expect(listAfter(args, "--allowedTools", "--disallowedTools")).toContain(t);
    }
  });

  it.each([
    ["acceptEdits (prompts for Bash)", (a: string[]) => a.map((x) => (x === "dontAsk" ? "acceptEdits" : x))],
    ["permission prompts answered by a host", (a: string[]) => a.map((x) => (x === "none" ? "host" : x))],
    ["bypass permissions", (a: string[]) => [...a, "--dangerously-skip-permissions"]],
    ["allow bypass", (a: string[]) => [...a, "--allow-dangerously-skip-permissions"]],
    ["permission prompt tool", (a: string[]) => [...a, "--permission-prompt-tool", "mcp__x"]],
    ["user/project settings loaded", (a: string[]) => a.filter((x, i) => !(x === "" && a[i - 1] === "--setting-sources") && x !== "--setting-sources")],
    ["second permission mode", (a: string[]) => [...a, "--permission-mode", "bypassPermissions"]],
  ])("Claude preflight rejects %s", (_label, mutate) => {
    expect(nonInteractiveViolation("claude", mutate(buildClaudeArgs("claude-opus-5-5")))).not.toBeNull();
  });

  it("Codex runs exec with approval_policy=never and rejects bypass/approval routing", () => {
    const args = buildCodexArgs("gpt-6.1-codex", REPO);
    expect(nonInteractiveViolation("codex", args)).toBeNull();
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('permissions.worker.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read",".codex/rules"="read"},":tmpdir"="write",":slash_tmp"="write"}');
    expect(nonInteractiveViolation("codex", args.filter((a) => a !== 'approval_policy="never"'))).not.toBeNull();
    expect(nonInteractiveViolation("codex", [...args, "-c", 'approval_policy="on-request"'])).not.toBeNull();
    expect(nonInteractiveViolation("codex", [...args, "--dangerously-bypass-approvals-and-sandbox"])).not.toBeNull();
    expect(nonInteractiveViolation("codex", [...args, "--approve-for-me"])).not.toBeNull();
    expect(nonInteractiveViolation("codex", [...args, "--sandbox", "danger-full-access"])).not.toBeNull();
  });

  it("the native Codex runtime check refuses a configuration without approval_policy=never", async () => {
    const runner = createFakeRunner(() => ({ exit: { stdout: "codex-cli 0.160.0" } }));
    const runtime = createNativeCodexPolicyRuntime(runner);
    const repo = resolve(__dirname, "../../..");
    const args = buildCodexArgs(undefined, repo).filter((a) => a !== 'approval_policy="never"');
    expect(await runtime.verify({ command: "codex", repoRoot: repo, args })).toMatchObject({ ok: false, errorType: "runtime_misconfigured" });
  });

  it("an adapter whose argv could prompt is refused before any process starts", async () => {
    const runner = createFakeRunner(() => ({ exit: { stdout: envelope(report()) } }));
    const adapter = createRuntimeWorkerAdapter(
      { kind: "claude", command: "claude", repoRoot: REPO, timeoutMs: 1000, buildArgs: () => buildClaudeArgs("m").map((a) => (a === "dontAsk" ? "acceptEdits" : a)), parseOutput: () => ({ ok: false, reason: "x" }) },
      { runner, git: createFakeGit([clean, edited], ["server/db.ts"]), promptFiles: createFakePromptFiles(), timer: createFakeTimer() },
    );
    const r = await adapter.start({ contract: contract(), now: NOW }).result;
    expect(r).toMatchObject({ status: "failure", errorType: "runtime_misconfigured" });
    expect(runner.specs).toHaveLength(0);
  });
});

describe("unattended execution", () => {
  it("Claude allowed read/edit/test completes with zero confirmations (one process, prompt-only stdin)", async () => {
    const { runner, adapter } = claude(() => ({ exit: { stdout: envelope(report()) } }));
    const r = await adapter.start({ contract: contract(), now: NOW }).result;
    expect(r).toMatchObject({ status: "success", errorType: null, filesChanged: ["server/db.ts"] });
    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0].stdinFile).toMatch(/^\/tmp\//); // the prompt is the only stdin; there is no answer channel
    expect(nonInteractiveViolation("claude", runner.specs[0].args)).toBeNull();
  });

  it("Codex allowed edit/test completes with zero confirmations", async () => {
    const runner = createFakeRunner(() => ({ exit: { stdout: JSON.stringify(report({ filesChanged: ["server/db.ts"] })) } }));
    const adapter = createCodexAdapter(
      { repoRoot: REPO, timeoutMs: 600_000 },
      { runner, git: createFakeGit([clean, edited], ["server/db.ts"]), promptFiles: createFakePromptFiles(), timer: createFakeTimer(), policyRuntime: { verify: async () => ({ ok: true }) } },
    );
    const r = await adapter.start({ contract: contract(), now: NOW }).result;
    expect(r).toMatchObject({ status: "success", errorType: null });
    expect(runner.specs).toHaveLength(1);
    expect(nonInteractiveViolation("codex", runner.specs[0].args)).toBeNull();
  });

  it("an out-of-scope write returns a structured scope_violation to the Manager, not a prompt", async () => {
    const { adapter } = claude(() => ({ exit: { stdout: envelope(report({ filesChanged: ["server/db.ts", "client/src/App.tsx"] })) } }), ["server/db.ts", "client/src/App.tsx"]);
    const r = await adapter.start({ contract: contract(), now: NOW }).result;
    expect(r).toMatchObject({ status: "failure", errorType: "scope_violation", needsApproval: true });
  });

  it("a run that stalls on an interactive prompt is a runtime configuration defect, not a transient timeout", async () => {
    const { runner, timer, adapter } = claude(() => ({}));
    const h = adapter.start({ contract: contract(), now: NOW });
    await flush(() => runner.specs.length > 0);
    const spawned = runner.specs.length;
    timer.fire();
    const r = await h.result;
    expect(spawned).toBe(1);
    expect(r.errorType).toBe("timeout"); // no prompt text: ordinary timeout

    const stalled = claude(() => ({ killOutput: { stdout: "Bash(git add .)\nDo you want to proceed? (y/n)" } }));
    const h2 = stalled.adapter.start({ contract: contract(), now: NOW });
    await flush(() => stalled.runner.specs.length > 0);
    stalled.timer.fire();
    const r2 = await h2.result;
    expect(r2).toMatchObject({ status: "failure", errorType: "runtime_misconfigured" });
    expect(r2.summary).toContain("interactive confirmation prompt");

    const prompted = claude(() => ({ exit: { exitCode: 1, stderr: "Allow once / Allow always" } }));
    const r3 = await prompted.adapter.start({ contract: contract(), now: NOW }).result;
    expect(r3).toMatchObject({ status: "failure", errorType: "runtime_misconfigured" });
  });

  it("interactive prompt detection", () => {
    for (const text of ["Do you want to proceed?", "Allow once / Allow always", "Continue? [Y/n]", "waiting for approval", "Press Enter to continue"]) expect(looksLikeInteractivePrompt(text), text).toBe(true);
    for (const text of ['{"type":"result","result":"done"}', "Permission to use Bash(git add) has been denied."]) expect(looksLikeInteractivePrompt(text), text).toBe(false);
  });
});

describe("real process: no stdin answer channel", () => {
  const scratch = mkdtempSync(join(tmpdir(), "oxm-noninteractive-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const runner = createNodeProcessRunner({ killGraceMs: 200 });
  // A child that reads its prompt and then waits for a "y" answer must see EOF, not hang.
  const askScript = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('EOF tty='+String(process.stdin.isTTY)+' len='+d.length))";

  it("after the prompt file, stdin is at EOF (a Yes/No read cannot block)", async () => {
    const f = join(scratch, "prompt.txt");
    writeFileSync(f, "task prompt");
    const res = await Promise.race([
      runner.spawn({ command: process.execPath, args: ["-e", askScript], cwd: scratch, stdinFile: f }).exit,
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    expect(res?.stdout).toBe("EOF tty=undefined len=11");
  });

  it("without a prompt file stdin is closed immediately", async () => {
    const res = await Promise.race([
      runner.spawn({ command: process.execPath, args: ["-e", askScript], cwd: scratch }).exit,
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]);
    expect(res?.stdout).toBe("EOF tty=undefined len=0");
  });
});
