import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { AnthropicMessagesTransport } from "../planning/anthropicHttp";
import { createClaudeCliPlanningBackend, fixedPlanningWorkspace } from "../planning/claudeCli";
import { readPlanningProviderConfig } from "../planning/provider";
import { createSimulation } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { createNodeProcessRunner, realTimer } from "../workers/processRunner";
import type { ProcessExit, ProcessRunner, ProcessSpec, Timer } from "../workers/types";
import { createNodePlanningProcessPort, createPlanningBackend, createTempPlanningWorkspace, PLANNING_WORKDIR_PREFIX, type PlanningBackendDeps } from "./planningBackend";

const REPO = "/workspaces/oxm-platform";
const WORK = "/tmp/oxm-planner-test";
const KEY = "sk-ant-api03-TESTKEYTESTKEYTESTKEY";
const MSG = "幫我把搜尋 loading 做順一點";
const PLAN = { intent: "change_code", taskId: null, title: "loading", interpretedObjective: "Make the search waiting state responsive.", criteria: ["Waiting state gives visible feedback immediately"], clarificationQuestion: "", riskObservations: [] };
const AUTH_OK = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@example.com" });
const result = (fields: Record<string, unknown>) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", ...fields });
const exit = (stdout: string, exitCode = 0, stderr = ""): ProcessExit => ({ exitCode, signal: null, stdout, stderr, truncated: false });
const neverFires: Timer = { schedule: () => () => {} };

/** Scripted fake CLI: `auth status` answers the preflight; every other call takes the next planning reply. */
function fakeCli(input: { auth?: ProcessExit; replies?: ((spec: ProcessSpec) => ProcessExit)[] } = {}): ProcessRunner & { specs: ProcessSpec[] } {
  const specs: ProcessSpec[] = [];
  let n = 0;
  return {
    specs,
    spawn(spec) {
      specs.push(spec);
      const replies = input.replies ?? [() => exit(result({ structured_output: PLAN }))];
      const out = spec.args[0] === "auth" ? (input.auth ?? exit(AUTH_OK)) : replies[Math.min(n++, replies.length - 1)](spec);
      return { exit: Promise.resolve(out), kill: () => {} };
    },
  };
}

function deps(runner: ProcessRunner, extra: Partial<PlanningBackendDeps> = {}): PlanningBackendDeps {
  return { runner, timer: neverFires, workspace: fixedPlanningWorkspace(WORK), repoRoot: REPO, ...extra };
}

afterEach(() => vi.unstubAllGlobals());

describe("planner provider configuration", () => {
  it("defaults to the GPT Manager on codex_cli and needs no API key", () => {
    expect(readPlanningProviderConfig({})).toMatchObject({ ok: true, config: { provider: "codex_cli", model: null, command: "codex" } });
    expect(readPlanningProviderConfig({ OPENAI_API_KEY: "sk-test-not-used" })).toMatchObject({ ok: true, config: { provider: "codex_cli" } });
  });

  it("claude_cli stays selectable explicitly", () => {
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli" })).toMatchObject({ ok: true, config: { provider: "claude_cli", model: "claude-opus-5-5", command: "claude" } });
    expect(readPlanningProviderConfig({ OXM_AGENT_MANAGER_PROVIDER: "claude_cli" })).toMatchObject({ ok: true, config: { provider: "claude_cli" } });
    expect(readPlanningProviderConfig({ OXM_AGENT_MANAGER_PROVIDER: "codex_cli", OXM_AGENT_PLANNER_PROVIDER: "claude_cli" })).toMatchObject({ ok: false, code: "invalid_planner_provider" });
  });

  it("a present ANTHROPIC_API_KEY never switches the provider implicitly", () => {
    const r = readPlanningProviderConfig({ ANTHROPIC_API_KEY: KEY });
    expect(r).toMatchObject({ ok: true, config: { provider: "codex_cli" } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("explicit anthropic_api requires ANTHROPIC_API_KEY", () => {
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_PROVIDER: "anthropic_api" })).toMatchObject({ ok: false, code: "missing_anthropic_api_key" });
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_PROVIDER: "anthropic_api", ANTHROPIC_API_KEY: KEY })).toMatchObject({ ok: true, config: { provider: "anthropic_api", apiKey: KEY } });
  });

  it.each(["openai", "CLAUDE_CLI", "auto", "claude_cli,anthropic_api"])("invalid provider %s fails closed", (value) => {
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_PROVIDER: value, ANTHROPIC_API_KEY: KEY })).toMatchObject({ ok: false, code: "invalid_planner_provider" });
  });

  it("invalid model / timeout fail closed; OXM_AGENT_PLANNER=off still disables explicitly", () => {
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_MODEL: "--dangerously-skip-permissions" })).toMatchObject({ ok: false, code: "invalid_planner_model" });
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER_TIMEOUT_MS: "5" })).toMatchObject({ ok: false, code: "invalid_planner_timeout" });
    expect(readPlanningProviderConfig({ OXM_AGENT_PLANNER: "off" })).toEqual({ ok: true, config: { provider: "off" } });
  });
});

