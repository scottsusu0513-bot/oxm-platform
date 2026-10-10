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
import type { EvidencePlan } from "../executive/evidencePlan";
import type { GuidanceConstraint } from "../executive/guidance";
import type { ManagerRepairPlan } from "./managerPlan";

// ---------------------------------------------------------------------------
// Decisions

/**
 * needs_human_decision: two completed Manager-guided repair cycles still
 * failed. Automation stops and a structured escalation report is handed to a
 * human; it is never produced by a single finding.
 */
export const MANAGER_DECISIONS = ["accepted", "needs_repair", "blocked", "needs_human_approval", "needs_human_decision"] as const;
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

/**
 * passed: executed and passed. failed: executed and failed with no sign of an
 * infrastructure cause and no unrelated workspace state present — the only
 * status that counts as failed_due_to_task. unavailable: could not run because
 * of infrastructure (package manager, dependencies, tooling, external service).
 * unverified: ran but the outcome cannot be attributed to the task (timeout,
 * killed, or a failure while unrelated workspace changes were present).
 * skipped / missing: not run (no command configured). Every status other than
 * passed/failed is reported to the owner as not verified; none of them is a
 * task failure or a reason to repair.
 */
export const VALIDATION_STATUSES = ["passed", "failed", "skipped", "missing", "unavailable", "unverified"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];
/** Statuses that mean "not verified" (not a task failure). */
export const UNVERIFIED_VALIDATION_STATUSES: readonly ValidationStatus[] = ["skipped", "missing", "unavailable", "unverified"];

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
/**
 * "constraint_check": a durable owner constraint verified mechanically from trusted runtime
 * evidence (Git-observed paths, trusted run records) — never from the Worker saying it complied.
 */
export const ACCEPTANCE_EVIDENCE_TYPES = ["validation", "ci_check", "scope", "human", "worker_report", "manager_review", "constraint_check"] as const;
export type AcceptanceEvidenceType = (typeof ACCEPTANCE_EVIDENCE_TYPES)[number];

/** 4. One acceptance criterion's outcome. */
/**
 * "manager_review": the Manager's trusted goal reviewer judged the criterion
 * against the original goal and trusted evidence (diff / answer); never the
 * Worker's own report.
 */
