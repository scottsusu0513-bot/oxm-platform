import type { RiskLevel, WorkerKind } from "../domain/types";
import { classifyAvailabilityFailure, type AvailabilityFailure } from "../executive/availability";
import { approvalAuthorizes } from "../store/repositories";
import { createKillSwitch } from "./killSwitch";
import { looksLikeInteractivePrompt, nonInteractiveViolation, WORKER_INTERACTIVE_PROMPTS_ALLOWED } from "./permissions";
import { attributeWorkspaceDelta } from "./attribution";
import type { PathContentIdentity } from "./gitIntegrity";
import { VALIDATION_COMMANDS, buildWorkerPrompt, checkTaskBranch, contractRisk, isPathInScope, maxRisk, redStartBindingId, sha256Hex, validateContract } from "./prompt";
import { parseWorkerReport, sanitizeText, type ParseResult } from "./resultParser";
import type {
  ClaudeCodeDeps,
  GitStatus,
  ProcessExit,
  RequiredValidation,
  RiskObservation,
  WorkerAdapter,
  WorkerErrorType,
  WorkerReport,
  WorkerResult,
  WorkerResultStatus,
  WorkerRunRequest,
  WorkerTaskContract,
} from "./types";

/** Shared, runtime-neutral enforcement used by every executable worker adapter. */
export interface RuntimeWorkerConfig {
  kind: WorkerKind;
  command: string;
  repoRoot: string;
  timeoutMs: number;
  /** Runtime invariant validated in preflight; Workers never surface interactive permission UI. */
  interactivePromptsAllowed?: false;
  prepareRuntime?(): Promise<{ ok: true } | { ok: false; errorType: WorkerErrorType; reason: string }>;
  /** Receives the contract so read-only runs can drop mutating tools. */
  buildArgs(contract: WorkerTaskContract): string[];
  parseOutput(stdout: string): ParseResult<WorkerReport>;
}

export function createRuntimeWorkerAdapter(config: RuntimeWorkerConfig, deps: ClaudeCodeDeps): WorkerAdapter {
  return {
    kind: config.kind,
    start(request) {
      const killSwitch = createKillSwitch();
      const pre = preflightContract(request);
      let prompt: string | null = pre.ok ? buildWorkerPrompt(request.contract, pre.risk) : null;
      const promptHash = prompt === null ? null : sha256Hex(prompt);
      const result = pre.ok
        ? execute(config, deps, request.contract, pre.risk, prompt as string, killSwitch, request.now).catch(() =>
            failure(request.contract, "process_error", "worker execution failed unexpectedly", pre.risk),
          )
        : Promise.resolve(failure(request.contract, pre.errorType, pre.reason, pre.risk));
      prompt = null;
      return {
        runId: request.contract.runId,
        promptHash,
        result,
        cancel: (reason) => killSwitch.trigger(reason),
      };
    },
  };
}

type Preflight = { ok: true; risk: RiskLevel } | { ok: false; errorType: WorkerErrorType; reason: string; risk: RiskLevel };

export function preflightContract(request: WorkerRunRequest): Preflight {
  const c = request.contract;
  const errors = validateContract(c);
  if (errors.length)
    return {
      ok: false,
      errorType: "invalid_contract",
      reason: errors.join("; "),
      risk: "red",
    };
  const branch = checkTaskBranch(c.branch);
  if (!branch.ok)
    return {
      ok: false,
      errorType: "protected_branch",
      reason: branch.reason,
      risk: "red",
    };
  const risk = contractRisk(c).level;
  if (risk === "red") {
    if (!request.redApproval)
      return {
        ok: false,
        errorType: "red_approval_missing",
        reason: "red-risk task has no pre-execution approval",
        risk,
      };
    const auth = approvalAuthorizes(request.redApproval, {
      taskId: c.taskId,
      kind: "start",
      bindingShaOrActionId: redStartBindingId(c),
      at: request.now,
    });
    if (!auth.ok)
      return {
        ok: false,
        errorType: "red_approval_missing",
        reason: `red approval rejected: ${auth.reason}`,
        risk,
      };
  }
  return { ok: true, risk };
}

