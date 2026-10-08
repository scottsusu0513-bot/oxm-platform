import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { AGENT_RUNTIME_CONFIRMATION, readAgentRuntimeConfig } from "../agentRuntime/config";
import { readTelegramConfig, readTelegramSourceConfig } from "../telegram/config";

/**
 * Fixed, non-secret OXM Agent runtime binding. Mirrored by `containerEnv` in
 * .devcontainer/devcontainer.json (a test keeps both in sync). The Codespace
 * name is deliberately absent: it is bound at runtime from CODESPACE_NAME.
 */
export const FIXED_AGENT_ENV = Object.freeze({
  OXM_AGENT_EXPECTED_REPO: "scottsusu0513-bot/oxm-platform",
  OXM_AGENT_CONFIRM: AGENT_RUNTIME_CONFIRMATION,
  OXM_AGENT_WORKERS: "claude,codex",
  OXM_AGENT_CLAUDE_MODEL: "opus",
});

/** Platform-provided Codespaces secrets (KEY=base64 per line), the file /etc/profile.d/codespaces.sh reads. */
export const CODESPACES_SECRETS_FILE = "/workspaces/.codespaces/shared/.env-secrets";

/** The only keys ever taken from the platform secrets file, and only when absent from the environment. */
const PLATFORM_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OWNER_CHAT_ID",
  "CODESPACE_NAME",
  // Wake Gateway cutover / rollback is a Codespaces Secrets change; unset means direct Telegram polling.
  "OXM_AGENT_TELEGRAM_SOURCE",
  "OXM_WAKE_GATEWAY_URL",
  "OXM_WAKE_GATEWAY_AGENT_TOKEN",
] as const;
/** These bindings guard safety; a different pre-set value is refused instead of overridden. */
const STRICT_KEYS = ["OXM_AGENT_EXPECTED_REPO", "OXM_AGENT_CONFIRM"] as const;
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|_KEY|KEY_ID|PRIVATE|CREDENTIAL|CHAT_ID|AUTH|COOKIE|SESSION|DATABASE_URL/i;

export type EnvFailureCode = "missing_codespace" | "wrong_codespace" | "wrong_repo" | "binding_mismatch" | "missing_secret" | "invalid_config";

export type ResolvedAgentEnv =
  | { ok: true; env: Record<string, string>; secretValues: string[]; telegramSource: "environment" | "codespaces_secrets_file" }
  | { ok: false; code: EnvFailureCode; reason: string };

/** Parses the platform secrets file. Values are returned only for the allowlisted keys. */
export function parsePlatformSecrets(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!(PLATFORM_KEYS as readonly string[]).includes(key) || key in out) continue;
    const value = Buffer.from(line.slice(eq + 1).trim(), "base64").toString("utf8").trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Every value that must never reach a log: secret-named variables plus the Telegram binding. */
export function secretValuesOf(env: Readonly<Record<string, string | undefined>>): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) if (value && value.length >= 6 && SECRET_NAME.test(key)) values.add(value);
  return Array.from(values).sort((a, b) => b.length - a.length);
}

/**
 * Builds the Agent runtime environment from the process environment, the fixed
 * binding and (for missing Telegram/Codespace values only) the platform secrets
 * file. Failure reasons name variables, never values. The result is validated
 * with the runtime's own readers, so no existing gate is relaxed.
 */
export function resolveAgentEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { repoRoot: string; readPlatformSecrets: () => string | null },
): ResolvedAgentEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;

  let telegramSource: "environment" | "codespaces_secrets_file" = "environment";
  if (PLATFORM_KEYS.some((k) => !out[k]?.trim())) {
    let text: string | null = null;
    try {
      text = options.readPlatformSecrets();
    } catch {
      text = null;
    }
    const platform = text ? parsePlatformSecrets(text) : {};
    for (const key of PLATFORM_KEYS)
      if (!out[key]?.trim() && platform[key]) {
        out[key] = platform[key];
        if (key.startsWith("TELEGRAM_")) telegramSource = "codespaces_secrets_file";
      }
  }

  for (const [key, value] of Object.entries(FIXED_AGENT_ENV)) {
    const current = out[key]?.trim();
    if (!current) out[key] = value;
    else if ((STRICT_KEYS as readonly string[]).includes(key) && current !== value)
      return { ok: false, code: key === "OXM_AGENT_EXPECTED_REPO" ? "wrong_repo" : "binding_mismatch", reason: `${key} differs from the fixed OXM Agent binding` };
  }

  const codespace = out.CODESPACE_NAME?.trim();
  if (!codespace) return { ok: false, code: "missing_codespace", reason: "CODESPACE_NAME is not available (not running inside a Codespace?)" };
  const pinned = out.OXM_AGENT_CODESPACE_NAME?.trim();
  if (pinned && pinned !== codespace) return { ok: false, code: "wrong_codespace", reason: "OXM_AGENT_CODESPACE_NAME does not match the current CODESPACE_NAME" };
  out.OXM_AGENT_CODESPACE_NAME = codespace;

  const telegram = readTelegramConfig(out);
  if (!telegram.ok) return { ok: false, code: "missing_secret", reason: telegram.reason };
  const source = readTelegramSourceConfig(out);
  if (!source.ok) return { ok: false, code: "invalid_config", reason: source.reason };
  const runtime = readAgentRuntimeConfig(out, options.repoRoot);
  if (!runtime.ok) return { ok: false, code: "invalid_config", reason: runtime.reason };

  return { ok: true, env: out, secretValues: secretValuesOf(out), telegramSource };
}

/** owner/repo from a GitHub remote URL (https or ssh), or null. */
export function repoFromRemoteUrl(url: string): string | null {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Worker executables the configured runtime needs (planner uses the Claude CLI too). */
export function requiredExecutables(env: Readonly<Record<string, string | undefined>>): { name: string; command: string }[] {
  const workers = (env.OXM_AGENT_WORKERS ?? "").split(",").map((w) => w.trim());
  const out: { name: string; command: string }[] = [];
  if (workers.includes("claude")) out.push({ name: "claude", command: env.OXM_AGENT_CLAUDE_COMMAND || "claude" });
  if (workers.includes("codex")) out.push({ name: "codex", command: env.OXM_AGENT_CODEX_COMMAND || "codex" });
  return out;
}

export function findExecutable(command: string, path: string | undefined): string | null {
  const candidates = command.includes("/") ? [command] : (path ?? "").split(delimiter).filter((d) => isAbsolute(d)).map((d) => join(d, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}
