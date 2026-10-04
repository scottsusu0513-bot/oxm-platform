import { approvalAuthorizes } from "../store/repositories";
import { createKillSwitch } from "./killSwitch";
import {
  buildClaudeArgs,
  buildWorkerPrompt,
  checkTaskBranch,
  contractRisk,
  maxRisk,
  redStartBindingId,
  scopeViolations,
  sha256Hex,
  validateContract,
} from "./prompt";
import { parseClaudeEnvelope, parseWorkerReport, sanitizeText } from "./resultParser";
import type {
  ClaudeCodeConfig,
  ClaudeCodeDeps,
  GitStatus,
  ProcessExit,
  RequiredValidation,
  RiskObservation,
  WorkerAdapter,
  WorkerErrorType,
  WorkerHandle,
  WorkerReport,
  WorkerResult,
  WorkerResultStatus,
  WorkerRunRequest,
  WorkerTaskContract,
} from "./types";
import type { RiskLevel } from "../domain/types";

/**
 * Claude Code headless worker adapter.
 *
 * Execution order (each step fails closed with a structured result):
 *   contract validation → task-branch check → deterministic risk → red approval
 *   evidence → git preflight (branch match, clean tree) → ephemeral prompt file
 *   outside the repo → `claude -p` via ProcessRunner (argv array, prompt on stdin)
 *   → strict parse → post-run git verification + risk re-assessment of changed
 *   paths → required-validation enforcement.
 *
 * Kill switch and timeout both kill the process and yield deterministic
 * results; the prompt file, timer and listeners are always cleaned up. This
 * adapter has no push, merge, deploy, or main-branch code path.
 */

export const DEFAULT_CLAUDE_COMMAND = "claude";

export function createClaudeCodeAdapter(config: ClaudeCodeConfig, deps: ClaudeCodeDeps): WorkerAdapter {
  return {
    kind: "claude",
    start(request: WorkerRunRequest): WorkerHandle {
      const killSwitch = createKillSwitch();
      let promptHash: string | null = null;
      let prompt: string | null = null;
      const pre = preflightContract(request);
      if (pre.ok) {
        prompt = buildWorkerPrompt(request.contract, pre.risk);
        promptHash = sha256Hex(prompt);
      }
      const result = pre.ok
        ? execute(config, deps, request.contract, pre.risk, prompt as string, killSwitch).catch(() =>
            failure(request.contract, "process_error", "worker execution failed unexpectedly", pre.risk),
          )
        : Promise.resolve(failure(request.contract, pre.errorType, pre.reason, pre.risk));
      prompt = null; // the handle never retains the prompt text
      return {
        runId: request.contract.runId,
        promptHash,
        result,
        cancel: (reason) => killSwitch.trigger(reason),
      };
    },
  };
}

type Preflight =
  | { ok: true; risk: RiskLevel }
  | { ok: false; errorType: WorkerErrorType; reason: string; risk: RiskLevel };

/** Pure synchronous gate: contract shape, task branch, risk, red approval evidence. */
export function preflightContract(request: WorkerRunRequest): Preflight {
  const c = request.contract;
  const errors = validateContract(c);
  if (errors.length) return { ok: false, errorType: "invalid_contract", reason: errors.join("; "), risk: "red" };

  const branch = checkTaskBranch(c.branch);
  if (!branch.ok) return { ok: false, errorType: "protected_branch", reason: branch.reason, risk: "red" };

  const risk = contractRisk(c).level;
  if (risk === "red") {
    if (!request.redApproval) {
      return { ok: false, errorType: "red_approval_missing", reason: "red-risk task has no pre-execution approval", risk };
    }
    const auth = approvalAuthorizes(request.redApproval, {
      taskId: c.taskId,
      kind: "start",
      bindingShaOrActionId: redStartBindingId(c),
      at: request.now,
    });
    if (!auth.ok) return { ok: false, errorType: "red_approval_missing", reason: `red approval rejected: ${auth.reason}`, risk };
  }
  return { ok: true, risk };
}

