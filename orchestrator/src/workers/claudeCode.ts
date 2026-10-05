import { buildClaudeArgs } from "./prompt";
import { parseClaudeEnvelope, parseWorkerReport, type ParseResult } from "./resultParser";
import { createRuntimeWorkerAdapter } from "./runtimeWorker";
import type { ClaudeCodeConfig, ClaudeCodeDeps, WorkerAdapter, WorkerReport } from "./types";

export { isInside, missingValidations, preflightContract } from "./runtimeWorker";

export const DEFAULT_CLAUDE_COMMAND = "claude";

function parseClaudeOutput(stdout: string): ParseResult<WorkerReport> {
  const envelope = parseClaudeEnvelope(stdout);
  if (!envelope.ok) return envelope;
  if (envelope.value.isError)
    return {
      ok: false,
      reason: `worker reported ${envelope.value.subtype || "an error"}`,
    };
  return parseWorkerReport(envelope.value.result);
}

/** Claude-specific CLI shape over the shared branch/scope/risk/result runtime. */
export function createClaudeCodeAdapter(config: ClaudeCodeConfig, deps: ClaudeCodeDeps): WorkerAdapter {
  return createRuntimeWorkerAdapter(
    {
      kind: "claude",
      command: config.command ?? DEFAULT_CLAUDE_COMMAND,
      repoRoot: config.repoRoot,
      timeoutMs: config.timeoutMs,
      buildArgs: () => buildClaudeArgs(config.model),
      parseOutput: parseClaudeOutput,
    },
    deps,
  );
}
