import { lstatSync, mkdtempSync, openSync, readSync, closeSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { createAnthropicPlanningBackend } from "../planning/anthropic";
import { createAnthropicHttpTransport, type AnthropicMessagesTransport } from "../planning/anthropicHttp";
import {
  ClaudeCliPlanningError,
  createClaudeCliPlanningBackend,
  MAX_CLI_OUTPUT_BYTES,
  preflightClaudeCli,
  type ClaudeCliErrorKind,
  type PlanningProcessPort,
  type PlanningWorkspace,
} from "../planning/claudeCli";
import { CodexManagerError, createCodexManagerBackend, MAX_CODEX_MANAGER_OUTPUT_BYTES, preflightCodexManager, type CodexManagerErrorKind } from "../planning/codexCli";
import { createStructuredGoalReviewer, createStructuredIntentPlanner, createStructuredOwnerNoticeComposer, type StructuredPlanningBackend } from "../planning/planners";
import { createStructuredOwnerQuestionAnswerer, type OwnerQuestionAnswerer } from "../planning/ownerQuestion";
import { createStructuredCombinedRepairDiagnoser, createStructuredCombinedReviewer, createStructuredGuidanceInterpreter, createStructuredRepairDiagnoser } from "../planning/managerReasoning";
import type { ManagerReasoningBackends } from "./managerPort";
import { readPlanningProviderConfig, type PlanningConfigErrorCode, type PlanningProviderConfig } from "../planning/provider";
import type { GoalReviewer, IntentPlanner, OwnerNoticeComposer } from "../planning/types";
import { createNodeProcessRunner, realTimer } from "../workers/processRunner";
import type { ProcessRunner, Timer } from "../workers/types";

/**
 * Composition of the trusted planning layer (intent planner + semantic goal
 * reviewer) for the long-lived Agent runtime. Selects the provider from
 * ./planning/provider, runs the provider's preflight and returns typed
 * success / failure — a configured provider that is unavailable fails closed
 * (no silent fallback to another provider, never to API billing).
 */

export type PlanningBackendErrorCode = PlanningConfigErrorCode | `claude_cli_${ClaudeCliErrorKind}` | `codex_cli_${CodexManagerErrorKind}` | "anthropic_api_configuration";

export type PlanningBackendResult =
  | { ok: true; provider: "off"; planner: null; reviewer: null; manager: null; questionAnswerer: null; noticeComposer: null; diagnostics: string[] }
  | {
      ok: true;
      provider: "codex_cli" | "claude_cli" | "anthropic_api";
      planner: IntentPlanner;
      reviewer: GoalReviewer;
      manager: Required<ManagerReasoningBackends>;
      questionAnswerer: OwnerQuestionAnswerer;
      noticeComposer: OwnerNoticeComposer;
      diagnostics: string[];
    }
  | { ok: false; code: PlanningBackendErrorCode; reason: string };

export interface PlanningBackendDeps {
  /** Spawns the Claude CLI (default: the shared exec-file runner, no shell). */
  runner?: ProcessRunner;
  timer?: Timer;
  /** Per-invocation working directories for CLI calls; must be outside the repository. Default: createTempPlanningWorkspace. */
  workspace?: PlanningWorkspace;
  repoRoot: string;
  /** Only used when provider=anthropic_api. */
  createHttpTransport?: (apiKey: string, timeoutMs: number) => AnthropicMessagesTransport;
}

const CLI_REASONS: Record<ClaudeCliErrorKind, string> = {
  configuration: "Claude CLI planner configuration is invalid",
  workspace_unavailable: "could not create the planner's neutral working directory outside the repository",
  executable_unavailable: "Claude CLI executable not found (install Claude Code or set OXM_AGENT_PLANNER_CLAUDE_COMMAND)",
  launch_failed: "Claude CLI could not be started",
  not_authenticated: "Claude CLI is not authenticated (run `claude auth login` in this environment)",
  non_subscription_auth: "Claude CLI is not signed in with a Claude subscription (API-billed login refused; use OXM_AGENT_PLANNER_PROVIDER=anthropic_api to opt into API billing)",
  timeout: "Claude CLI auth preflight timed out",
  rate_limited: "Claude CLI reported a rate/usage limit",
  service_unavailable: "Claude service unavailable",
  process_error: "Claude CLI auth preflight failed",
  output_too_large: "Claude CLI preflight output exceeded its bound",
  refusal: "Claude CLI refused",
  malformed_output: "Claude CLI auth status output was not understood",
};

const CODEX_REASONS: Record<CodexManagerErrorKind, string> = {
  configuration: "GPT Manager (Codex CLI) configuration is invalid",
  workspace_unavailable: "could not create the Manager's neutral working directory outside the repository",
  executable_unavailable: "Codex CLI executable not found (install Codex or set OXM_AGENT_MANAGER_CODEX_COMMAND)",
  launch_failed: "Codex CLI could not be started",
  not_authenticated: "Codex CLI is not signed in (run `codex login` with your ChatGPT account in this environment)",
  non_subscription_auth: "Codex CLI is not signed in with ChatGPT (API-key login refused: no silent API billing)",
  timeout: "Codex CLI login preflight timed out",
  quota_exhausted: "Codex usage quota is exhausted",
  rate_limited: "Codex CLI reported a rate limit",
  service_unavailable: "Codex service unavailable",
  process_error: "Codex CLI login preflight failed",
  output_too_large: "Codex CLI preflight output exceeded its bound",
  malformed_output: "Codex CLI output was not understood",
};

/** Adapts the shared ProcessRunner to the planning port: bounded output, enforced timeout, no shell. */
export function createNodePlanningProcessPort(runner: ProcessRunner, timer: Timer): PlanningProcessPort {
  const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const readBounded = (path: string, max: number): string | null => {
    let fd: number | null = null;
    try {
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) return null;
      fd = openSync(path, "r");
      const buf = Buffer.alloc(Math.min(stat.size, max));
      const n = readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString("utf8");
    } catch {
      return null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  };
  return {
    async run(spec) {
      for (const [name, content] of Object.entries(spec.files ?? {})) {
        if (!SAFE_NAME.test(name)) return { kind: "launch_failed", missing: false };
        writeFileSync(join(spec.cwd, name), content, { mode: 0o600, flag: "wx" });
      }
      if (spec.readBack !== undefined && !SAFE_NAME.test(spec.readBack)) return { kind: "launch_failed", missing: false };
      const running = runner.spawn({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env, stdinText: spec.stdin ?? undefined });
      let timedOut = false;
      const cancel = timer.schedule(spec.timeoutMs, () => {
        timedOut = true;
        running.kill();
      });
      try {
        const exit = await running.exit;
        if (timedOut) return { kind: "timeout" };
        if (exit.spawnError) return { kind: "launch_failed", missing: exit.spawnError === "ENOENT" };
        const bounded = exit.stdout.length + exit.stderr.length > spec.maxOutputBytes;
        const fileOutput = spec.readBack !== undefined ? readBounded(join(spec.cwd, spec.readBack), spec.maxOutputBytes) : undefined;
        return { kind: "exited", exitCode: exit.exitCode, signal: exit.signal, stdout: exit.stdout, stderr: exit.stderr, truncated: exit.truncated || bounded, ...(fileOutput !== undefined ? { fileOutput } : {}) };
      } finally {
        cancel();
      }
    },
  };
}

function outsideRepo(dir: string, repoRoot: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const rel = relative(real(repoRoot), real(dir));
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

export const PLANNING_WORKDIR_PREFIX = "oxm-planner-";

/**
 * One fresh, empty directory per CLI invocation under `base` (default: the OS
 * temp dir), removed when the invocation ends — success, malformed output,
 * non-zero exit, timeout (after the killed process has exited) or launch
 * failure. Removal is restricted to the exact directory this lease created:
 * it must still be a real (non-symlink) directory directly under `base` with
 * the planner prefix; anything else is left untouched. Removal errors are
 * thrown to the caller, which swallows them (best effort, never masking).
 */
export function createTempPlanningWorkspace(options: { repoRoot: string; base?: string }): PlanningWorkspace {
  return {
    acquire() {
      let base: string;
      let dir: string;
      try {
        base = realpathSync(options.base ?? tmpdir());
        if (!outsideRepo(base, options.repoRoot)) throw new Error("inside repository");
        dir = mkdtempSync(join(base, PLANNING_WORKDIR_PREFIX));
      } catch {
        throw new ClaudeCliPlanningError("workspace_unavailable");
      }
      let released = false;
      return {
        cwd: dir,
        release() {
          if (released) return;
          released = true;
          if (dirname(dir) !== base || !basename(dir).startsWith(PLANNING_WORKDIR_PREFIX)) return;
          const stat = lstatSync(dir, { throwIfNoEntry: false });
          if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}

/** Rejects any workspace lease that is not an absolute directory outside the repository. */
function guardWorkspace(workspace: PlanningWorkspace, repoRoot: string): PlanningWorkspace {
  return {
    acquire() {
      const lease = workspace.acquire();
      if (!isAbsolute(lease.cwd) || !outsideRepo(lease.cwd, repoRoot)) {
        try {
          lease.release();
        } catch {
          // best effort
        }
        throw new ClaudeCliPlanningError("workspace_unavailable");
      }
      return lease;
    },
  };
}

export async function createPlanningBackend(env: Readonly<Record<string, string | undefined>>, deps: PlanningBackendDeps): Promise<PlanningBackendResult> {
  const read = readPlanningProviderConfig(env);
  if (!read.ok) return read;
  return createPlanningBackendFromConfig(read.config, env, deps);
}

export async function createPlanningBackendFromConfig(
  config: PlanningProviderConfig,
  env: Readonly<Record<string, string | undefined>>,
  deps: PlanningBackendDeps,
): Promise<PlanningBackendResult> {
  if (config.provider === "off")
    return { ok: true, provider: "off", planner: null, reviewer: null, manager: null, questionAnswerer: null, noticeComposer: null, diagnostics: ["Agent planner disabled (OXM_AGENT_PLANNER=off): natural-language intake disabled; goal criteria cannot be accepted automatically"] };

  let backend: StructuredPlanningBackend;
  let diagnostics: string[];
  if (config.provider === "anthropic_api") {
    try {
      const transport = deps.createHttpTransport ? deps.createHttpTransport(config.apiKey, config.timeoutMs) : createAnthropicHttpTransport({ apiKey: config.apiKey, timeoutMs: config.timeoutMs, maxRetries: 2 });
      backend = createAnthropicPlanningBackend(transport, config.model);
    } catch {
      return { ok: false, code: "anthropic_api_configuration", reason: "Anthropic API planner transport could not be configured" };
    }
    diagnostics = [`Agent planner provider: anthropic_api (Anthropic API BILLING ACTIVE; model ${config.model})`];
  } else if (config.provider === "codex_cli") {
    const workspace = guardWorkspace(deps.workspace ?? createTempPlanningWorkspace({ repoRoot: deps.repoRoot }), deps.repoRoot);
    const port = createNodePlanningProcessPort(deps.runner ?? createNodeProcessRunner({ maxOutputBytes: MAX_CODEX_MANAGER_OUTPUT_BYTES }), deps.timer ?? realTimer);
    const preflight = await preflightCodexManager({ process: port, workspace, env, command: config.command });
    if (!preflight.ok) return { ok: false, code: `codex_cli_${preflight.error.kind}`, reason: CODEX_REASONS[preflight.error.kind] };
    try {
      backend = createCodexManagerBackend({ process: port, workspace, env, model: config.model, command: config.command, timeoutMs: config.timeoutMs });
    } catch (error) {
      const kind = error instanceof CodexManagerError ? error.kind : "configuration";
      return { ok: false, code: `codex_cli_${kind}`, reason: CODEX_REASONS[kind] };
    }
    diagnostics = [`GPT Manager provider: codex_cli (ChatGPT subscription session; read-only, tool-less Manager profile; no API key used; model ${config.model ?? "Codex default"})`];
  } else {
    const workspace = guardWorkspace(deps.workspace ?? createTempPlanningWorkspace({ repoRoot: deps.repoRoot }), deps.repoRoot);
    const port = createNodePlanningProcessPort(deps.runner ?? createNodeProcessRunner({ maxOutputBytes: MAX_CLI_OUTPUT_BYTES }), deps.timer ?? realTimer);
    const preflight = await preflightClaudeCli({ process: port, workspace, env, command: config.command });
    if (!preflight.ok) return { ok: false, code: `claude_cli_${preflight.error.kind}`, reason: CLI_REASONS[preflight.error.kind] };
    try {
      backend = createClaudeCliPlanningBackend({ process: port, workspace, env, model: config.model, command: config.command, timeoutMs: config.timeoutMs });
    } catch {
      return { ok: false, code: "claude_cli_configuration", reason: CLI_REASONS.configuration };
    }
    diagnostics = [`Agent planner provider: claude_cli (Claude subscription session, ${preflight.authMethod}; no API key used; model ${config.model})`];
  }
  return {
    ok: true,
    provider: config.provider,
    planner: createStructuredIntentPlanner(backend),
    reviewer: createStructuredGoalReviewer(backend),
    questionAnswerer: createStructuredOwnerQuestionAnswerer(backend),
    noticeComposer: createStructuredOwnerNoticeComposer(backend),
    manager: {
      diagnoser: createStructuredRepairDiagnoser(backend),
      guidance: createStructuredGuidanceInterpreter(backend),
      combined: createStructuredCombinedReviewer(backend),
      combinedRepair: createStructuredCombinedRepairDiagnoser(backend),
    },
    diagnostics: [...diagnostics, "Agent planner configured (natural-language intake, semantic goal review, GPT repair diagnosis, guidance interpretation, combined review)"],
  };
}
