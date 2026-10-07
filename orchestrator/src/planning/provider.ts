import { DEFAULT_PLANNER_MODEL } from "./anthropic";
import { DEFAULT_CLAUDE_CLI_COMMAND, DEFAULT_CLAUDE_CLI_TIMEOUT_MS } from "./claudeCli";

/**
 * Planner / goal-reviewer provider selection (pure; reads only the given env).
 *
 *   OXM_AGENT_PLANNER_PROVIDER=claude_cli     (default) owner's authenticated Claude Code CLI session; no API key, no API billing
 *   OXM_AGENT_PLANNER_PROVIDER=anthropic_api  native HTTP Anthropic API; requires ANTHROPIC_API_KEY; API billing
 *   OXM_AGENT_PLANNER=off                     planner explicitly disabled (natural-language intake off)
 *
 * The provider is never inferred from the presence of ANTHROPIC_API_KEY. Any
 * other provider value, or anthropic_api without a key, is a typed
 * configuration error (fail closed); secrets are never part of a reason.
 */
export const PLANNER_PROVIDERS = ["claude_cli", "anthropic_api"] as const;
export type PlannerProvider = (typeof PLANNER_PROVIDERS)[number];
export const DEFAULT_PLANNER_PROVIDER: PlannerProvider = "claude_cli";

export type PlanningProviderConfig =
  | { provider: "off" }
  | { provider: "claude_cli"; model: string; command: string; timeoutMs: number }
  | { provider: "anthropic_api"; model: string; apiKey: string; timeoutMs: number };

export type PlanningConfigErrorCode = "invalid_planner_provider" | "missing_anthropic_api_key" | "invalid_planner_model" | "invalid_planner_command" | "invalid_planner_timeout";

export type PlanningConfigResult = { ok: true; config: PlanningProviderConfig } | { ok: false; code: PlanningConfigErrorCode; reason: string };

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/;

export function readPlanningProviderConfig(env: Readonly<Record<string, string | undefined>>): PlanningConfigResult {
  if (env.OXM_AGENT_PLANNER === "off") return { ok: true, config: { provider: "off" } };
  const raw = env.OXM_AGENT_PLANNER_PROVIDER?.trim() || DEFAULT_PLANNER_PROVIDER;
  if (!(PLANNER_PROVIDERS as readonly string[]).includes(raw))
    return { ok: false, code: "invalid_planner_provider", reason: `OXM_AGENT_PLANNER_PROVIDER must be one of ${PLANNER_PROVIDERS.join(", ")}` };
  const provider = raw as PlannerProvider;
  const model = env.OXM_AGENT_PLANNER_MODEL?.trim() || DEFAULT_PLANNER_MODEL;
  if (!MODEL_RE.test(model)) return { ok: false, code: "invalid_planner_model", reason: "OXM_AGENT_PLANNER_MODEL is not a valid model identifier" };
  const timeoutRaw = env.OXM_AGENT_PLANNER_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : provider === "claude_cli" ? DEFAULT_CLAUDE_CLI_TIMEOUT_MS : 180_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000)
    return { ok: false, code: "invalid_planner_timeout", reason: "OXM_AGENT_PLANNER_TIMEOUT_MS must be an integer between 10000 and 900000" };

  if (provider === "anthropic_api") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey || /[\r\n]/.test(apiKey))
      return { ok: false, code: "missing_anthropic_api_key", reason: "OXM_AGENT_PLANNER_PROVIDER=anthropic_api requires ANTHROPIC_API_KEY" };
    return { ok: true, config: { provider, model, apiKey, timeoutMs } };
  }
  const command = env.OXM_AGENT_PLANNER_CLAUDE_COMMAND?.trim() || DEFAULT_CLAUDE_CLI_COMMAND;
  if (/[\0\r\n]/.test(command)) return { ok: false, code: "invalid_planner_command", reason: "OXM_AGENT_PLANNER_CLAUDE_COMMAND is invalid" };
  return { ok: true, config: { provider, model, command, timeoutMs } };
}