export interface AcceptanceEvidence {
  criterionId: string;
  status: AcceptanceStatus;
  evidenceType: AcceptanceEvidenceType;
  /** ID of the backing record: validation name, CI check name, "scope", or a human review id. */
  reference: string | null;
  summary?: string;
  /**
   * Safeguard criterion (generic "existing behaviour preserved", "required
   * validations pass"): only a CONFIRMED failure blocks it. When it is merely
   * unverified it is reported to the owner as an advisory, never repaired.
   * Owner goal criteria never carry this flag.
   */
  confirmedFailureOnly?: boolean;
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
  /** Transient runtime/tool/quota/infrastructure failure; retried by the loop without a Manager-guided cycle. */
  "infrastructure_failure",
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const ESCALATION_INTENTS = [
  "return_to_worker",
  "replan_branch",
  "request_human_approval",
  "stop_task",
  /** Two Manager-guided repair cycles failed: a human must decide. */
  "request_human_decision",
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
  /**
   * Non-blocking observations the owner is told about (unverified validations,
   * unverified safeguard criteria). They never change the decision.
   */
  advisories: Advisory[];
}

export interface Advisory {
  evidenceId: string;
  code: "validation_unverified" | "acceptance_unverified_advisory";
  summary?: string;
}

// ---------------------------------------------------------------------------
// Manager root-cause diagnosis (structured; derived only from trusted evidence)

export const DIAGNOSIS_PHASES = ["local_validation", "post_pr_ci"] as const;
export type DiagnosisPhase = (typeof DIAGNOSIS_PHASES)[number];

/** How the failure changed relative to the previous diagnosis. */
export const FAILURE_TRENDS = ["stagnated", "partially_resolved", "shifted"] as const;
export type FailureTrend = (typeof FAILURE_TRENDS)[number];

export interface DiagnosisFinding {
  evidenceId: string;
  failureCode: string;
  expected: string;
  actual: string;
}

/** Comparison of a fresh failure with the previous diagnosis and its repair. */
export interface PreviousRepairComparison {
  /** Cycle whose repair produced the current evidence. */
  cycle: number;
  previousFailureCode: string;
  previousFingerprint: string;
  currentFingerprint: string;
  fingerprintChanged: boolean;
  /** True when the set of failing checks/codes is different from the previous one. */
  failureModeChanged: boolean;
  resolvedEvidenceIds: string[];
  persistingEvidenceIds: string[];
  newEvidenceIds: string[];
  trend: FailureTrend;
  /** Worker outcome of the previous repair run. */
  previousRepairOutcome: string;
}

/**
 * One Manager-guided root-cause diagnosis. Every field is derived from
 * normalized trusted evidence (ids, codes, statuses, SHAs, sanitized
 * single-line summaries) — never from source code, diffs, raw logs or prompts.
 */
export interface ManagerDiagnosis {
  kind: "manager_diagnosis";
  taskId: string;
  /** Repair round: 1 initially, +1 per accepted human decision. */
  round: number;
  /** 1-based Manager-guided repair cycle (within its round) this diagnosis starts. */
  cycle: number;
  phase: DiagnosisPhase;
  /** Head the failing evidence was observed on. */
  headSha: string | null;
  failureCode: string;
  failingCheck: string;
  expected: string;
  actual: string;
  rootCause: string;
  requiredFix: string;
  protectedAreas: string[];
  acceptanceCriteria: string[];
  evidenceUsed: string[];
  /** Stable "evidenceId=code|..." fingerprint of the repairable failures. */
  fingerprint: string;
  findings: DiagnosisFinding[];
  previous: PreviousRepairComparison | null;
  /** Human decision consumed as new evidence (first cycle of a resumed round only). */
  humanDecision: HumanDecisionEvidence | null;
  /** Every accepted owner guidance of this task, restated: durable constraints on this and later repairs. */
  ownerConstraints?: string[];
  /** Direct evidence the repair must gather (Manager evidence plan + owner guidance). */
  evidenceRequests?: string[];
  /** Validations the owner rejected that this repair plan does NOT rerun (read-only). */
  deferredValidations?: string[];
  /** Explicit justification when a validation the owner rejected must still run (change tasks: safety gate). */
  constraintJustification?: string | null;
  /**
   * The GPT Manager's validated structured repair plan (root cause, strategy, instructions, evidence,
   * validation plan). The deterministic fields above remain the trusted failure facts it was given.
   */
  managerPlan?: ManagerRepairPlan;
}

/**
 * What the Manager knows about the task's GOAL when it plans a repair:
 * mutability, the durable owner guidance and the evidence plan. Repair
 * planning reasons from this, so it requests missing evidence instead of
 * blindly repeating generic validation.
 */
export interface RepairPlanningContext {
  mode: "change" | "read_only";
  constraints: readonly GuidanceConstraint[];
  evidencePlan: EvidencePlan | null;
}

/** One completed (or in-flight) Manager-guided repair cycle. */
export interface RepairCycleRecord {
  round: number;
  cycle: number;
  diagnosis: ManagerDiagnosis;
  repairRunId: string | null;
  /** Worker outcome of the repair run (null while it runs). */
  workerResult: { status: WorkerResultStatus; errorType: WorkerErrorType | null } | null;
  /** Manager re-validation of the repaired result (null until revalidated). */
  revalidation: { decision: ManagerDecision; failureCode: string | null; fingerprint: string | null } | null;
}

export interface HumanEscalationReport {
  kind: "human_escalation_report";
  state: "needs_human_decision";
  taskId: string;
  round: number;
  /** Identity + binding a human decision must echo to resume this escalation. */
  decisionRequest: HumanDecisionRequest;
  cyclesCompleted: number;
  originalFailure: { failureCode: string; failingCheck: string; actual: string; fingerprint: string } | null;
  diagnoses: ManagerDiagnosis[];
  repairOutcomes: { cycle: number; repairRunId: string | null; workerResult: string; revalidation: string }[];
  currentBlocker: { failureCode: string; failingCheck: string; expected: string; actual: string; fingerprint: string };
  /** stagnated: every cycle ended on the same fingerprint; changed: the failure mode moved. */
  fingerprintTrend: "stagnated" | "changed";
  currentComparison: PreviousRepairComparison | null;
  managerRecommendation: string;
  humanDecisionRequired: string;
  /** The decision belongs to a decomposed request's combined repair (bound to its lead task, whose own work is complete). */
  groupDecision?: true;
  /** Options the GPT Manager offered the owner (when it asked for a decision); "option B" replies resolve against these. */
  ownerDecision?: { question: string; options: { id: string; summary: string }[]; recommended: string | null } | null;
}

// ---------------------------------------------------------------------------
// Human decision (resume of a needs_human_decision escalation)

/**
 * The only decision a human can hand back to the Manager: new information /
 * clarification that the Manager turns into a fresh repair plan. It carries
 * no approval of any kind (commit, publish, merge, deploy, red risk); those
 * remain separate trusted approvals. Cancellation uses the cancel path.
 */
export const HUMAN_DECISION_KINDS = ["continue_with_guidance"] as const;
export type HumanDecisionKind = (typeof HUMAN_DECISION_KINDS)[number];
export const MAX_HUMAN_GUIDANCE_LENGTH = 600;

/** Exact binding of one open escalation. A decision must match every field. */
export interface HumanDecisionRequest {
  kind: "human_decision_request";
  escalationId: string;
  taskId: string;
  lineageId: string;
  branch: string;
  /** Verified workspace HEAD at escalation; the resume re-checks the live workspace against it. */
  expectedHeadSha: string;
  round: number;
  cyclesCompleted: number;
  fingerprint: string;
}

/** Untrusted human input, accepted only after strict normalization and binding. */
export interface HumanDecisionInput {
  decisionId: string;
  escalationId: string;
  taskId: string;
  branch: string;
  expectedHeadSha: string;
  kind: HumanDecisionKind;
  guidance: string;
  decidedBy: string;
}

/** Normalized human decision as Manager evidence. */
export interface HumanDecisionEvidence {
  decisionId: string;
  escalationId: string;
  round: number;
  kind: HumanDecisionKind;
  guidance: string;
  decidedBy: string;
}

// ---------------------------------------------------------------------------
// Repair request (Manager diagnosis + outcome-level required fix; the Worker decides the code)

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
  /** The Manager root-cause diagnosis this repair cycle executes. */
  diagnosis: ManagerDiagnosis;
}
