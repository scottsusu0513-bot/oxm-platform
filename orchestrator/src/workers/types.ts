/**
 * Phase 2C.4 Worker layer — shared types.
 *
 * Pure type/constant definitions. Real process, git, filesystem and timer
 * access only ever happens behind the injected interfaces declared here
 * (ProcessRunner, GitInspector, PromptFileStore, Timer), so every policy
 * decision in this layer is testable without invoking Claude or git.
 *
 * Privacy: nothing here holds a full prompt, raw stdout/stderr, or secrets.
 */
import type { ActionKind, RiskLevel, TaskAction, TaskCategory, TaskMode, WorkerKind } from "../domain/types";
import type { GitMetadataSnapshot, PathContentIdentity } from "./gitIntegrity";
import type { GitMetadataEvidence } from "./gitMetadataPolicy";
import type { Approval, IsoTimestamp } from "../store/types";

// ---------------------------------------------------------------------------
// Task contract (input)

/** Validations the worker must run; each maps to a fixed command in the prompt. */
export const REQUIRED_VALIDATIONS = ["tests", "typecheck", "smoke"] as const;
export type RequiredValidation = (typeof REQUIRED_VALIDATIONS)[number];

/**
 * Structured task data the worker prompt is built from. Free-text fields
 * (objective, allowedScope, acceptanceCriteria) are untrusted data: they are
 * quoted into the prompt but can never change risk, permissions, branch or
 * approval requirements — those come from `category`/`actions`/`branch` via
 * deterministic policy.
 */
export interface WorkerTaskContract {
  taskId: string;
  runId: string;
  category: TaskCategory;
  actions: readonly TaskAction[];
  /** Paths the task is expected to change (feeds risk classification). */
  changedPaths?: readonly string[];
  /** Risk previously stored for the task; the adapter only ever escalates from it. */
  storedRiskLevel?: RiskLevel | null;
  objective: string;
  allowedScope: readonly string[];
  acceptanceCriteria: readonly string[];
  requiredValidations: readonly RequiredValidation[];
  /** Task branch the worker must stay on. Never main/master. */
  branch: string;
  /** read_only: the Worker must not change any file (enforced again from trusted Git after the run). */
  mode?: TaskMode;
  /** Pre-existing dirty paths that are explicitly part of this task. */
  allowedDirtyPaths?: readonly string[];
  /**
   * HEAD the orchestrator prepared the workspace at (see githubWrite/workspace.ts).
   * When set, the worker refuses to run unless HEAD is exactly this SHA.
   * The worker never moves HEAD or switches branches to satisfy it.
   */
  expectedHeadSha?: string;
  /**
   * Git metadata digest captured by the orchestrator right after workspace
   * preparation. The worker refuses to start unless it matches; a change during
   * the run is diffed by component and classified (workers/gitMetadataPolicy.ts):
   * only a Worker-attributable security change fails the run, anything else is
   * recorded and decides publication trust.
   */
  gitMetadataDigest?: string;
}

export interface WorkerRunRequest {
  contract: WorkerTaskContract;
  /** Pre-execution approval for red tasks; ignored for green/yellow. */
  redApproval?: Approval | null;
  /** Injected "now" used to check approval expiry. */
  now: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Structured result (output)

export const WORKER_RESULT_STATUSES = ["success", "failure", "cancelled", "timeout"] as const;
export type WorkerResultStatus = (typeof WORKER_RESULT_STATUSES)[number];

export const VALIDATION_OUTCOMES = ["passed", "failed", "not_run"] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

export const WORKER_ERROR_TYPES = [
  "invalid_contract",
  "protected_branch",
  "red_approval_missing",
  "branch_mismatch",
  "dirty_worktree",
  "git_error",
  "temp_file_error",
  "runtime_unavailable",
  "runtime_misconfigured",
  "policy_error",
  "process_error",
  "worker_error",
  "malformed_output",
  "branch_changed",
  "git_metadata_changed",
  "result_mismatch",
  "scope_violation",
  "validation_incomplete",
  "worker_failure",
  "cancelled",
  "timeout",
  // Typed availability (infrastructure) failures: never a goal failure, never a repair cycle.
  "quota_exhausted",
  "rate_limited",
  "service_unavailable",
  "authentication_unavailable",
  "executable_unavailable",
] as const;
export type WorkerErrorType = (typeof WORKER_ERROR_TYPES)[number];

export interface TestRunRecord {
  command: string;
  outcome: ValidationOutcome;
}

export interface RiskObservation {
  level: RiskLevel;
  notes: string[];
}

/** Persistable worker outcome. Sanitized: no raw stdout/stderr, prompts, or secrets. */
export interface WorkerResult {
  status: WorkerResultStatus;
  summary: string;
  /** Real changed paths from git (never the worker's self-report). */
  filesChanged: string[];
  testsRun: TestRunRecord[];
  checkResult: ValidationOutcome;
  branch: string;
  headSha: string | null;
  /** Always null from a worker run; PR numbers come only from a trusted GitHub layer. */
  prNumber: null;
  riskObserved: RiskObservation;
  needsApproval: boolean;
  fallbackRecommended: boolean;
  errorType: WorkerErrorType | null;
  /** Worker's own snake_case failure code, if it reported one. */
  workerErrorCode: string | null;
  /**
   * Shared-workspace paths excluded from this run's task-owned delta (see
   * workers/attribution.ts): preExisting = dirty before the run and unchanged;
   * unattributed = out of scope, changed during the run, not reported by the
   * Worker. Never committed; never a Worker scope violation.
   */
  workspaceAttribution?: { preExisting: string[]; unattributed: string[] };
  /**
   * Component-level Git metadata delta of this execution, classified (see workers/gitMetadataPolicy.ts).
   * Present whenever any metadata component changed during the run; trusted (adapter-computed).
   */
  gitMetadata?: GitMetadataEvidence;
  /** Typed availability classification of a failed CLI run (quota, rate limit, auth, …) with a trusted reset time when exposed. */
  availability?: { kind: "quota_exhausted" | "rate_limited_transient" | "service_unavailable" | "authentication_unavailable" | "executable_unavailable" | "process_failure"; resetAt: string | null };
}

/** The JSON object the worker itself must return (validated by resultParser). */
export interface WorkerReport {
  status: "success" | "failure";
  summary: string;
  filesChanged: string[];
  testsRun: TestRunRecord[];
  checkResult: ValidationOutcome;
  branch: string;
  headSha: string;
  /** Always null: the worker has no PR capability; a trusted GitHub layer supplies PR numbers. */
  prNumber: null;
  riskObserved: RiskObservation;
  needsApproval: boolean;
  fallbackRecommended: boolean;
  errorType: string | null;
}

// ---------------------------------------------------------------------------
// Adapter

export interface WorkerHandle {
  readonly runId: string;
  /** SHA-256 of the prompt (null if the contract was rejected before a prompt was built). */
  readonly promptHash: string | null;
  /** Always resolves (never rejects) to a structured result. */
  readonly result: Promise<WorkerResult>;
  /** Requests cancellation; idempotent. */
  cancel(reason?: string): void;
}

export interface WorkerAdapter {
  readonly kind: WorkerKind;
  start(request: WorkerRunRequest): WorkerHandle;
}

// ---------------------------------------------------------------------------
// Injected infrastructure

/** Exec-file style spec: the command is never interpreted by a shell. */
export interface ProcessSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  /** File whose contents are streamed to the child's stdin (keeps prompts out of argv). */
  stdinFile?: string;
  /** In-memory stdin (alternative to stdinFile); stdin is closed after it is written. */
  stdinText?: string;
  /** Complete child environment. Omitted: the parent's environment is inherited (Worker behaviour). */
  env?: Readonly<Record<string, string>>;
}

