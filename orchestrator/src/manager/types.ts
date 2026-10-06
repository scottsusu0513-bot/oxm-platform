/**
 * Phase 2C.6 Thin Manager — types.
 *
 * The Manager manages process and validates *evidence*, never implementation.
 * Hard boundary: nothing in orchestrator/src/manager/ reads repository source
 * code, file contents, diffs, raw logs, or prompts. Every input is a
 * normalized, structured evidence record (IDs, enums, booleans, SHAs, paths,
 * statuses, short sanitized summaries). Workers read code, decide how to
 * implement, and repair failures; the Manager only says WHAT failed.
 *
 * Pure type/constant definitions: no I/O, env, network, or nondeterminism.
 */
import type { BranchDecisionKind } from "../branches/types";
import type { RiskLevel, TaskState, WorkerKind } from "../domain/types";
import type { CheckOutcome, PullRequestState } from "../github/types";
import type { WorkerErrorType, WorkerResultStatus } from "../workers/types";

// ---------------------------------------------------------------------------
// Decisions

export const MANAGER_DECISIONS = ["accepted", "needs_repair", "blocked", "needs_human_approval"] as const;
export type ManagerDecision = (typeof MANAGER_DECISIONS)[number];

/** Maximum length of any sanitized summary carried in evidence (single line). */
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_ID_LENGTH = 64;
export const MAX_LIST_LENGTH = 200;

// ---------------------------------------------------------------------------
// Structured evidence (all fields are data, never code)

/** 1. Scope: real changed paths (from git) vs the task's allowed scope. */
export interface ScopeEvidence {
  /** Repo-relative paths; a trailing "/" marks a directory prefix. */
  allowedScope: readonly string[];
  /** Real changed paths reported by the trusted git layer (never worker prose). */
  changedPaths: readonly string[];
}

