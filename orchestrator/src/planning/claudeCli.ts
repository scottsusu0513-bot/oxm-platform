import type { StructuredPlanningBackend } from "./planners";

/**
 * Claude Code CLI planning backend (the DEFAULT planner / goal-reviewer
 * provider). It runs `claude -p` on the owner's already-authenticated Claude
 * Code session (subscription), so normal operation needs no ANTHROPIC_API_KEY
 * and never uses Anthropic API billing.
 *
 * The planner and reviewer are read-only reasoning components, strictly less
 * privileged than Workers. Every invocation:
 *  - is non-interactive: `-p`, prompt on stdin, `--permission-prompts none`,
 *    `--permission-mode dontAsk`, bypass mode disabled;
 *  - has NO tools at all (`--tools ""`) plus an explicit deny list, so it
 *    cannot read, edit or write files, run shells, use Git or the network;
 *  - loads no user/project/local settings, hooks, MCP servers or sessions
 *    (`--setting-sources ""`, `disableAllHooks`, `--strict-mcp-config`,
 *    `--no-session-persistence`), so nothing configured for Workers or for an
 *    interactive user can widen it;
 *  - runs in a fresh, empty working directory outside the repository (one
 *    per invocation, removed afterwards — see PlanningWorkspace) with an
 *    allowlisted environment: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN and
 *    every other secret in the parent environment are never passed on;
 *  - returns structured output only (`--json-schema`); the parsed object is
 *    still untrusted and validated by ./normalize. The model's output is data,
 *    never executable authority.
 *
 * This module is pure: processes are started only through the injected
 * PlanningProcessPort (the node implementation lives in agentRuntime/), so the
 * planning layer itself never imports child_process. Errors are typed and
 * never carry stdout, stderr, prompts or environment values.
 */

export const DEFAULT_CLAUDE_CLI_COMMAND = "claude";
export const DEFAULT_CLAUDE_CLI_TIMEOUT_MS = 240_000;
export const PREFLIGHT_TIMEOUT_MS = 30_000;
/** stdout + stderr cap per invocation; exceeding it kills the process and fails closed. */
export const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;
/** How much of stderr / an error result is inspected for classification (never surfaced). */
const CLASSIFY_BYTES = 4096;

export type ClaudeCliErrorKind =
  | "configuration"
  | "workspace_unavailable"
  | "executable_unavailable"
  | "launch_failed"
  | "not_authenticated"
  | "non_subscription_auth"
  | "timeout"
  | "rate_limited"
  | "service_unavailable"
  | "process_error"
  | "output_too_large"
  | "refusal"
  | "malformed_output";

const TRANSIENT: ReadonlySet<ClaudeCliErrorKind> = new Set<ClaudeCliErrorKind>(["timeout", "rate_limited", "service_unavailable", "launch_failed", "process_error"]);

/** Typed infrastructure failure. The message carries only the kind (and exit code), never process output. */
export class ClaudeCliPlanningError extends Error {
  readonly kind: ClaudeCliErrorKind;
  readonly transient: boolean;
  readonly exitCode: number | null;
  constructor(kind: ClaudeCliErrorKind, details: { exitCode?: number | null } = {}) {
    const exitCode = details.exitCode ?? null;
    super(`claude cli ${kind}${exitCode !== null ? ` (exit ${exitCode})` : ""}`);
    this.name = "ClaudeCliPlanningError";
    this.kind = kind;
    this.transient = TRANSIENT.has(kind);
    this.exitCode = exitCode;
  }
}

export interface PlanningProcessSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Complete child environment (never merged with the parent's). */
  env: Readonly<Record<string, string>>;
  /** Written to the child's stdin, which is then closed. */
  stdin: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
}

export type PlanningProcessResult =
  | { kind: "exited"; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean }
  | { kind: "timeout" }
  /** The executable could not be started (ENOENT, EACCES, …). */
  | { kind: "launch_failed"; missing: boolean };

/** One invocation's private working directory. release() is idempotent and removes only that directory. */
export interface PlanningWorkspaceLease {
  readonly cwd: string;
  release(): void;
}

/**
 * Supplies a neutral working directory per CLI invocation (node
 * implementation in agentRuntime/). acquire() may throw; release() is called
 * exactly once in a finally block, and a release failure is swallowed so it
 * can never replace the invocation's own result or typed error.
 */
export interface PlanningWorkspace {
  acquire(): PlanningWorkspaceLease;
}

/** A fixed, caller-owned directory that is never removed (tests / externally managed dirs). */
export function fixedPlanningWorkspace(cwd: string): PlanningWorkspace {
  return { acquire: () => ({ cwd, release: () => {} }) };
}

