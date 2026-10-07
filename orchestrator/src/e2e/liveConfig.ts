import type { LiveSmokeConfig } from "./types";

/**
 * Reads the live smoke configuration from the environment. Failure reasons
 * name variables only, never their values.
 */
export function readLiveSmokeConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): { ok: true; config: LiveSmokeConfig; runId: string } | { ok: false; runId: string; code: string; reason: string } {
  const runId = env.OXM_E2E_SMOKE_RUN_ID ?? "missing";
  const repository = env.OXM_E2E_EXPECTED_REPO ?? "";
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra)
    return { ok: false, runId, code: "configuration_missing", reason: "OXM_E2E_EXPECTED_REPO must be an exact owner/repository binding" };
  const codespaceName = env.CODESPACE_NAME ?? "";
  const expectedCodespaceName = env.OXM_E2E_CODESPACE_NAME ?? "";
  if (!codespaceName || !expectedCodespaceName)
    return { ok: false, runId, code: "configuration_missing", reason: "CODESPACE_NAME and OXM_E2E_CODESPACE_NAME are required" };
  if (!env.OXM_E2E_SMOKE_RUN_ID)
    return { ok: false, runId, code: "configuration_missing", reason: "OXM_E2E_SMOKE_RUN_ID is required for a durable idempotency binding" };
  return {
    ok: true,
    runId,
    config: {
      live: true,
      confirmation: env.OXM_E2E_SMOKE_CONFIRM ?? "",
      repoRoot: cwd,
      expectedRepository: { owner, repo },
      codespaceName,
      expectedCodespaceName,
      workspacePath: env.OXM_E2E_WORKSPACE_PATH ?? cwd,
      codexCommand: env.OXM_E2E_CODEX_COMMAND,
      codexModel: env.OXM_E2E_CODEX_MODEL,
      workerTimeoutMs: Number(env.OXM_E2E_WORKER_TIMEOUT_MS ?? 900_000),
      maxQaPolls: Number(env.OXM_E2E_MAX_QA_POLLS ?? 20),
      mergeEnabled: false,
      deployEnabled: false,
      forcePushEnabled: false,
      productionDbEnabled: false,
      ci: Boolean(env.CI),
    },
  };
}
