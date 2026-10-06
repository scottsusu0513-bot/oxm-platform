import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkerKind } from "../domain/types";
import { createClaudeCodeAdapter } from "./claudeCode";
import { createCodexAdapter } from "./codex";
import { createGitInspector } from "./gitInspector";
import { createNodeProcessRunner, realTimer } from "./processRunner";
import { createTempPromptFileStore } from "./promptFile";
import type { ClaudeCodeConfig, CodexConfig, CodexPolicyRuntime, ProcessExit, ProcessRunner, WorkerAdapter } from "./types";

export const CODEX_WORKER_RULES_PATH = ".codex/rules/worker.rules";
export const CODEX_WORKER_RULES_SHA256 = "cbc91875a4f97ed767ef59736c3f4121d3f3ca36ca86b0a5938bbe603b973c67";

export function codexCommandPolicyHash(rules: string): string {
  return createHash("sha256").update(rules.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** Refuse to start if the native Codex command policy is absent or altered. */
export function assertCodexCommandPolicy(repoRoot: string): void {
  const rules = readFileSync(join(repoRoot, CODEX_WORKER_RULES_PATH), "utf8");
  if (codexCommandPolicyHash(rules) !== CODEX_WORKER_RULES_SHA256) {
    throw new Error("Codex worker command policy is missing or altered");
  }
}

const REQUIRED_CODEX_EXEC_OPTIONS = ["--strict-config", "--ignore-user-config", "--ephemeral"] as const;
const REQUIRED_CODEX_SANDBOX_OPTIONS = ["--permission-profile", "--sandbox-state-disable-network"] as const;

export const CODEX_POLICY_PROBES = [
  ..."switch checkout merge rebase reset push".split(" ").map((operation) => ({ command: ["git", operation, "probe"], decision: "forbidden" as const })),
  ...[
    ["git", "status", "--short"],
    ["git", "diff", "--stat"],
    ["git", "log", "-1"],
    ["git", "rev-parse", "HEAD"],
    ["pnpm", "vitest", "run", "worker.test.ts"],
    ["pnpm", "check"],
  ].map((command) => ({ command, decision: "allowed" as const })),
] as const;

/** The required worker policy model, independent of any installed Codex binary. */
export function requiredCodexPolicyDecision(command: readonly string[]): "allowed" | "forbidden" {
  const executable = command[0]?.split("/").at(-1);
  const operation = command[1];
  if (executable === "git" && "switch checkout branch merge rebase reset push config remote".split(" ").includes(operation ?? "")) return "forbidden";
  if (executable === "gh") return "forbidden";
  if (["pnpm", "npm", "yarn", "bun"].includes(executable ?? "") && ["deploy", "db:push", "migrate"].includes(operation ?? "")) return "forbidden";
  if (["vercel", "netlify", "flyctl", "railway", "kubectl", "helm", "terraform"].includes(executable ?? "")) return "forbidden";
  if (["drizzle-kit", "prisma"].includes(executable ?? "") && "migrate push deploy".split(" ").includes(operation ?? "")) return "forbidden";
  return "allowed";
}

async function runProbe(runner: ProcessRunner, command: string, repoRoot: string, args: readonly string[]): Promise<ProcessExit> {
  return runner.spawn({ command, args, cwd: repoRoot }).exit;
}

/** Production implementation: verifies CLI capabilities, policy integrity and native decisions before Codex can run. */
export function createNativeCodexPolicyRuntime(runner: ProcessRunner): CodexPolicyRuntime {
  return {
    async verify({ command, repoRoot, args }) {
      try {
        assertCodexCommandPolicy(repoRoot);
      } catch {
        return { ok: false, errorType: "policy_error", reason: "Codex worker command policy is missing or altered" };
      }

      const requiredArgs = [
        "--strict-config",
        "--ignore-user-config",
        "--ephemeral",
        'permissions.worker.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read",".codex/rules"="read"},":tmpdir"="write",":slash_tmp"="write"}',
        "permissions.worker.network.enabled=false",
        'default_permissions="worker"',
      ];
      if (!requiredArgs.every((value) => args.includes(value))) {
        return { ok: false, errorType: "runtime_misconfigured", reason: "Codex worker permission configuration is incomplete" };
      }

      const version = await runProbe(runner, command, repoRoot, ["--version"]);
      if (version.exitCode !== 0 || version.truncated || !/^codex-cli\s+\S+/m.test(version.stdout)) {
        return { ok: false, errorType: "runtime_unavailable", reason: "Codex CLI is unavailable" };
      }
      const execHelp = await runProbe(runner, command, repoRoot, ["exec", "--help"]);
      const sandboxHelp = await runProbe(runner, command, repoRoot, ["sandbox", "--help"]);
      const execPolicyHelp = await runProbe(runner, command, repoRoot, ["execpolicy", "--help"]);
      if (
        execHelp.exitCode !== 0 ||
        sandboxHelp.exitCode !== 0 ||
        execPolicyHelp.exitCode !== 0 ||
        !REQUIRED_CODEX_EXEC_OPTIONS.every((option) => execHelp.stdout.includes(option)) ||
        !REQUIRED_CODEX_SANDBOX_OPTIONS.every((option) => sandboxHelp.stdout.includes(option)) ||
        !execPolicyHelp.stdout.includes("check")
      ) {
        return { ok: false, errorType: "runtime_misconfigured", reason: "Codex CLI lacks required strict-config, sandbox, or exec-policy support" };
      }

      for (const probe of CODEX_POLICY_PROBES) {
        const checked = await runProbe(runner, command, repoRoot, ["execpolicy", "check", "--rules", join(repoRoot, CODEX_WORKER_RULES_PATH), "--", ...probe.command]);
        if (checked.exitCode !== 0 || checked.truncated) return { ok: false, errorType: "policy_error", reason: "Codex native command policy could not be verified" };
        let value: { matchedRules?: unknown[]; decision?: string };
        try {
          value = JSON.parse(checked.stdout) as typeof value;
        } catch {
          return { ok: false, errorType: "policy_error", reason: "Codex native command policy returned an invalid result" };
        }
        const actual = value.decision === "forbidden" ? "forbidden" : Array.isArray(value.matchedRules) && value.matchedRules.length === 0 ? "allowed" : "unknown";
        if (actual !== probe.decision || requiredCodexPolicyDecision(probe.command) !== probe.decision) {
          return { ok: false, errorType: "policy_error", reason: "Codex native command policy does not match the required worker policy" };
        }
      }
      return { ok: true };
    },
  };
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
    policyRuntime: createNativeCodexPolicyRuntime(runner),
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
