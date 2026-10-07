import { createFakeSmokeEnvironment } from "../orchestrator/src/e2e/fakeEnvironment";
import { blockedSmokeReport, runSmokeHarness } from "../orchestrator/src/e2e/harness";
import { runLiveSmoke } from "../orchestrator/src/e2e/liveAdapters";
import { readLiveSmokeConfig } from "../orchestrator/src/e2e/liveConfig";
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
  const read = readLiveSmokeConfig(process.env, process.cwd());
  return read.ok ? { config: read.config, runId: read.runId } : { report: blocked(read.code, read.reason, read.runId) };
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
