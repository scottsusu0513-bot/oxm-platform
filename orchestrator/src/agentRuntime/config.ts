import { isSafeWorkspaceRoot } from "../codespace/policy";
import type { LiveSmokeConfig } from "../e2e/types";
import { readDeliveryConfig, type DeliveryConfig } from "../delivery/port";

/**
 * Explicit opt-in for the long-lived Agent runtime (distinct from the smoke confirmation). The phrase is kept
 * for compatibility: the runtime itself never merges or deploys on its own; an Owner-approved merge + deploy
 * additionally requires OXM_AGENT_OWNER_APPROVED_DEPLOY=enabled (see delivery/port).
 */
export const AGENT_RUNTIME_CONFIRMATION = "run-oxm-agent-tasks-without-merge-or-deploy" as const;

export interface AgentRuntimeConfig {
  /** Repository / Codespace / workspace binding, re-used by the existing live safety gate. */
  base: LiveSmokeConfig;
  workers: {
    codex?: { command?: string; model?: string };
    claude?: { command?: string; model: string };
  };
  workerTimeoutMs: number;
  /** Bound for each orchestrator-executed validation command. */
  validationTimeoutMs: number;
  /** Owner-approved production delivery (merge + Render observation + production verification). */
  delivery: DeliveryConfig;
}

const int = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value ?? fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * Reads OXM_AGENT_* configuration. Failure reasons name variables, never values.
 * `repoRoot` is the trusted repository root injected by the entrypoint (e.g. the
 * resolved working directory); no host-specific path is assumed.
 */
export function readAgentRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
): { ok: true; config: AgentRuntimeConfig } | { ok: false; reason: string } {
  if (!isSafeWorkspaceRoot(repoRoot)) return { ok: false, reason: "repository root must be an absolute, normalized path" };
  const [owner, repo, extra] = (env.OXM_AGENT_EXPECTED_REPO ?? "").split("/");
  if (!owner || !repo || extra) return { ok: false, reason: "OXM_AGENT_EXPECTED_REPO must be an exact owner/repository binding" };
  const codespaceName = env.CODESPACE_NAME ?? "";
  const expectedCodespaceName = env.OXM_AGENT_CODESPACE_NAME ?? "";
  if (!codespaceName || !expectedCodespaceName) return { ok: false, reason: "CODESPACE_NAME and OXM_AGENT_CODESPACE_NAME are required" };
  const names = (env.OXM_AGENT_WORKERS ?? "codex").split(",").map((w) => w.trim()).filter(Boolean);
  if (names.length === 0 || names.some((w) => w !== "codex" && w !== "claude")) return { ok: false, reason: "OXM_AGENT_WORKERS must list codex and/or claude" };
  const workers: AgentRuntimeConfig["workers"] = {};
  if (names.includes("codex")) workers.codex = { command: env.OXM_AGENT_CODEX_COMMAND, model: env.OXM_AGENT_CODEX_MODEL };
  if (names.includes("claude")) {
    if (!env.OXM_AGENT_CLAUDE_MODEL) return { ok: false, reason: "OXM_AGENT_CLAUDE_MODEL is required when claude is enabled" };
    workers.claude = { command: env.OXM_AGENT_CLAUDE_COMMAND, model: env.OXM_AGENT_CLAUDE_MODEL };
  }
  const workerTimeoutMs = int(env.OXM_AGENT_WORKER_TIMEOUT_MS, 900_000, 60_000, 4 * 3_600_000);
  const validationTimeoutMs = int(env.OXM_AGENT_VALIDATION_TIMEOUT_MS, 1_200_000, 60_000, 4 * 3_600_000);
  if (workerTimeoutMs === null || validationTimeoutMs === null) return { ok: false, reason: "OXM_AGENT_WORKER_TIMEOUT_MS / OXM_AGENT_VALIDATION_TIMEOUT_MS are out of range" };
  const delivery = readDeliveryConfig(env);
  if (!delivery.ok) return { ok: false, reason: delivery.reason };
  return {
    ok: true,
    config: {
      base: {
        live: true,
        confirmation: env.OXM_AGENT_CONFIRM ?? "",
        repoRoot,
        expectedRepository: { owner, repo },
        codespaceName,
        expectedCodespaceName,
        workspacePath: env.OXM_AGENT_WORKSPACE_PATH ?? repoRoot,
        codexCommand: workers.codex?.command,
        codexModel: workers.codex?.model,
        workerTimeoutMs,
        maxQaPolls: 0,
        mergeEnabled: false,
        deployEnabled: false,
        forcePushEnabled: false,
        productionDbEnabled: false,
        ci: Boolean(env.CI),
      },
      workers,
      workerTimeoutMs,
      validationTimeoutMs,
      delivery: delivery.config,
    },
  };
}