export interface ProcessExit {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** True if output exceeded the runner's buffer cap (output is then unusable). */
  truncated: boolean;
  /** Set when the process could not be started (e.g. "ENOENT"); exitCode and signal are then null. */
  spawnError?: string;
}

export interface RunningProcess {
  readonly exit: Promise<ProcessExit>;
  /** Terminates the process (and its process group); idempotent. */
  kill(): void;
}

export interface ProcessRunner {
  spawn(spec: ProcessSpec): RunningProcess;
}

/** Read-only view of the working tree. Intentionally has no write operations. */
export interface GitStatus {
  branch: string;
  headSha: string;
  /** Repo-relative paths with staged, unstaged, or untracked changes. */
  dirtyPaths: string[];
}

export interface GitInspector {
  status(): Promise<GitStatus>;
  /** Paths changed between `fromSha` and the working tree (committed + uncommitted). */
  changedPathsSince(fromSha: string): Promise<string[]>;
  /** Git blob identity (mode + raw-byte blob id, or absent) of each working-tree path. */
  contentIdentities(paths: readonly string[]): Promise<PathContentIdentity[]>;
  /** Digest of Git metadata that could alter trusted staging/commit; throws when unverifiable. */
  metadataDigest(): Promise<string>;
  /**
   * Component-level view of the same metadata (its digest equals metadataDigest()), used to explain
   * and classify a change. Optional: a digest-only inspector yields one opaque component.
   */
  metadataSnapshot?(): Promise<GitMetadataSnapshot>;
}

export interface PromptFile {
  path: string;
  remove(): Promise<void>;
}

export interface PromptFileStore {
  /** Writes an ephemeral, owner-only prompt file outside the repository. */
  write(content: string): Promise<PromptFile>;
}

export interface Timer {
  /** Schedules `cb` after `ms`; returns a cancel function. */
  schedule(ms: number, cb: () => void): () => void;
}

export interface ClaudeCodeConfig {
  /** Executable name or absolute path; default "claude". */
  command?: string;
  model: string;
  /** Absolute repository root; the worker runs here and temp files must be outside it. */
  repoRoot: string;
  timeoutMs: number;
}

export interface ClaudeCodeDeps {
  runner: ProcessRunner;
  git: GitInspector;
  promptFiles: PromptFileStore;
  timer: Timer;
}

export interface CodexConfig {
  /** Executable name or absolute path; default "codex". */
  command?: string;
  /** Optional model override. When absent, Codex uses its configured model. */
  model?: string;
  /** Absolute repository root; the worker runs here and temp files must be outside it. */
  repoRoot: string;
  timeoutMs: number;
}

export type CodexRuntimeVerification =
  | { ok: true }
  | {
      ok: false;
      errorType: Extract<WorkerErrorType, "runtime_unavailable" | "runtime_misconfigured" | "policy_error">;
      reason: string;
    };

/**
 * Narrow boundary between the adapter and the installed Codex runtime.
 * Production verifies the native CLI and policy; unit tests inject a fake.
 */
export interface CodexPolicyRuntime {
  verify(input: { command: string; repoRoot: string; args: readonly string[] }): Promise<CodexRuntimeVerification>;
}

export interface CodexDeps extends ClaudeCodeDeps {
  policyRuntime: CodexPolicyRuntime;
}

export type { ActionKind };
