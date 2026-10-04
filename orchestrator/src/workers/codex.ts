import { buildCodexArgs } from "./prompt";
import { createRuntimeWorkerAdapter, directWorkerReport } from "./runtimeWorker";
import type { CodexConfig, CodexDeps, WorkerAdapter } from "./types";

export const DEFAULT_CODEX_COMMAND = "codex";

/** Codex CLI headless adapter. Prompt is streamed on stdin and stdout is parsed strictly. */
export function createCodexAdapter(config: CodexConfig, deps: CodexDeps): WorkerAdapter {
  return createRuntimeWorkerAdapter(
    {
      kind: "codex",
      command: config.command ?? DEFAULT_CODEX_COMMAND,
      repoRoot: config.repoRoot,
      timeoutMs: config.timeoutMs,
      buildArgs: () => {
        deps.assertCommandPolicy();
        return buildCodexArgs(config.model, config.repoRoot);
      },
      parseOutput: directWorkerReport,
    },
    deps,
  );
}