/** Runs one process inside a freshly acquired workspace; cleanup is best-effort and never masks the outcome. */
async function runInWorkspace(workspace: PlanningWorkspace, port: PlanningProcessPort, spec: Omit<PlanningProcessSpec, "cwd">): Promise<PlanningProcessResult> {
  let lease: PlanningWorkspaceLease;
  try {
    lease = workspace.acquire();
  } catch (error) {
    throw error instanceof ClaudeCliPlanningError ? error : new ClaudeCliPlanningError("workspace_unavailable");
  }
  try {
    return await port.run({ ...spec, cwd: lease.cwd });
  } catch {
    throw new ClaudeCliPlanningError("launch_failed");
  } finally {
    try {
      lease.release();
    } catch {
      // Best effort: a leftover empty directory must not hide the real result.
    }
  }
}

/** Process port injected by the composition root. Implementations must not use a shell. */
export interface PlanningProcessPort {
  run(spec: PlanningProcessSpec): Promise<PlanningProcessResult>;
}

/** Variables the CLI needs to find itself and the owner's existing login. Everything else (all API keys, tokens, DB URLs) is dropped. */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "CLAUDE_CONFIG_DIR",
  // Subscription OAuth token from `claude setup-token` (not an API key); passed through, never logged.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/** Never forwarded, even if a future allowlist edit would include them: they switch the CLI to API billing. */
const BILLING_ENV = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]);

export function planningChildEnv(parent: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = parent[key];
    if (typeof value === "string" && !BILLING_ENV.has(key)) env[key] = value;
  }
  // No self-update or telemetry side effects from a planning call.
  env.DISABLE_AUTOUPDATER = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return env;
}

/** Built-in tools explicitly denied in addition to `--tools ""` (defense in depth). */
export const PLANNING_DENIED_TOOLS = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "Agent"] as const;

/** Inline settings: no hooks, nothing allowed, everything listed denied, bypass mode unavailable. */
export const PLANNING_SETTINGS = JSON.stringify({
  disableAllHooks: true,
  permissions: { defaultMode: "dontAsk", disableBypassPermissionsMode: "disable", allow: [], deny: [...PLANNING_DENIED_TOOLS] },
});

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/;
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Fixed argv for one structured planning call. The owner message / evidence go via stdin, never argv. */
export function buildPlanningCliArgs(input: { model: string; system: string; schema: Record<string, unknown>; effort?: string }): string[] {
  if (!MODEL_RE.test(input.model)) throw new ClaudeCliPlanningError("configuration");
  const effort = input.effort ?? "high";
  if (!EFFORTS.has(effort)) throw new ClaudeCliPlanningError("configuration");
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    input.model,
    "--effort",
    effort,
    "--tools",
    "",
    "--disallowedTools",
    ...PLANNING_DENIED_TOOLS,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--settings",
    PLANNING_SETTINGS,
    "--system-prompt",
    input.system,
    "--json-schema",
    JSON.stringify(input.schema),
  ];
}

/** Read-only auth probe: prints login state as JSON; makes no model call and changes nothing in the repository. */
export const PREFLIGHT_ARGS = ["auth", "status", "--json"] as const;

/** Auth methods that run on the owner's Claude subscription rather than API billing. */
export const SUBSCRIPTION_AUTH_METHODS: ReadonlySet<string> = new Set(["claude.ai", "oauth_token"]);

const AUTH_RE = /not logged in|please run \/login|\/login\b|invalid api key|authentication[_ ](error|failed)|oauth token (has )?expired|unauthori[sz]ed|\b401\b/i;
const RATE_RE = /rate[_ -]?limit|usage limit|quota|limit reached|too many requests|\b429\b/i;
const SERVICE_RE = /overloaded|service unavailable|internal server error|\b5\d\d\b|econnreset|econnrefused|etimedout|enotfound|network error|socket hang up|api error/i;

function classifyText(text: string): ClaudeCliErrorKind | null {
  const head = text.slice(0, CLASSIFY_BYTES);
  if (AUTH_RE.test(head)) return "not_authenticated";
  if (RATE_RE.test(head)) return "rate_limited";
  if (SERVICE_RE.test(head)) return "service_unavailable";
  return null;
}