async function execute(
  config: ClaudeCodeConfig,
  deps: ClaudeCodeDeps,
  c: WorkerTaskContract,
  risk: RiskLevel,
  prompt: string,
  killSwitch: ReturnType<typeof createKillSwitch>,
): Promise<WorkerResult> {
  const cancelled = () => terminal(c, "cancelled", risk, null);
  if (killSwitch.triggered) return cancelled();

  // --- git preflight
  let before: GitStatus;
  try {
    before = await deps.git.status();
  } catch {
    return failure(c, "git_error", "could not read working tree status", risk);
  }
  if (killSwitch.triggered) return cancelled();
  if (before.branch !== c.branch) {
    return failure(c, "branch_mismatch", `working tree is on a different branch than the task branch`, risk);
  }
  const allowedDirty = new Set(c.allowedDirtyPaths ?? []);
  const unrelated = before.dirtyPaths.filter((p) => !allowedDirty.has(p));
  if (unrelated.length) {
    return failure(c, "dirty_worktree", `${unrelated.length} unrelated dirty path(s) present`, risk);
  }

  // --- run
  let exit: ProcessExit | null = null;
  let outcome: "exited" | "cancelled" | "timeout" = "exited";
  let removePrompt: (() => Promise<void>) | null = null;
  let clearTimer: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  try {
    let promptPath: string;
    try {
      const file = await deps.promptFiles.write(prompt);
      removePrompt = file.remove;
      promptPath = file.path;
    } catch {
      return failure(c, "temp_file_error", "could not create ephemeral prompt file", risk);
    }
    if (isInside(promptPath, config.repoRoot)) {
      return failure(c, "temp_file_error", "prompt file must live outside the repository", risk);
    }
    if (killSwitch.triggered) return cancelled();

    let args: string[];
    try {
      args = buildClaudeArgs(config.model);
    } catch {
      return failure(c, "invalid_contract", "invalid model identifier", risk);
    }

    const proc = deps.runner.spawn({
      command: config.command ?? DEFAULT_CLAUDE_COMMAND,
      args,
      cwd: config.repoRoot,
      stdinFile: promptPath,
    });
    unsubscribe = killSwitch.onTrigger(() => {
      if (outcome === "exited") outcome = "cancelled";
      proc.kill();
    });
    clearTimer = deps.timer.schedule(config.timeoutMs, () => {
      if (outcome === "exited") outcome = "timeout";
      proc.kill();
    });
    exit = await proc.exit;
  } finally {
    clearTimer?.();
    unsubscribe?.();
    if (removePrompt) await removePrompt().catch(() => {});
  }

  if (outcome !== "exited") return terminal(c, outcome, risk, before.headSha);
  return interpret(c, deps, risk, before, exit as ProcessExit);
}

