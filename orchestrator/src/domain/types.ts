/**
 * Phase 2C.1 Policy Core — shared domain types.
 *
 * Pure type/constant definitions only. This module (and every module under
 * orchestrator/src/domain/) must stay deterministic and side-effect-free:
 * no DB, no HTTP, no filesystem, no environment variables, no worker execution.
 */

export const TASK_STATES = ["received", "classified", "routed", "queued", "running", "pr_opened", "qa_running", "qa_passed", "awaiting_approval", "complete", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const RISK_LEVELS = ["green", "yellow", "red"] as const;

/**
 * Execution mode of a task. read_only tasks (investigations, questions,
 * reviews) may read the repository and run checks but must not change any
 * file; they complete without commit, push or PR.
 */
export const TASK_MODES = ["change", "read_only"] as const;
export type TaskMode = (typeof TASK_MODES)[number];

/** Internal intents the trusted planning layer may assign to an owner message. */
export const AGENT_INTENTS = [
  "investigate_or_answer",
  "change_code",
  "audit_or_review",
  "audit_and_fix",
  "task_follow_up",
  "human_decision",
  "status_query",
  "cancel_or_pause",
] as const;
export type AgentIntent = (typeof AGENT_INTENTS)[number];
export const TASK_CREATING_INTENTS = ["investigate_or_answer", "change_code", "audit_or_review", "audit_and_fix"] as const;
export type TaskCreatingIntent = (typeof TASK_CREATING_INTENTS)[number];

/**
 * MUTABILITY (may the Worker change code?) and RISK (how dangerous is the
 * request?) are separate dimensions. Mutability is a deterministic function
 * of the trusted interpreted intent ONLY. Risk may add approvals, gates or
 * blocks, but nothing that computes, raises or approves risk may ever turn a
 * read_only task into a mutating one, widen its scope, or grant tools / Git
 * write; an approval authorizes executing the exact (still read-only)
 * contract, nothing more.
 */
export function modeForIntent(intent: TaskCreatingIntent): TaskMode {
  return intent === "investigate_or_answer" || intent === "audit_or_review" ? "read_only" : "change";
}

/** Fail-closed consistency check between a task's mutability and anything that would act on it. */
export function checkMutability(input: { taskMode: TaskMode; contractMode: TaskMode | undefined; intent?: TaskCreatingIntent | null }): { ok: true } | { ok: false; reason: string } {
  const contractMode = input.contractMode ?? "change";
  if (input.intent && modeForIntent(input.intent) !== input.taskMode) return { ok: false, reason: `task mode ${input.taskMode} contradicts intent ${input.intent}` };
  if (contractMode !== input.taskMode) return { ok: false, reason: `worker contract mutability (${contractMode}) contradicts task mode (${input.taskMode})` };
  return { ok: true };
}

/** The owner's goal as interpreted by the trusted planning layer (immutable for the task's life). */
export interface TaskGoal {
  intent: TaskCreatingIntent;
  /** The owner's original words (sanitized). */
  originalRequest: string;
  interpretedObjective: string;
}
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const WORKER_KINDS = ["claude", "codex"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export const TASK_CATEGORIES = [
  // Claude-primary
  "backend",
  "business_logic",
  "database",
  "auth",
  "security",
  "bug_fix",
  "architecture",
  "general_coding",
  // Codex-primary
  "ui",
  "css",
  "layout",
  "visual_polish",
  "frontend_styling",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/**
 * Structured actions a task declares it will perform. Risk is derived from
 * these (plus changedPaths), never from free text.
 */
export const ACTION_KINDS = [
  // green
  "repo_read",
  "code_edit",
  "ui_edit",
  "run_tests",
  "run_check",
  "run_build",
  "open_pr",
  "update_pr",
  "secret_read",
  // branch-dependent (green on a working branch)
  "commit",
  "push",
  // yellow
  "dependency_change",
  "ci_workflow_change",
  "migration_file_change",
  "auth_logic_change",
  "broad_refactor",
  "config_change",
  // red
  "prod_db_write",
  "prod_schema_change",
  "prod_deploy",
  "force_push",
  "destructive_data_delete",
  "secret_exposure",
  "irreversible_prod_op",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Surfaces where a secret value would become visible beyond the worker. */
export const SECRET_SURFACES = ["code", "git", "pr", "logs", "frontend_bundle", "internet"] as const;
export type SecretSurface = (typeof SECRET_SURFACES)[number];

export interface TaskAction {
  kind: ActionKind;
  /** Target branch for commit/push. Required to prove a push is not to main. */
  branch?: string;
  /** Where a secret would be exposed (secret_exposure only). */
  surface?: SecretSurface;
}

export interface TaskInput {
  id: string;
  category: TaskCategory;
  actions: readonly TaskAction[];
  /** Repo-relative paths the task will change; used for path-based escalation. */
  changedPaths?: readonly string[];
}

export interface RiskDecision {
  level: RiskLevel;
  /** Deterministically ordered, human-readable rule hits. */
  reasons: string[];
  /** True when the task must enter awaiting_approval before execution. */
  requiresApproval: boolean;
}

export interface ClassificationResult {
  taskId: string;
  category: TaskCategory;
  risk: RiskDecision;
}

export type WorkerStatus = "available" | "unavailable" | "quota_exhausted" | "misconfigured";
export type WorkerAvailability = Record<WorkerKind, WorkerStatus>;

export interface RoutingDecision {
  /** null when no eligible worker is available; the task should wait. */
  worker: WorkerKind | null;
  primary: WorkerKind;
  isFallback: boolean;
  fallbackFrom: WorkerKind | null;
  reasonCode: "primary_available" | "fallback_selected" | "fallback_forbidden" | "worker_unavailable";
  reason: string;
}

// ---------------------------------------------------------------------------
// Canonical trusted identifiers

/**
 * One rule for authenticated principal ids, shared by the Gateway (session
 * identity) and the Manager (human decision decidedBy), so an identity the
 * Gateway accepts is never rejected later by a different length rule.
 */
export const MAX_PRINCIPAL_ID_LENGTH = 128;
const TRUSTED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isValidPrincipalId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_PRINCIPAL_ID_LENGTH && TRUSTED_ID_RE.test(value);
}

/** Escalation request ids (`<taskId>.hd.<round>`) follow the same canonical id rule. */
export const isValidEscalationId = isValidPrincipalId;
