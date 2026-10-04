import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkerKind } from "../domain/types";
import { createClaudeCodeAdapter } from "./claudeCode";
import { createCodexAdapter } from "./codex";
import { createGitInspector } from "./gitInspector";
import { createNodeProcessRunner, realTimer } from "./processRunner";
import { createTempPromptFileStore } from "./promptFile";
import type { ClaudeCodeConfig, CodexConfig, WorkerAdapter } from "./types";

export const CODEX_WORKER_RULES_PATH = ".codex/rules/worker.rules";
export const CODEX_WORKER_RULES_SHA256 = "cbc91875a4f97ed767ef59736c3f4121d3f3ca36ca86b0a5938bbe603b973c67";

/** Refuse to start if the native Codex command policy is absent or altered. */
export function assertCodexCommandPolicy(repoRoot: string): void {
  const rules = readFileSync(join(repoRoot, CODEX_WORKER_RULES_PATH), "utf8");
  if (createHash("sha256").update(rules, "utf8").digest("hex") !== CODEX_WORKER_RULES_SHA256) {
    throw new Error("Codex worker command policy is missing or altered");
  }
}

/**
 * Exact-key worker registry selection. A missing or mismatched adapter fails
 * closed instead of silently substituting another runtime.
 */
export type WorkerRegistry = Partial<Record<WorkerKind, WorkerAdapter>>;

export function selectWorkerAdapter(kind: WorkerKind, adapters: WorkerRegistry): WorkerAdapter | null {
  const adapter = adapters[kind];
  return adapter?.kind === kind ? adapter : null;
}

/** Wires the Codex adapter to the same hardened local infrastructure. */
export function createLocalCodexAdapter(config: CodexConfig): WorkerAdapter {
  const runner = createNodeProcessRunner();
  return createCodexAdapter(config, {
    runner,
    git: createGitInspector(runner, config.repoRoot),
    promptFiles: createTempPromptFileStore(),
    timer: realTimer,
    assertCommandPolicy: () => assertCodexCommandPolicy(config.repoRoot),
  });
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