async function interpret(
  c: WorkerTaskContract,
  deps: ClaudeCodeDeps,
  risk: RiskLevel,
  before: GitStatus,
  exit: ProcessExit,
): Promise<WorkerResult> {
  if (exit.truncated) return failure(c, "malformed_output", "worker output exceeded the size limit", risk);
  if (exit.exitCode !== 0) {
    return failure(c, "process_error", `worker exited with code ${exit.exitCode ?? "none"}`, risk, { fallbackRecommended: true });
  }
  const envelope = parseClaudeEnvelope(exit.stdout);
  if (!envelope.ok) return failure(c, "malformed_output", envelope.reason, risk);
  if (envelope.value.isError) {
    return failure(c, "worker_error", `worker reported ${envelope.value.subtype || "an error"}`, risk, { fallbackRecommended: true });
  }
  const parsed = parseWorkerReport(envelope.value.result);
  if (!parsed.ok) return failure(c, "malformed_output", parsed.reason, risk);
  const report = parsed.value;

  // --- post-run verification against the real working tree (never trust the report)
  let after: GitStatus;
  let changed: string[];
  try {
    after = await deps.git.status();
    changed = await deps.git.changedPathsSince(before.headSha);
  } catch {
    return failure(c, "git_error", "could not verify working tree after run", risk);
  }
  if (after.branch !== c.branch) {
    return failure(c, "branch_changed", "worker left the task branch", "red", { headSha: null });
  }
  if (report.branch !== c.branch || report.headSha !== after.headSha) {
    return failure(c, "result_mismatch", "reported branch/headSha do not match the working tree", risk, { headSha: after.headSha });
  }

  // Deterministic policy wins: re-classify with the paths actually changed.
  const observed = contractRisk(c, changed);
  const finalRisk = maxRisk(maxRisk(risk, observed.level), report.riskObserved.level);
  const riskObserved: RiskObservation = {
    level: finalRisk,
    notes: [
      ...(observed.level !== risk ? observed.reasons.map((r) => sanitizeText(`policy: ${r}`, 300)) : []),
      ...report.riskObserved.notes,
    ].slice(0, 20),
  };
  const needsApproval = report.needsApproval || finalRisk !== "green";
  const filesChanged = [...changed];

  // Deterministic scope enforcement over the real git changes, regardless of reported status.
  const outOfScope = scopeViolations(changed, c.allowedScope);
  if (outOfScope.length) {
    return failure(c, "scope_violation", `${outOfScope.length} changed path(s) outside allowedScope`, finalRisk, {
      headSha: after.headSha,
      filesChanged,
      riskObserved,
      needsApproval: true,
    });
  }

  // On success the worker's self-reported file list must match git (pre-existing allowed dirty paths excepted).
  if (report.status === "success") {
    const actual = new Set(changed);
    const reported = new Set(report.filesChanged);
    const preDirty = new Set(c.allowedDirtyPaths ?? []);
    const phantom = report.filesChanged.filter((p) => !actual.has(p));
    const unreported = changed.filter((p) => !reported.has(p) && !preDirty.has(p));
    if (phantom.length || unreported.length) {
      return failure(c, "result_mismatch", "reported filesChanged do not match the working tree", finalRisk, {
        headSha: after.headSha,
        filesChanged,
        riskObserved,
        needsApproval,
      });
    }
  }

  const base: WorkerResult = {
    status: report.status,
    summary: report.summary,
    filesChanged,
    testsRun: report.testsRun,
    checkResult: report.checkResult,
    branch: c.branch,
    headSha: after.headSha,
    prNumber: null,
    riskObserved,
    needsApproval,
    fallbackRecommended: report.fallbackRecommended,
    errorType: report.status === "failure" ? "worker_failure" : null,
    workerErrorCode: report.errorType,
  };
  if (report.status === "success") {
    const missing = missingValidations(c.requiredValidations, report);
    if (missing.length) {
      return { ...base, status: "failure", errorType: "validation_incomplete", summary: sanitizeText(`required validation(s) not passed: ${missing.join(", ")}. ${report.summary}`, 2000) };
    }
  }
  return base;
}

export function missingValidations(required: readonly RequiredValidation[], report: Pick<WorkerReport, "testsRun" | "checkResult">): RequiredValidation[] {
  return required.filter((v) => {
    if (v === "typecheck") return report.checkResult !== "passed";
    return report.testsRun.length === 0 || !report.testsRun.every((t) => t.outcome === "passed");
  });
}

function failure(
  c: WorkerTaskContract,
  errorType: WorkerErrorType,
  summary: string,
  risk: RiskLevel,
  over: Partial<WorkerResult> = {},
): WorkerResult {
  return {
    status: "failure",
    summary: sanitizeText(summary, 2000),
    filesChanged: [],
    testsRun: [],
    checkResult: "not_run",
    branch: typeof c.branch === "string" ? sanitizeText(c.branch, 200) : "",
    headSha: null,
    prNumber: null,
    riskObserved: { level: risk, notes: [] },
    needsApproval: risk !== "green",
    fallbackRecommended: false,
    errorType,
    workerErrorCode: null,
    ...over,
  };
}

/** Deterministic results for kill-switch cancellation and timeout. */
function terminal(c: WorkerTaskContract, status: Extract<WorkerResultStatus, "cancelled" | "timeout">, risk: RiskLevel, headSha: string | null): WorkerResult {
  return failure(c, status, status === "cancelled" ? "worker run cancelled" : "worker run timed out", risk, {
    status,
    headSha,
    fallbackRecommended: status === "timeout",
  });
}

/** Pure POSIX-style containment check (no filesystem access). */
export function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const c = norm(child);
  const p = norm(parent);
  if (!c.startsWith("/") || !p.startsWith("/")) return true; // relative paths: fail closed
  if (c.split("/").includes("..")) return true;
  return c === p || c.startsWith(`${p}/`);
}
