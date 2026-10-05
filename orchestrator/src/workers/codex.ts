import { buildCodexArgs } from "./prompt";
import { createRuntimeWorkerAdapter, directWorkerReport } from "./runtimeWorker";
import type { CodexConfig, CodexDeps, WorkerAdapter } from "./types";

export const DEFAULT_CODEX_COMMAND = "codex";

/** Codex CLI headless adapter. Prompt is streamed on stdin and stdout is parsed strictly. */
export function createCodexAdapter(config: CodexConfig, deps: CodexDeps): WorkerAdapter {
  const command = config.command ?? DEFAULT_CODEX_COMMAND;
  return createRuntimeWorkerAdapter(
    {
      kind: "codex",
      command,
      repoRoot: config.repoRoot,
      timeoutMs: config.timeoutMs,
      prepareRuntime: async () => {
        let args: string[];
        try {
          args = buildCodexArgs(config.model, config.repoRoot);
        } catch {
          return { ok: false, errorType: "runtime_misconfigured", reason: "invalid Codex runtime configuration" };
        }
        return deps.policyRuntime.verify({ command, repoRoot: config.repoRoot, args });
      },
      buildArgs: () => buildCodexArgs(config.model, config.repoRoot),
      parseOutput: directWorkerReport,
    },
    deps,
  );
}
