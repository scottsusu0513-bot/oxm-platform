import { DEFAULT_PLANNER_MODEL } from "./anthropic";
import { DEFAULT_CLAUDE_CLI_COMMAND, DEFAULT_CLAUDE_CLI_TIMEOUT_MS } from "./claudeCli";
import { DEFAULT_CODEX_MANAGER_COMMAND, DEFAULT_CODEX_MANAGER_TIMEOUT_MS } from "./codexCli";

/**
 * GPT Manager provider selection (intent planner + goal reviewer + repair
 * reasoning). Pure; reads only the given env.
 *
 *   OXM_AGENT_MANAGER_PROVIDER=codex_cli      (default) GPT Manager on the owner's authenticated Codex CLI / ChatGPT session; no OPENAI_API_KEY, no API billing
 *   OXM_AGENT_MANAGER_PROVIDER=claude_cli     owner's authenticated Claude Code CLI session
 *   OXM_AGENT_MANAGER_PROVIDER=anthropic_api  native HTTP Anthropic API; requires ANTHROPIC_API_KEY; API billing
 *   OXM_AGENT_PLANNER=off                     Manager reasoning explicitly disabled (natural-language intake off)
 *
 * OXM_AGENT_PLANNER_PROVIDER is the legacy name of the same setting; if both
 * are set they must agree. The provider is never inferred from the presence
 * of an API key. Any other value, or anthropic_api without a key, is a typed
 * configuration error (fail closed); secrets are never part of a reason. The
 * Manager profile is always separate from the Worker profiles, even when both
 * use the Codex CLI.
 */
export const PLANNER_PROVIDERS = ["codex_cli", "claude_cli", "anthropic_api"] as const;
export type PlannerProvider = (typeof PLANNER_PROVIDERS)[number];
export const DEFAULT_PLANNER_PROVIDER: PlannerProvider = "codex_cli";

export type PlanningProviderConfig =
  | { provider: "off" }
  /** model null: the Codex CLI's own default model. */
  | { provider: "codex_cli"; model: string | null; command: string; timeoutMs: number }
  | { provider: "claude_cli"; model: string; command: string; timeoutMs: number }
  | { provider: "anthropic_api"; model: string; apiKey: string; timeoutMs: number };

export type PlanningConfigErrorCode = "invalid_planner_provider" | "missing_anthropic_api_key" | "invalid_planner_model" | "invalid_planner_command" | "invalid_planner_timeout";

export type PlanningConfigResult = { ok: true; config: PlanningProviderConfig } | { ok: false; code: PlanningConfigErrorCode; reason: string };

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/;

export function readPlanningProviderConfig(env: Readonly<Record<string, string | undefined>>): PlanningConfigResult {
  if (env.OXM_AGENT_PLANNER === "off") return { ok: true, config: { provider: "off" } };
  const preferred = env.OXM_AGENT_MANAGER_PROVIDER?.trim();
  const legacy = env.OXM_AGENT_PLANNER_PROVIDER?.trim();
  if (preferred && legacy && preferred !== legacy)
    return { ok: false, code: "invalid_planner_provider", reason: "OXM_AGENT_MANAGER_PROVIDER and OXM_AGENT_PLANNER_PROVIDER disagree" };
  const raw = preferred || legacy || DEFAULT_PLANNER_PROVIDER;
  if (!(PLANNER_PROVIDERS as readonly string[]).includes(raw))
    return { ok: false, code: "invalid_planner_provider", reason: `OXM_AGENT_PLANNER_PROVIDER must be one of ${PLANNER_PROVIDERS.join(", ")}` };
  const provider = raw as PlannerProvider;
  const modelRaw = env.OXM_AGENT_MANAGER_MODEL?.trim() || env.OXM_AGENT_PLANNER_MODEL?.trim();
  const model = modelRaw || DEFAULT_PLANNER_MODEL;
  if (!MODEL_RE.test(model)) return { ok: false, code: "invalid_planner_model", reason: "OXM_AGENT_PLANNER_MODEL is not a valid model identifier" };
  const timeoutRaw = env.OXM_AGENT_MANAGER_TIMEOUT_MS?.trim() || env.OXM_AGENT_PLANNER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : provider === "claude_cli" ? DEFAULT_CLAUDE_CLI_TIMEOUT_MS : provider === "codex_cli" ? DEFAULT_CODEX_MANAGER_TIMEOUT_MS : 180_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000)
    return { ok: false, code: "invalid_planner_timeout", reason: "OXM_AGENT_PLANNER_TIMEOUT_MS must be an integer between 10000 and 900000" };

  if (provider === "anthropic_api") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey || /[\r\n]/.test(apiKey))
      return { ok: false, code: "missing_anthropic_api_key", reason: "OXM_AGENT_PLANNER_PROVIDER=anthropic_api requires ANTHROPIC_API_KEY" };
    return { ok: true, config: { provider, model, apiKey, timeoutMs } };
  }
  if (provider === "codex_cli") {
    const codexCommand = env.OXM_AGENT_MANAGER_CODEX_COMMAND?.trim() || DEFAULT_CODEX_MANAGER_COMMAND;
    if (/[\0\r\n]/.test(codexCommand)) return { ok: false, code: "invalid_planner_command", reason: "OXM_AGENT_MANAGER_CODEX_COMMAND is invalid" };
    // A Claude model id is meaningless to Codex: only an explicitly configured model is passed on.
    return { ok: true, config: { provider, model: modelRaw || null, command: codexCommand, timeoutMs } };
  }
  const command = env.OXM_AGENT_PLANNER_CLAUDE_COMMAND?.trim() || DEFAULT_CLAUDE_CLI_COMMAND;
  if (/[\0\r\n]/.test(command)) return { ok: false, code: "invalid_planner_command", reason: "OXM_AGENT_PLANNER_CLAUDE_COMMAND is invalid" };
  return { ok: true, config: { provider, model, command, timeoutMs } };
}