async function execute(
  config: RuntimeWorkerConfig,
  deps: ClaudeCodeDeps,
  c: WorkerTaskContract,
  risk: RiskLevel,
  prompt: string,
  killSwitch: ReturnType<typeof createKillSwitch>,
  now: string,
): Promise<WorkerResult> {
  const cancelled = () => terminal(c, "cancelled", risk, null);
  if (killSwitch.triggered) return cancelled();
  let before: GitStatus;
  let beforeMetadata: string;
  let baseline: PathContentIdentity[];
  try {
    before = await deps.git.status();
    beforeMetadata = await deps.git.metadataDigest();
    // Trusted baseline: exact content of every path already dirty before this execution.
    baseline = await deps.git.contentIdentities(before.dirtyPaths);
  } catch {
    return failure(c, "git_error", "could not read working tree status", risk);
  }
  if (c.gitMetadataDigest !== undefined && beforeMetadata !== c.gitMetadataDigest)
    return failure(c, "git_metadata_changed", "Git metadata changed since workspace preparation", "red", { needsApproval: true });
  if (killSwitch.triggered) return cancelled();
  if (before.branch !== c.branch) return failure(c, "branch_mismatch", "working tree is on a different branch than the task branch", risk);
  if (c.expectedHeadSha !== undefined && before.headSha !== c.expectedHeadSha)
    return failure(c, "branch_mismatch", "working tree HEAD is not the orchestrator-prepared SHA", risk);
  const allowedDirty = new Set(c.allowedDirtyPaths ?? []);
  // Unrelated dirty paths OUTSIDE the scope belong to someone else in the shared workspace: they
  // are recorded in the baseline and excluded from the task delta. Inside the scope ownership
  // would be ambiguous (the Worker may edit them), so those still fail closed.
  const unrelated = before.dirtyPaths.filter((p) => !allowedDirty.has(p) && isPathInScope(p, c.allowedScope));
  if (unrelated.length) return failure(c, "dirty_worktree", `${unrelated.length} unrelated dirty path(s) present inside allowedScope`, risk);

  if (config.prepareRuntime) {
    let readiness: Awaited<ReturnType<NonNullable<RuntimeWorkerConfig["prepareRuntime"]>>>;
    try {
      readiness = await config.prepareRuntime();
    } catch {
      return failure(c, "runtime_unavailable", "worker runtime verification failed unexpectedly", risk);
    }
    if (!readiness.ok) return failure(c, readiness.errorType, readiness.reason, risk, { headSha: before.headSha });
  }

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
    if (isInside(promptPath, config.repoRoot)) return failure(c, "temp_file_error", "prompt file must live outside the repository", risk);
    if (killSwitch.triggered) return cancelled();
    let args: string[];
    try {
      args = config.buildArgs(c);
    } catch {
      return failure(c, "invalid_contract", "invalid model identifier", risk);
    }
    // Preflight invariant: an unattended run can never stop on a Yes/No prompt.
    const interactive = config.interactivePromptsAllowed !== undefined && config.interactivePromptsAllowed !== WORKER_INTERACTIVE_PROMPTS_ALLOWED
      ? "interactive worker prompts must be disabled"
      : nonInteractiveViolation(config.kind, args);
    if (interactive) return failure(c, "runtime_misconfigured", interactive, risk, { headSha: before.headSha });
    const proc = deps.runner.spawn({
      command: config.command,
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
  // Checked for every outcome (including timeout/cancel): Git metadata is never the Worker's to change.
  let afterMetadata: string | null = null;
  try {
    afterMetadata = await deps.git.metadataDigest();
  } catch {
    afterMetadata = null;
  }
  if (afterMetadata !== beforeMetadata)
    return failure(c, "git_metadata_changed", "worker run changed or hid Git metadata; result refused", "red", { needsApproval: true });
  // A run that stalled or failed on an interactive confirmation is a runtime
  // configuration defect: not a transient timeout, never retried or repaired.
  const finalOutcome = outcome as "exited" | "cancelled" | "timeout";
  if (finalOutcome !== "cancelled" && exit && (finalOutcome === "timeout" || exit.exitCode !== 0) && looksLikeInteractivePrompt(`${exit.stdout}\n${exit.stderr}`))
    return failure(c, "runtime_misconfigured", "worker runtime waited on an interactive confirmation prompt (non-interactive configuration defect)", risk, { headSha: before.headSha });
  if (outcome !== "exited") return terminal(c, outcome, risk, before.headSha);
  return interpret(config, c, deps, risk, before, baseline, exit as ProcessExit, now);
}

async function interpret(
  config: RuntimeWorkerConfig,
  c: WorkerTaskContract,
  deps: ClaudeCodeDeps,
  risk: RiskLevel,
  before: GitStatus,
  baseline: readonly PathContentIdentity[],
  exit: ProcessExit,
  now: string,
): Promise<WorkerResult> {
  if (exit.truncated) return failure(c, "malformed_output", "worker output exceeded the size limit", risk);
  if (exit.spawnError || exit.exitCode !== 0) {
    // Availability is typed infrastructure state (never a goal failure, never a repair cycle).
    const a = classifyAvailabilityFailure({ stdout: exit.stdout, stderr: exit.stderr, exitCode: exit.exitCode, spawnError: exit.spawnError ?? null, now });
    const errorType = AVAILABILITY_ERROR[a.kind];
    return failure(c, errorType, errorType === "process_error" ? `worker exited with code ${exit.exitCode ?? "none"}` : `worker runtime unavailable: ${a.kind}`, risk, {
      fallbackRecommended: true,
      headSha: before.headSha,
      availability: { kind: a.kind, resetAt: a.resetAt },
    });
  }
  const parsed = config.parseOutput(exit.stdout);
  if (!parsed.ok) {
    // A CLI may exit 0 with an error envelope; only a quota/auth signal is reclassified.
    const a = classifyAvailabilityFailure({ stdout: exit.stdout, stderr: exit.stderr, exitCode: exit.exitCode, now });
    if (a.kind === "quota_exhausted" || a.kind === "authentication_unavailable")
      return failure(c, AVAILABILITY_ERROR[a.kind], `worker runtime unavailable: ${a.kind}`, risk, { fallbackRecommended: true, headSha: before.headSha, availability: { kind: a.kind, resetAt: a.resetAt } });
    const reportedError = parsed.reason.startsWith("worker reported ");
    return failure(c, reportedError ? "worker_error" : "malformed_output", parsed.reason, risk, { fallbackRecommended: reportedError });
  }
  const report = parsed.value;
  let after: GitStatus;
  let changed: string[];
  let current: PathContentIdentity[];
  try {
    after = await deps.git.status();
    changed = await deps.git.changedPathsSince(before.headSha);
    current = await deps.git.contentIdentities(Array.from(new Set([...changed, ...baseline.map((b) => b.path)])));
  } catch {
    return failure(c, "git_error", "could not verify working tree after run", risk);
  }
  if (after.branch !== c.branch)
    return failure(c, "branch_changed", "worker left the task branch", "red", {
      headSha: null,
    });
  if (after.headSha !== before.headSha)
    return failure(c, "git_metadata_changed", "worker moved HEAD; only the trusted layer may commit", "red", {
      headSha: null,
      needsApproval: true,
    });
  if (report.branch !== c.branch || report.headSha !== after.headSha)
    return failure(c, "result_mismatch", "reported branch/headSha do not match the working tree", risk, { headSha: after.headSha });
  // Only the delta of THIS execution is the Worker's (shared workspace; see workers/attribution.ts).
  const delta = attributeWorkspaceDelta({
    baseline,
    current,
    changedNow: changed,
    allowedScope: c.allowedScope,
    allowedDirtyPaths: c.allowedDirtyPaths ?? [],
    reported: report.filesChanged,
  });
  const workspaceAttribution =
    delta.preExisting.length || delta.unattributed.length ? { workspaceAttribution: { preExisting: delta.preExisting, unattributed: delta.unattributed } } : {};
  const attributed = [...delta.taskOwned, ...delta.workerOutOfScope].sort();
  // Risk reflects the workspace state, not blame: an unattributed change (e.g. an env file touched
  // during the run) still escalates risk, even though it is never called a Worker violation.
  const observed = contractRisk(c, [...attributed, ...delta.unattributed]);
  const finalRisk = maxRisk(maxRisk(risk, observed.level), report.riskObserved.level);
  const riskObserved: RiskObservation = {
    level: finalRisk,
    notes: [
      ...(observed.level !== risk ? observed.reasons.map((r) => sanitizeText(`policy: ${r}`, 300)) : []),
      ...(delta.unattributed.length
        ? [sanitizeText(`workspace: ${delta.unattributed.length} out-of-scope path(s) changed during the run were not reported by the Worker; not attributed to it, excluded from the task delta and never committed`, 300)]
        : []),
      ...report.riskObserved.notes,
    ].slice(0, 20),
  };
  const needsApproval = report.needsApproval || finalRisk !== "green";
  if (delta.workerOutOfScope.length)
    return failure(c, "scope_violation", `${delta.workerOutOfScope.length} changed path(s) outside allowedScope`, finalRisk, {
      headSha: after.headSha,
      filesChanged: attributed,
      riskObserved,
      needsApproval: true,
      ...workspaceAttribution,
    });
  // Git, not the Worker's list, is the truth for the task-owned delta: an in-scope path the
  // Worker forgot to list is still its change, and a listed path that did not change is ignored.
  const filesChanged = delta.taskOwned;
  // A Worker that finished the change but could not run validations because of the environment
  // has not failed the task: the trusted layer re-runs every validation itself.
  const environmentOnly = report.status === "failure" && isEnvironmentErrorCode(report.errorType) && filesChanged.length > 0;
  const status: WorkerResultStatus = environmentOnly ? "success" : report.status;
  const base: WorkerResult = {
    status,
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
    errorType: status === "failure" ? "worker_failure" : null,
    workerErrorCode: report.errorType,
    ...workspaceAttribution,
  };
  if (status === "success") {
    // Only a validation the Worker actually saw FAIL contradicts its success. One it could not run
    // (not_run) is unverified, not failed: the trusted validation layer decides.
    const failed = reportedFailedValidations(c.requiredValidations, report);
    if (failed.length)
      return {
        ...base,
        status: "failure",
        errorType: "validation_incomplete",
        summary: sanitizeText(`required validation(s) failed: ${failed.join(", ")}. ${report.summary}`, 2000),
      };
  }
  return base;
}

/** Worker-reported error codes meaning "the environment could not run validations", not a task failure. */
const ENVIRONMENT_ERROR_CODE = /^(?:validation|validations|environment|infrastructure|tooling|dependency|dependencies|package_manager)_(?:unavailable|missing|not_run|error|failure|failed)$/;

export function isEnvironmentErrorCode(code: string | null): boolean {
  return code !== null && ENVIRONMENT_ERROR_CODE.test(code);
}

/** Required validations the Worker itself observed failing (not those it could not run). */
export function reportedFailedValidations(required: readonly RequiredValidation[], report: Pick<WorkerReport, "testsRun" | "checkResult">): RequiredValidation[] {
  return required.filter((v) =>
    v === "typecheck"
      ? report.checkResult === "failed"
      : v === "smoke"
        ? report.testsRun.some((t) => t.command === VALIDATION_COMMANDS.smoke && t.outcome === "failed")
        : report.testsRun.some((t) => t.command !== VALIDATION_COMMANDS.smoke && t.outcome === "failed"),
  );
}

export function directWorkerReport(stdout: string): ParseResult<WorkerReport> {
  return parseWorkerReport(stdout);
}

export function missingValidations(required: readonly RequiredValidation[], report: Pick<WorkerReport, "testsRun" | "checkResult">): RequiredValidation[] {
  return required.filter((v) =>
    v === "typecheck"
      ? report.checkResult !== "passed"
      : v === "smoke"
        ? !report.testsRun.some(
            (t) =>
              t.command ===
                "pnpm vitest run orchestrator/src/e2e/fixture.test.ts" &&
              t.outcome === "passed",
          )
        : report.testsRun.length === 0 ||
          !report.testsRun.every((t) => t.outcome === "passed"),
  );
}

/** Typed availability failure -> Worker error type. Only process_failure keeps the generic process_error. */
export const AVAILABILITY_ERROR: Readonly<Record<AvailabilityFailure, WorkerErrorType>> = {
  quota_exhausted: "quota_exhausted",
  rate_limited_transient: "rate_limited",
  service_unavailable: "service_unavailable",
  authentication_unavailable: "authentication_unavailable",
  executable_unavailable: "executable_unavailable",
  process_failure: "process_error",
};

function failure(c: WorkerTaskContract, errorType: WorkerErrorType, summary: string, risk: RiskLevel, over: Partial<WorkerResult> = {}): WorkerResult {
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

function terminal(c: WorkerTaskContract, status: Extract<WorkerResultStatus, "cancelled" | "timeout">, risk: RiskLevel, headSha: string | null): WorkerResult {
  return failure(c, status, status === "cancelled" ? "worker run cancelled" : "worker run timed out", risk, {
    status,
    headSha,
    fallbackRecommended: status === "timeout",
  });
}

export function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const c = norm(child);
  const p = norm(parent);
  if (!c.startsWith("/") || !p.startsWith("/")) return true;
  if (c.split("/").includes("..")) return true;
  return c === p || c.startsWith(`${p}/`);
}