export const VALIDATION_STATUSES = ["passed", "failed", "skipped", "missing"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** 2. One validation (e.g. "tests", "typecheck"). No raw logs. */
export interface ValidationEvidence {
  name: string;
  requested: boolean;
  executed: boolean;
  status: ValidationStatus;
  /** True only when recorded by a trusted orchestrator component, not worker prose. */
  trusted: boolean;
  summary?: string;
}

/** 3. CI for the PR head, as normalized by the read-only QA layer. */
export interface CiEvidence {
  requiredChecks: readonly string[];
  /** SHA the observations were taken on. Must equal the evidence head SHA. */
  headSha: string;
  /** True only when produced by github/qa (trusted GitHub read layer). */
  trusted: boolean;
  checks: readonly { name: string; outcome: CheckOutcome }[];
}

export const ACCEPTANCE_STATUSES = ["satisfied", "failed", "unknown"] as const;
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

/**
 * What backs an acceptance status. "worker_report" is self-reported prose and
 * is never sufficient on its own to satisfy a criterion.
 */
export const ACCEPTANCE_EVIDENCE_TYPES = ["validation", "ci_check", "scope", "human", "worker_report"] as const;
export type AcceptanceEvidenceType = (typeof ACCEPTANCE_EVIDENCE_TYPES)[number];

/** 4. One acceptance criterion's outcome. */
export interface AcceptanceEvidence {
  criterionId: string;
  status: AcceptanceStatus;
  evidenceType: AcceptanceEvidenceType;
  /** ID of the backing record: validation name, CI check name, "scope", or a human review id. */
  reference: string | null;
  summary?: string;
}

export const APPROVAL_EVIDENCE_STATES = ["none", "pending", "approved", "rejected", "expired"] as const;
export type ApprovalEvidenceState = (typeof APPROVAL_EVIDENCE_STATES)[number];

/** 5. Risk: stored vs observed. Risk only ever escalates. */
export interface RiskEvidence {
  stored: RiskLevel;
  observed: RiskLevel;
  /** State of the approval bound to the current phase/SHA (computed via store/approvalAuthorizes). */
  approval: ApprovalEvidenceState;
}

export const WORKSPACE_PROOF_STATES = ["verified", "missing", "mismatch"] as const;
export type WorkspaceProofState = (typeof WORKSPACE_PROOF_STATES)[number];

export const BASE_FRESHNESS = ["fresh", "stale"] as const;
export type BaseFreshness = (typeof BASE_FRESHNESS)[number];

/** 6. Branch/workspace proof references. */
export interface BranchEvidence {
  assignedBranch: string;
  plannedBaseSha: string;
  /** Head verified by the trusted git/GitHub layer. */
  verifiedHeadSha: string | null;
  /** Branch/head the worker result was bound to (from git, not prose). */
  workerBranch: string;
  workerHeadSha: string | null;
  workspaceProof: WorkspaceProofState;
  branchPlanDecision: BranchDecisionKind;
  baseFreshness: BaseFreshness;
  /** Overlapping in-flight work detected by the branch planner. */
  conflict: boolean;
}

export interface WorkerEvidence {
  kind: WorkerKind;
  status: WorkerResultStatus;
  errorType: WorkerErrorType | null;
}

export interface PriorRepairOutcome {
  attempt: number;
  decision: ManagerDecision;
  failedEvidenceIds: readonly string[];
}

export interface RepairCounters {
  /** 0 = initial worker execution; n = n-th repair attempt. */
  attempt: number;
  prior: readonly PriorRepairOutcome[];
}

export interface PullRequestEvidence {
  /** Only from the trusted GitHub write/read layer. */
  number: number;
  state: PullRequestState;
}

/** Everything the Manager may see about a task. No source code, logs, or prompts. */
export interface ManagerEvidence {
  taskId: string;
  /** Root task id of the logical task/epic (taskId when standalone). */
  lineageId: string;
  taskState: TaskState;
  worker: WorkerEvidence;
  scope: ScopeEvidence;
  validations: readonly ValidationEvidence[];
  /** null before a PR exists. */
  ci: CiEvidence | null;
  /** Criterion IDs from the task contract (e.g. "AC-1"). */
  acceptanceCriteriaIds: readonly string[];
  acceptance: readonly AcceptanceEvidence[];
  risk: RiskEvidence;
  branch: BranchEvidence;
  pr: PullRequestEvidence | null;
  repair: RepairCounters;
}

// ---------------------------------------------------------------------------
// Budget / effort policy

export const MANAGER_PROFILES = ["fast", "standard", "controlled"] as const;
export type ManagerProfile = (typeof MANAGER_PROFILES)[number];

export type WorkerEffort = "normal" | "increased";

export interface ManagerBudget {
  profile: ManagerProfile;
  riskLevel: RiskLevel;
  maxRepairAttempts: number;
  requiresSecondReview: boolean;
  /** Whether repeated failure may be flagged as a *future* deep-review candidate. Never executes anything. */
  allowDeepEscalation: boolean;
  historicalLookup: "none" | "recent";
  qa: "standard" | "expanded";
  approvalRequired: boolean;
}

// ---------------------------------------------------------------------------
// Escalation

export const ESCALATION_TRIGGERS = [
  "worker_failure",
  "validation_failure",
  "ci_failure",
  "acceptance_failure",
  "scope_violation",
  "branch_conflict",
  "stale_base",
  "unsafe_branch_state",
  "observed_risk_escalation",
  "approval_required",
  "approval_rejected",
  "missing_trusted_evidence",
  "repeated_repair_failure",
  "task_state_blocked",
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const ESCALATION_INTENTS = [
  "return_to_worker",
  "replan_branch",
  "request_human_approval",
  "stop_task",
  /** Marker only: deep review is a future capability and is never executed. */
  "future_deep_review_candidate",
] as const;
export type EscalationIntent = (typeof ESCALATION_INTENTS)[number];

// ---------------------------------------------------------------------------
// Validator output

export interface Finding {
  /** Stable evidence id, e.g. "validation:tests", "ci:verify", "acceptance:AC-2". */
  evidenceId: string;
  /** Decision this finding alone would force. */
  severity: Exclude<ManagerDecision, "accepted">;
  /** Machine-readable reason code (snake_case). */
  code: string;
  trigger: EscalationTrigger;
  summary?: string;
}

export interface ManagerValidation {
  taskId: string;
  decision: ManagerDecision;
  budget: ManagerBudget;
  /** Effective risk (stored escalated by observed; never lowered). */
  riskLevel: RiskLevel;
  findings: Finding[];
  /** Sorted, deduplicated ids of evidence that failed. */
  failedEvidenceIds: string[];
  /** Sorted, deduplicated reason codes. */
  reasonCodes: string[];
  triggers: EscalationTrigger[];
  intents: EscalationIntent[];
}

// ---------------------------------------------------------------------------
// Repair request (WHAT failed, never HOW to fix it)

export interface RepairRequest {
  kind: "repair_request";
  taskId: string;
  lineageId: string;
  /** Same worker as the failed run; repairs never switch workers. */
  worker: WorkerKind;
  branch: string;
  baseSha: string;
  /** Head the repair run must start from (the current verified head). */
  expectedHeadSha: string;
  /** 1-based repair attempt number this request authorizes. */
  attempt: number;
  maxRepairAttempts: number;
  workerEffort: WorkerEffort;
  failedEvidenceIds: string[];
  failedValidations: string[];
  ciFailures: string[];
  failedAcceptanceCriteria: string[];
  unverifiedAcceptanceCriteria: string[];
  workerErrorType: WorkerErrorType | null;
  allowedScope: string[];
  /** Git-observed paths from the prior run that a repair may inherit as dirty. */
  allowedDirtyPaths: string[];
  rerunValidations: string[];
  /** Sanitized single-line summaries keyed by evidence id. */
  failureSummaries: { evidenceId: string; summary: string }[];
  /** Fixed process instructions (constant text, no implementation advice). */
  instructions: readonly string[];
}