describe("Agent runtime planning composition", () => {
  it("no ANTHROPIC_API_KEY + healthy Claude CLI: planner configured and natural-language intake creates a task", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const http = vi.fn();
    const cli = fakeCli();
    const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli", PATH: "/usr/bin", HOME: "/home/owner" }, deps(cli, { createHttpTransport: http }));
    expect(built).toMatchObject({ ok: true, provider: "claude_cli" });
    if (!built.ok || built.provider === "off") throw new Error("unreachable");
    expect(built.diagnostics.join("\n")).toMatch(/claude_cli .*no API key used/);
    expect(built.diagnostics.join("\n")).toMatch(/natural-language intake, semantic goal review, GPT repair diagnosis, guidance interpretation, combined review/);
    expect(built.diagnostics.join("\n")).not.toMatch(/unavailable|owner@example\.com/);

    const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
    const sim = createSimulation({ autoApproveCommits: false });
    const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: built.planner, idPrefix: "o" });
    await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${MSG}` });
    await sim.loop.settle();
    expect(sim.loop.task("o-task-1")).toBeTruthy();
    // Preflight + one planning call, both through the CLI; never HTTP.
    expect(cli.specs.map((s) => s.args[0])).toEqual(["auth", "-p"]);
    expect(cli.specs[1].stdinText).toContain(MSG);
    expect(http).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("provider=claude_cli never invokes the Anthropic HTTP transport, even when a key is present", async () => {
    const http = vi.fn();
    const cli = fakeCli({ replies: [() => exit(result({ structured_output: { criteria: [] } }))] });
    const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli", ANTHROPIC_API_KEY: KEY, PATH: "/usr/bin" }, deps(cli, { createHttpTransport: http }));
    if (!built.ok || built.provider !== "claude_cli") throw new Error("expected claude_cli");
    await built.reviewer.review({ mode: "change", intent: "change_code", title: "t", originalRequest: "r", interpretedObjective: "o", criteria: [], validations: [], diff: "", diffTruncated: false, answer: null, citedFiles: [] });
    expect(http).not.toHaveBeenCalled();
    for (const spec of cli.specs) expect(JSON.stringify(spec)).not.toContain(KEY);
    for (const spec of cli.specs) expect(spec.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("provider=anthropic_api uses the existing HTTP transport, reports API billing, and never spawns the CLI", async () => {
    const createMessage = vi.fn<AnthropicMessagesTransport["createMessage"]>(async () => ({ stopReason: "end_turn", text: JSON.stringify(PLAN) }));
    const http = vi.fn((apiKey: string) => {
      expect(apiKey).toBe(KEY);
      return { createMessage };
    });
    const cli = fakeCli();
    const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "anthropic_api", ANTHROPIC_API_KEY: KEY }, deps(cli, { createHttpTransport: http }));
    if (!built.ok || built.provider !== "anthropic_api") throw new Error("expected anthropic_api");
    expect(built.diagnostics.join("\n")).toMatch(/anthropic_api \(Anthropic API BILLING ACTIVE/);
    expect(built.diagnostics.join("\n")).not.toContain(KEY);
    expect(await built.planner.interpret({ message: MSG, contextTaskId: null, tasks: [], requireTask: false })).toEqual(PLAN);
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(cli.specs).toEqual([]);
  });

  it.each<[string, Partial<{ auth: ProcessExit }>, string]>([
    ["not authenticated", { auth: exit(JSON.stringify({ loggedIn: false, authMethod: "none" }), 1) }, "claude_cli_not_authenticated"],
    ["API-billed CLI login", { auth: exit(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })) }, "claude_cli_non_subscription_auth"],
  ])("an unavailable configured claude_cli fails closed (%s) — no fallback to the API", async (_label, cli, code) => {
    const http = vi.fn();
    const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli", ANTHROPIC_API_KEY: KEY }, deps(fakeCli(cli), { createHttpTransport: http }));
    expect(built).toMatchObject({ ok: false, code });
    expect(http).not.toHaveBeenCalled();
  });

  it("missing Claude CLI executable is typed and its preflight directory is removed (real process runner)", async () => {
    const base = mkdtempSync(join(tmpdir(), "oxm-ws-base-"));
    try {
      const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli", OXM_AGENT_PLANNER_CLAUDE_COMMAND: "/nonexistent/oxm/claude", PATH: "/usr/bin" }, { workspace: createTempPlanningWorkspace({ repoRoot: REPO, base }), repoRoot: REPO });
      expect(built).toMatchObject({ ok: false, code: "claude_cli_executable_unavailable" });
      expect(readdirSync(base)).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a planner working directory inside the repository", async () => {
    // A dedicated fixture repository: the in-repo base really exists, so the refusal comes from the containment check.
    const repo = mkdtempSync(join(tmpdir(), "oxm-repo-fixture-"));
    try {
      const inRepo = join(repo, "orchestrator");
      mkdirSync(inRepo);
      writeFileSync(join(inRepo, "sentinel.txt"), "keep");
      const cli = fakeCli();
      const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli" }, deps(cli, { workspace: fixedPlanningWorkspace(inRepo), repoRoot: repo }));
      expect(built).toMatchObject({ ok: false, code: "claude_cli_workspace_unavailable" });
      expect(cli.specs).toEqual([]);
      expect(createTempPlanningWorkspace({ repoRoot: repo, base: inRepo }).acquire).toThrow(expect.objectContaining({ kind: "workspace_unavailable" }));
      expect(readdirSync(repo)).toEqual(["orchestrator"]);
      expect(readdirSync(inRepo)).toEqual(["sentinel.txt"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("invalid provider fails closed before anything is spawned", async () => {
    const cli = fakeCli();
    expect(await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "gpt" }, deps(cli))).toMatchObject({ ok: false, code: "invalid_planner_provider" });
    expect(cli.specs).toEqual([]);
  });
});

describe("Claude CLI planning over a real process (fake `claude` executable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "oxm-fake-claude-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const port = createNodePlanningProcessPort(createNodeProcessRunner({ maxOutputBytes: 64 * 1024, killGraceMs: 200 }), realTimer);
  const ws = fixedPlanningWorkspace(dir);

  it("receives the prompt on stdin, no API key in its environment, and returns structured output", async () => {
    const echo = script("echo-claude", `IN=$(cat); KEY=\${ANTHROPIC_API_KEY:-none}; printf '{"type":"result","subtype":"success","is_error":false,"structured_output":{"key":"%s","stdinBytes":%s}}' "$KEY" "$(printf %s "$IN" | wc -c)"`);
    const backend = createClaudeCliPlanningBackend({ process: port, workspace: ws, env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: KEY }, model: "claude-opus-5-5", command: echo, timeoutMs: 10_000 });
    expect(await backend.structured({ system: "s", user: "hello", schema: {}, maxTokens: 1 })).toEqual({ key: "none", stdinBytes: 5 });
  });

  it("is killed and typed as timeout when it exceeds its deadline", async () => {
    const slow = script("slow-claude", "sleep 30");
    const backend = createClaudeCliPlanningBackend({ process: port, workspace: ws, env: { PATH: process.env.PATH }, model: "claude-opus-5-5", command: slow, timeoutMs: 300 });
    const started = Date.now();
    await expect(backend.structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })).rejects.toMatchObject({ kind: "timeout", transient: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("unbounded output is cut off and fails closed", async () => {
    const noisy = script("noisy-claude", "yes x | head -c 200000");
    const backend = createClaudeCliPlanningBackend({ process: port, workspace: ws, env: { PATH: process.env.PATH }, model: "claude-opus-5-5", command: noisy, timeoutMs: 10_000 });
    await expect(backend.structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })).rejects.toMatchObject({ kind: "output_too_large" });
  });

  it("non-zero exit is a typed process error that does not leak stderr", async () => {
    const failing = script("failing-claude", `echo "boom ${KEY}" >&2; exit 3`);
    const backend = createClaudeCliPlanningBackend({ process: port, workspace: ws, env: { PATH: process.env.PATH }, model: "claude-opus-5-5", command: failing, timeoutMs: 10_000 });
    const error = (await backend.structured({ system: "s", user: "u", schema: {}, maxTokens: 1 }).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ kind: "process_error", exitCode: 3 });
    expect(error.message).not.toContain(KEY);
  });
});

describe("a transient Claude CLI reviewer failure never consumes a Manager-guided repair cycle", () => {
  it("rate-limited review → waiting_infrastructure (attempt 0, one Worker run); retry judges the SAME run", async () => {
    const replies = [
      () => exit(result({ is_error: true, api_error_status: 429, result: "rate limited" }), 1),
      (spec: ProcessSpec) => {
        const ids = Array.from((spec.stdinText ?? "").matchAll(/^- ([\w-]+): /gm), (m) => m[1]);
        return exit(result({ structured_output: { criteria: ids.map((id) => ({ id, status: "satisfied", evidence: "diff", reason: "" })) } }));
      },
    ];
    const built = await createPlanningBackend({ OXM_AGENT_PLANNER_PROVIDER: "claude_cli" }, deps(fakeCli({ replies })));
    if (!built.ok || built.provider !== "claude_cli") throw new Error("expected claude_cli");
    const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
    const sim = createSimulation({ autoApproveCommits: false, goalReviewer: built.reviewer });
    const planner = { interpret: async () => PLAN };
    const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "o" });
    await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${MSG}` });
    await sim.loop.settle();
    const t = sim.loop.task("o-task-1")!;
    expect(t).toMatchObject({ status: "waiting_infrastructure", pendingReview: true, repair: { attempt: 0 } });
    expect(t.repairCycles).toEqual([]);
    expect(sim.workerCalls).toHaveLength(1);
    await sim.send({ type: "review_retry", taskId: "o-task-1" });
    expect(sim.loop.task("o-task-1")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish", repair: { attempt: 0 } });
    expect(sim.workerCalls).toHaveLength(1);
  });
});

