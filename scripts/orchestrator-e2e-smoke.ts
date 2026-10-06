import { createFakeSmokeEnvironment } from "../orchestrator/src/e2e/fakeEnvironment";
import { blockedSmokeReport, runSmokeHarness } from "../orchestrator/src/e2e/harness";
import { runLiveSmoke } from "../orchestrator/src/e2e/liveAdapters";
import { formatSmokeReport } from "../orchestrator/src/e2e/report";
import { LIVE_CONFIRMATION } from "../orchestrator/src/e2e/types";
import type { LiveSmokeConfig, SmokeReport } from "../orchestrator/src/e2e/types";

const live = process.argv.slice(2).includes("--live");
const now = () => new Date().toISOString();

function blocked(code: string, reason: string, smokeRunId: string): SmokeReport {
  return blockedSmokeReport({
    smokeRunId,
    mode: "live",
    at: now(),
    failureCode: code,
    reason,
  });
}

function liveConfig(): { config: LiveSmokeConfig; runId: string } | { report: SmokeReport } {
  const runId = process.env.OXM_E2E_SMOKE_RUN_ID ?? "missing";
  const repository = process.env.OXM_E2E_EXPECTED_REPO ?? "";
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra)
    return {
      report: blocked(
        "configuration_missing",
        "OXM_E2E_EXPECTED_REPO must be an exact owner/repository binding",
        runId,
      ),
    };
  const codespaceName = process.env.CODESPACE_NAME ?? "";
  const expectedCodespaceName = process.env.OXM_E2E_CODESPACE_NAME ?? "";
  if (!codespaceName || !expectedCodespaceName)
    return {
      report: blocked(
        "configuration_missing",
        "CODESPACE_NAME and OXM_E2E_CODESPACE_NAME are required",
        runId,
      ),
    };
  if (!process.env.OXM_E2E_SMOKE_RUN_ID)
    return {
      report: blocked(
        "configuration_missing",
        "OXM_E2E_SMOKE_RUN_ID is required for a durable idempotency binding",
        runId,
      ),
    };
  return {
    runId,
    config: {
      live: true,
      confirmation: process.env.OXM_E2E_SMOKE_CONFIRM ?? "",
      repoRoot: process.cwd(),
      expectedRepository: { owner, repo },
      codespaceName,
      expectedCodespaceName,
      workspacePath: process.env.OXM_E2E_WORKSPACE_PATH ?? process.cwd(),
      codexCommand: process.env.OXM_E2E_CODEX_COMMAND,
      codexModel: process.env.OXM_E2E_CODEX_MODEL,
      workerTimeoutMs: Number(process.env.OXM_E2E_WORKER_TIMEOUT_MS ?? 900_000),
      maxQaPolls: Number(process.env.OXM_E2E_MAX_QA_POLLS ?? 20),
      mergeEnabled: false,
      deployEnabled: false,
      forcePushEnabled: false,
      productionDbEnabled: false,
      ci: Boolean(process.env.CI),
    },
  };
}

let report: SmokeReport;
if (live) {
  const input = liveConfig();
  report = "report" in input ? input.report : await runLiveSmoke(input.config, input.runId);
} else {
  const runId = "fake-phase-2c-12";
  report = await runSmokeHarness(createFakeSmokeEnvironment({ smokeRunId: runId }), {
    smokeRunId: runId,
    maxQaPolls: 3,
    waitForQa: false,
  });
}

process.stdout.write(`${formatSmokeReport(report)}\n`);
if (report.finalStatus !== "accepted" && report.finalStatus !== "waiting_for_ci") {
  process.exitCode = 1;
}

// Keep the exact opt-in discoverable without accepting approximate values.
void LIVE_CONFIRMATION;
