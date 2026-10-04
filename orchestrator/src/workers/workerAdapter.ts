import type { WorkerKind } from "../domain/types";
import { createClaudeCodeAdapter } from "./claudeCode";
import { createGitInspector } from "./gitInspector";
import { createNodeProcessRunner, realTimer } from "./processRunner";
import { createTempPromptFileStore } from "./promptFile";
import type { ClaudeCodeConfig, WorkerAdapter } from "./types";

/**
 * Worker adapter selection. Only Claude Code is executable in this phase;
 * any other worker kind fails closed (returns null) rather than falling
 * through to some default execution path.
 */
export function selectWorkerAdapter(kind: WorkerKind, adapters: { claude?: WorkerAdapter }): WorkerAdapter | null {
  if (kind === "claude" && adapters.claude?.kind === "claude") return adapters.claude;
  return null;
}

/** Wires the Claude Code adapter to the real local process runner, git, temp dir and timer. */
export function createLocalClaudeCodeAdapter(config: ClaudeCodeConfig): WorkerAdapter {
  const runner = createNodeProcessRunner();
  return createClaudeCodeAdapter(config, {
    runner,
    git: createGitInspector(runner, config.repoRoot),
    promptFiles: createTempPromptFileStore(),
    timer: realTimer,
  });
}