function classifyStatus(status: unknown): ClaudeCliErrorKind | null {
  if (typeof status !== "number") return null;
  if (status === 401 || status === 403) return "not_authenticated";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "service_unavailable";
  return null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseEnvelope(stdout: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(stdout.trim()) as unknown;
    return isPlainObject(raw) && raw.type === "result" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Interprets one finished `claude -p --output-format json --json-schema` run.
 * Success requires exit 0, a non-error result envelope and a JSON object as
 * the structured output; anything else fails closed with a typed error.
 */
export function interpretPlanningRun(result: PlanningProcessResult): unknown {
  if (result.kind === "timeout") throw new ClaudeCliPlanningError("timeout");
  if (result.kind === "launch_failed") throw new ClaudeCliPlanningError(result.missing ? "executable_unavailable" : "launch_failed");
  if (result.truncated) throw new ClaudeCliPlanningError("output_too_large", { exitCode: result.exitCode });
  const envelope = parseEnvelope(result.stdout);
  const errorResult = envelope && (envelope.is_error === true || envelope.subtype !== "success");
  if (result.exitCode !== 0 || errorResult) {
    const kind =
      (envelope ? classifyStatus(envelope.api_error_status) : null) ??
      (envelope && typeof envelope.result === "string" ? classifyText(envelope.result) : null) ??
      classifyText(result.stderr) ??
      (result.exitCode === 0 ? "malformed_output" : "process_error");
    throw new ClaudeCliPlanningError(kind, { exitCode: result.exitCode });
  }
  if (!envelope) throw new ClaudeCliPlanningError("malformed_output", { exitCode: 0 });
  if (envelope.stop_reason === "refusal") throw new ClaudeCliPlanningError("refusal", { exitCode: 0 });
  if (envelope.structured_output !== undefined) {
    if (!isPlainObject(envelope.structured_output)) throw new ClaudeCliPlanningError("malformed_output", { exitCode: 0 });
    return envelope.structured_output;
  }
  // Fallback: the result text must itself be exactly one JSON object (no prose, no fences).
  if (typeof envelope.result !== "string") throw new ClaudeCliPlanningError("malformed_output", { exitCode: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.result.trim());
  } catch {
    throw new ClaudeCliPlanningError("malformed_output", { exitCode: 0 });
  }
  if (!isPlainObject(parsed)) throw new ClaudeCliPlanningError("malformed_output", { exitCode: 0 });
  return parsed;
}

export interface ClaudeCliPlanningOptions {
  process: PlanningProcessPort;
  /** Neutral per-invocation directory OUTSIDE the repository (no project CLAUDE.md, nothing to read). */
  workspace: PlanningWorkspace;
  /** Parent environment; reduced with planningChildEnv before use. */
  env: Readonly<Record<string, string | undefined>>;
  model: string;
  command?: string;
  timeoutMs?: number;
  effort?: string;
}

export function createClaudeCliPlanningBackend(options: ClaudeCliPlanningOptions): StructuredPlanningBackend {
  const command = options.command ?? DEFAULT_CLAUDE_CLI_COMMAND;
  if (!command.trim() || /[\0\r\n]/.test(command) || !MODEL_RE.test(options.model)) throw new ClaudeCliPlanningError("configuration");
  const env = planningChildEnv(options.env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLAUDE_CLI_TIMEOUT_MS;
  return {
    async structured({ system, user, schema }) {
      const args = buildPlanningCliArgs({ model: options.model, system, schema, effort: options.effort });
      const result = await runInWorkspace(options.workspace, options.process, { command, args, env, stdin: user, timeoutMs, maxOutputBytes: MAX_CLI_OUTPUT_BYTES });
      return interpretPlanningRun(result);
    },
  };
}

export type ClaudeCliPreflight =
  | { ok: true; authMethod: string }
  | { ok: false; error: ClaudeCliPlanningError };

/**
 * Lightweight, non-mutating readiness check: `claude auth status --json`.
 * Distinguishes "executable unavailable", "not authenticated" and "operational".
 * Only loggedIn / authMethod / apiProvider are read; identity fields (email,
 * organization) in the output are ignored and never surfaced. A login that
 * would bill the Anthropic API, Bedrock or Vertex is rejected
 * (non_subscription_auth) so the default backend can never silently use API
 * billing.
 */
export async function preflightClaudeCli(options: Pick<ClaudeCliPlanningOptions, "process" | "workspace" | "env" | "command">): Promise<ClaudeCliPreflight> {
  const command = options.command ?? DEFAULT_CLAUDE_CLI_COMMAND;
  const fail = (kind: ClaudeCliErrorKind, exitCode: number | null = null): ClaudeCliPreflight => ({ ok: false, error: new ClaudeCliPlanningError(kind, { exitCode }) });
  if (!command.trim() || /[\0\r\n]/.test(command)) return fail("configuration");
  let result: PlanningProcessResult;
  try {
    result = await runInWorkspace(options.workspace, options.process, { command, args: PREFLIGHT_ARGS, env: planningChildEnv(options.env), stdin: null, timeoutMs: PREFLIGHT_TIMEOUT_MS, maxOutputBytes: 64 * 1024 });
  } catch (error) {
    return fail(error instanceof ClaudeCliPlanningError ? error.kind : "launch_failed");
  }
  if (result.kind === "timeout") return fail("timeout");
  if (result.kind === "launch_failed") return fail(result.missing ? "executable_unavailable" : "launch_failed");
  if (result.truncated) return fail("output_too_large", result.exitCode);
  let status: unknown;
  try {
    status = JSON.parse(result.stdout.trim());
  } catch {
    status = null;
  }
  if (!isPlainObject(status)) return fail(result.exitCode === 0 ? "malformed_output" : classifyText(result.stderr) === "not_authenticated" ? "not_authenticated" : "process_error", result.exitCode);
  if (status.loggedIn !== true) return fail("not_authenticated", result.exitCode);
  const authMethod = typeof status.authMethod === "string" ? status.authMethod : "";
  if (status.apiProvider !== undefined && status.apiProvider !== "firstParty") return fail("non_subscription_auth");
  if (!SUBSCRIPTION_AUTH_METHODS.has(authMethod)) return fail("non_subscription_auth");
  return { ok: true, authMethod };
}