describe("temporary planner working directories are removed after every real CLI invocation", () => {
  const scripts = mkdtempSync(join(tmpdir(), "oxm-fake-claude-bin-"));
  const base = mkdtempSync(join(tmpdir(), "oxm-ws-base-"));
  afterAll(() => {
    chmodSync(base, 0o755);
    rmSync(base, { recursive: true, force: true });
    rmSync(scripts, { recursive: true, force: true });
  });
  const script = (name: string, body: string) => {
    const path = join(scripts, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const port = createNodePlanningProcessPort(createNodeProcessRunner({ maxOutputBytes: 64 * 1024, killGraceMs: 200 }), realTimer);
  const run = (command: string, timeoutMs = 10_000) =>
    createClaudeCliPlanningBackend({ process: port, workspace: createTempPlanningWorkspace({ repoRoot: REPO, base }), env: { PATH: process.env.PATH }, model: "claude-opus-5-5", command, timeoutMs })
      .structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })
      .then(
        () => "ok",
        (e: { kind: string }) => e.kind,
      );
  const ok = `printf '{"type":"result","subtype":"success","is_error":false,"structured_output":{"cwd":"%s"}}' "$PWD"`;

  it.each<[string, string, string, number?]>([
    ["successful call", ok, "ok"],
    // The child even leaves a file behind in its cwd; the whole leased directory is still removed.
    ["successful call that wrote into its cwd", `touch leftover.txt; ${ok}`, "ok"],
    ["malformed output", "echo 'not json'", "malformed_output"],
    ["non-zero exit", "echo boom >&2; exit 4", "process_error"],
    ["timeout (killed)", "sleep 30", "timeout", 300],
  ])("%s leaves no temp dir", async (_label, body, kind, timeoutMs) => {
    expect(await run(script(`c-${kind}-${Math.random().toString(36).slice(2)}`, body), timeoutMs)).toBe(kind);
    expect(readdirSync(base)).toEqual([]);
  });

  it("the CLI really ran inside a fresh planner directory under the base", async () => {
    let seen = "";
    const backend = createClaudeCliPlanningBackend({ process: port, workspace: createTempPlanningWorkspace({ repoRoot: REPO, base }), env: { PATH: process.env.PATH }, model: "claude-opus-5-5", command: script("pwd-claude", ok) });
    seen = ((await backend.structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })) as { cwd: string }).cwd;
    expect(seen.startsWith(join(base, PLANNING_WORKDIR_PREFIX))).toBe(true);
    expect(existsSync(seen)).toBe(false);
  });

  it("a cleanup failure does not replace the original typed error (and success still succeeds)", async () => {
    // Make the base read-only while the child runs so removing the leased directory fails (EACCES).
    const lockBase = `chmod 555 ${JSON.stringify(base).slice(1, -1)}`;
    expect(await run(script("fail-locked", `${lockBase}; exit 5`))).toBe("process_error");
    chmodSync(base, 0o755);
    expect(await run(script("timeout-locked", `${lockBase}; sleep 30`), 300)).toBe("timeout");
    chmodSync(base, 0o755);
    expect(await run(script("ok-locked", `${lockBase}; ${ok}`))).toBe("ok");
    chmodSync(base, 0o755);
    // The failed removals left their (empty) directories; clear them for the other tests.
    for (const entry of readdirSync(base)) rmSync(join(base, entry), { recursive: true, force: true });
  });

  it("removal never touches anything outside the exact leased directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "oxm-outside-"));
    try {
      writeFileSync(join(outside, "keep.txt"), "keep");
      const ws = createTempPlanningWorkspace({ repoRoot: REPO, base });
      const lease = ws.acquire();
      const sibling = join(base, "unrelated");
      mkdirSync(sibling);
      // Swap the leased directory for a symlink pointing elsewhere: release must not follow or remove it.
      rmSync(lease.cwd, { recursive: true });
      symlinkSync(outside, lease.cwd);
      lease.release();
      lease.release();
      expect(readdirSync(outside)).toEqual(["keep.txt"]);
      expect(existsSync(sibling)).toBe(true);
      rmSync(lease.cwd);
      rmSync(sibling, { recursive: true });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("GPT Manager default: codex_cli composition", () => {
  it("no API key: preflights the ChatGPT login, then runs the read-only Manager profile with schema/output files in a fresh dir outside the repo", async () => {
    const base = mkdtempSync(join(tmpdir(), "oxm-mgr-base-"));
    const seen: { args: readonly string[]; files: string[]; cwd: string; env: Readonly<Record<string, string>> | undefined }[] = [];
    const runner: ProcessRunner = {
      spawn(spec) {
        const files = readdirSync(spec.cwd);
        seen.push({ args: spec.args, files, cwd: spec.cwd, env: spec.env });
        if (spec.args[0] === "login") return { exit: Promise.resolve(exit("Logged in using ChatGPT")), kill: () => {} };
        // The CLI writes its final structured message to the -o file.
        writeFileSync(join(spec.cwd, spec.args[spec.args.indexOf("-o") + 1]), JSON.stringify({ ...PLAN, workAreas: { programming: true, visual: false }, programmingObjective: "", visualObjective: "" }));
        return { exit: Promise.resolve(exit("")), kill: () => {} };
      },
    };
    try {
      const built = await createPlanningBackend({ PATH: "/usr/bin", HOME: "/home/owner", OPENAI_API_KEY: "sk-not-forwarded" }, { runner, timer: neverFires, workspace: createTempPlanningWorkspace({ repoRoot: REPO, base }), repoRoot: REPO });
      expect(built).toMatchObject({ ok: true, provider: "codex_cli" });
      if (!built.ok || built.provider !== "codex_cli") throw new Error("expected codex_cli");
      expect(built.diagnostics.join("\n")).toMatch(/GPT Manager provider: codex_cli .*read-only, tool-less Manager profile; no API key used/);
      const raw = await built.planner.interpret({ message: MSG, contextTaskId: null, tasks: [], requireTask: false });
      expect(raw).toMatchObject({ intent: "change_code", workAreas: { programming: true, visual: false } });
      const call = seen[1];
      expect(call.args).toEqual(expect.arrayContaining(["exec", "--sandbox", "read-only", "--output-schema", "manager-output-schema.json"]));
      expect(call.files).toEqual(["manager-output-schema.json"]);
      expect(call.cwd.startsWith(base)).toBe(true);
      for (const s of seen) expect(s.env).not.toHaveProperty("OPENAI_API_KEY");
      // Every per-call directory is removed afterwards.
      expect(readdirSync(base)).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("an API-key Codex login is refused (fail closed, no silent API billing)", async () => {
    const runner: ProcessRunner = { spawn: () => ({ exit: Promise.resolve(exit("Logged in using an API key - sk-proj-***")), kill: () => {} }) };
    expect(await createPlanningBackend({}, deps(runner))).toMatchObject({ ok: false, code: "codex_cli_non_subscription_auth" });
  });
});
