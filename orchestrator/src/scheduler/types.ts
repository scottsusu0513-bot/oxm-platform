/**
 * Phase 2C.7 Task Scheduler + Manager Loop — types.
 *
 * The scheduler and Manager Loop are deterministic orchestration, not an LLM
 * agent. They never read repository source code: every input is structured
 * task metadata (ids, enums, paths, SHAs, statuses) or a trusted record
 * returned by an injected port. Side effects (GitHub writes, workspace git,
 * worker execution, QA reads, audit) only ever happen through the narrow
 * ports declared here.
 *
 * Orchestration status is a separate abstraction from domain TaskState: the
 * loop drives TaskState only along edges domain/taskState already allows.
 *
 * Pure type/constant definitions: no I/O, env, network, or nondeterminism.
 */
import type { AssignedBranchPlan, BranchLineage } from "../branches/types";
import type { ApprovalPhase } from "../domain/taskState";
import type { ClassificationResult, RiskLevel, RoutingDecision, TaskAction, TaskCategory, TaskGoal, TaskMode, TaskState, WorkerKind } from "../domain/types";
import type { PullRequestState, QaDecision } from "../github/types";
import type { PollPolicy } from "../github/qa";
import type { BranchCreation, GitHubWriteClient, PushReceipt, TrustedPullRequest } from "../githubWrite/types";
import type { WorkspaceLease, WorkspaceLeaseRegistry } from "../githubWrite/lease";
import type { CommitApprovalEvidence } from "../workers/prompt";
import type { CommitResult, CommitStateResult, PreconditionResult, PrepareResult } from "../githubWrite/workspace";
import type { AcceptanceEvidence, ApprovalEvidenceState, HumanDecisionRequest, HumanEscalationReport, ManagerDiagnosis, ManagerProfile, RepairCounters, RepairCycleRecord, RepairRequest, ValidationEvidence } from "../manager/types";
import type { NewAuditEvent } from "../store/types";
import type { Approval, ApprovalKind, IsoTimestamp } from "../store/types";
import type { RequiredValidation, WorkerErrorType, WorkerHandle, WorkerResult, WorkerTaskContract } from "../workers/types";
import type { LifecycleOutcome, LifecycleWorkload } from "../codespace/types";

// ---------------------------------------------------------------------------
// Priority

export const PRIORITY_CLASSES = ["critical", "high", "normal", "low"] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/** Structured priority signals declared at intake. Never inferred from code. */
export const PRIORITY_SIGNALS = [
  // critical
  "production_incident",
  "security_incident",
  "main_ci_broken",
  // high
  "functional_regression",
  "auth_integrity",
  "data_integrity",
  "release_blocker",
  // normal
  "feature",
  "bug",
  "ux_improvement",
  // low
  "polish",
  "copy_cleanup",
  "refactor",
] as const;
export type PrioritySignal = (typeof PRIORITY_SIGNALS)[number];

export interface PriorityAssessment {
  /** Effective priority used for scheduling. */
  priority: PriorityClass;
  /** Priority derived from policy signals alone. */
  policyPriority: PriorityClass;
  requestedPriority: PriorityClass | null;
  /** Deterministically ordered, human-readable reasons. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Orchestration status / outcomes (separate from TaskState)

export const ORCHESTRATION_STATUSES = [
  "queued",
  "waiting_runtime",
  "runtime_starting",
  "runtime_available",
  "running",
  "waiting_dependency",
  "waiting_workspace",
  "waiting_branch_conflict",
  "repair_requested",
  "qa_pending",
  "needs_human_approval",
  /**
   * Two Manager-guided repair cycles failed; automation paused with an
   * escalation report. Resumable only by a bound human decision; cancellable.
   * The workspace lease is kept so the uncommitted work stays intact.
   */
  "needs_human_decision",
  /**
   * A trusted infrastructure dependency the Manager needs to JUDGE a finished
   * run (the semantic goal reviewer) is unavailable. Typed transient state:
   * no Manager-guided repair cycle is consumed; bounded review retries.
   */
  "waiting_infrastructure",
  "accepted",
  "blocked",
] as const;
export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

export const TERMINAL_ORCHESTRATION_STATUSES: readonly OrchestrationStatus[] = ["accepted", "blocked"];

/** Outcome of one delivered human decision (accepted, rejected, or an idempotent duplicate). */
export interface HumanDecisionLogEntry {
  decisionId: string | null;
  escalationId: string | null;
  outcome: "accepted" | "rejected" | "duplicate";
  reason: string;
  at: IsoTimestamp;
}

export const BRANCH_PLAN_STATES = ["none", "queued", "assigned", "rejected"] as const;
export type BranchPlanState = (typeof BRANCH_PLAN_STATES)[number];

// ---------------------------------------------------------------------------
// Scheduler decisions

export const SCHEDULE_ACTIONS = ["dispatch", "keep_queued", "wait_runtime", "wait_dependency", "wait_branch_conflict", "wait_workspace", "blocked", "completed"] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

export interface ScheduleDecision {
  taskId: string;
  action: ScheduleAction;
  reason: string;
  /** Tasks this decision waits on (dependencies or conflicting work), sorted. */
  waitingOn: string[];
}

/** What the pure scheduler needs to know about one task. */
export interface SchedulerTaskView {
  taskId: string;
  /** Monotonic creation sequence; final tie-breaker before taskId. */
  seq: number;
  priority: PriorityClass;
  state: TaskState;
  status: OrchestrationStatus;
  /** Holds a lease / has been dispatched and is not terminal. */
  inFlight: boolean;
  worker: WorkerKind | null;
  dependsOn: readonly string[];
  workspaceId: string;
  lineageId: string;
  expectedPaths: readonly string[];
  workerExecutions: number;
  maxWorkerExecutions: number;
}

export interface SchedulerPolicy {
  maxConcurrentTasks: number;
  /** Worker kinds that can actually execute in this phase. */
  executableWorkers: readonly WorkerKind[];
  /** Overrides branches/overlap DEFAULT_HIGH_CONFLICT_PATHS. */
  highConflictPaths?: readonly string[];
}

export interface SchedulerInput {
  tasks: readonly SchedulerTaskView[];
  /** Task currently holding the workspace lease, or null. */
  workspaceHolder: (workspaceId: string) => string | null;
  policy: SchedulerPolicy;
  /** Defaults true for isolated scheduler use. The Manager Loop supplies lifecycle readiness. */
  runtimeAvailable?: boolean;
}

// ---------------------------------------------------------------------------
// Capabilities / budget

/** Capabilities the loop may activate. Deterministic modules are not LLM calls. */
export const CAPABILITIES = ["scheduler", "dependency_resolver", "branch_planner", "workspace_lease", "worker", "validator", "repair_loop", "github_write", "github_qa", "human_approval", "replan"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Optional escalation capabilities. Never activated in this phase: there is
 * no code path in the loop that can add them. Listed so tests and metadata
 * can prove their absence.
 */
export const OPTIONAL_CAPABILITIES = ["history_lookup", "deep_review", "second_reviewer", "architecture_analysis", "source_inspection", "extra_llm_call"] as const;
export type OptionalCapability = (typeof OPTIONAL_CAPABILITIES)[number];

export const ESCALATION_ACTIONS = [
  "return_to_worker",
  "retry_infrastructure",
  "replan_branch",
  "wait",
  "block",
  "request_human_approval",
  "request_human_decision",
  "future_deep_review_candidate",
] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

export interface EscalationRecord {
  trigger: string;
  action: EscalationAction;
}

export interface OrchestrationPolicy {
  maxConcurrentTasks: number;
  /** Manager-guided repair cycles; capped by the Manager budget's maxRepairAttempts (the stricter one wins). */
  maxRepairAttempts: number;
  /**
   * Same-contract re-runs after a transient runtime/tool/quota/infrastructure
   * failure (validator TRANSIENT_WORKER_ERRORS), per task. They never consume
   * a Manager-guided repair cycle.
   */
  maxInfrastructureRetries: number;
  /** Human-decision resumes per task; each grants one new round of maxRepairAttempts Manager-guided cycles. */
  maxHumanResumes: number;
  /** Bounded goal-review retries after a reviewer outage (per waiting episode). */
  maxReviewRetries: number;
  /** Automatic pre-execution replans after a stale base. */
  maxReplans: number;
  executableWorkers: readonly WorkerKind[];
  highConflictPaths?: readonly string[];
  /** QA must not see a draft PR (github/qa blocks drafts), so the default is ready. */
  prDraft: boolean;
  qaPoll: PollPolicy;
  /** Disabled in this phase; there is no implementation behind it. */
  deepReviewEnabled: false;
  /** Placeholder for a future LLM call budget; the loop itself makes no LLM calls. */
  llmCallBudget: number | null;
}

export interface OrchestrationBudget {
  managerProfile: ManagerProfile;
  maxRepairAttempts: number;
  maxConcurrentTasks: number;
  /** 1 initial run + maxRepairAttempts repairs + maxInfrastructureRetries. Hard cap enforced by the loop. */
  maxWorkerExecutions: number;
  workerExecutions: number;
  maxInfrastructureRetries: number;
  infrastructureRetries: number;
  /** Runtime invariant: Workers never surface interactive Yes/No permission prompts. */
  workerInteractivePromptsAllowed: false;
  /** Always 0: scheduler, planner, validator and loop are deterministic. */
  managerLlmCalls: 0;
  llmCallBudget: number | null;
  deepReviewEnabled: false;
  activatedCapabilities: Capability[];
  escalationCount: number;
}

// ---------------------------------------------------------------------------
// Intake

export interface AcceptanceCriterionSpec {
  /** Stable criterion id, e.g. "AC-1". */
  id: string;
  text: string;
  /**
   * goal: semantic goal criterion judged by the Manager's trusted reviewer.
   * technical (default): backed by trusted validations.
   */
  kind?: "goal" | "technical";
}

/** Goal context handed to the trusted evidence layer for semantic acceptance. */
export interface GoalAcceptanceContext {
  mode: TaskMode;
  title: string;
  objective: string;
  goal: TaskGoal | null;
  criteria: readonly AcceptanceCriterionSpec[];
}

/** Sanitized, structured view of a red-risk pre-execution approval (no prompts, no diffs). */
export interface StartApprovalEvidence {
  objectiveSummary: string;
  category: TaskCategory;
  actions: string[];
  allowedScope: string[];
  riskReasons: string[];
  /** True when the approval is for a Manager-guided repair or retry contract, not the first run. */
  repair: boolean;
  mode: TaskMode;
}

/** A classified and routed task handed to the loop. Classification/routing happen upstream. */
export interface TaskIntake {
  taskId: string;
  title: string;
  category: TaskCategory;
  actions: readonly TaskAction[];
  classification: ClassificationResult;
  routing: RoutingDecision;
  /** Repo-relative paths the task expects to change (trailing "/" = directory). */
  expectedPaths: readonly string[];
  /** Defaults to expectedPaths. */
  allowedScope?: readonly string[];
  objective: string;
  /** Short sanitized summary for the PR body. */
  summary: string;
  acceptanceCriteria: readonly AcceptanceCriterionSpec[];
  requiredValidations: readonly RequiredValidation[];
  dependsOn?: readonly string[];
  workspaceId: string;
  prioritySignals?: readonly PrioritySignal[];
  requestedPriority?: PriorityClass;
  lineage?: BranchLineage;
  /** Defaults to "change". read_only tasks never commit, push or open a PR. */
  mode?: TaskMode;
  /** Interpreted owner goal (natural-language intake); immutable for the task's life. */
  goal?: TaskGoal;
  /** Typed, auditable risk signals that raised this task's risk at intake (never lowered). */
  riskSignals?: readonly { kind: string; level: "red" | "yellow"; rule: string; evidence: readonly string[]; source: string }[];
}

// ---------------------------------------------------------------------------
// Events

export type OrchestrationEvent =
  | { type: "task_created"; task: TaskIntake }
  | { type: "dependency_completed"; taskId: string }
  | { type: "scheduler_tick" }
  /** Posted by an external trusted lifecycle status notification. */
  | { type: "runtime_status_updated" }
  | { type: "workspace_available"; workspaceId: string }
  /** Results are taken from the loop's own worker handle, never from the event. */
  | { type: "worker_completed"; taskId: string; runId: string }
  | { type: "worker_failed"; taskId: string; runId: string }
  | { type: "repair_completed"; taskId: string; runId: string }
  | { type: "branch_pushed"; taskId: string }
  | { type: "pr_opened"; taskId: string }
  /** A notification only; QA is read through the trusted read-only port. */
  | { type: "qa_updated"; taskId: string }
  | { type: "approval_granted"; taskId: string; phase: ApprovalPhase }
  /** Untrusted human response to a needs_human_decision escalation; normalized and bound by the loop. Never an approval. */
  | { type: "human_decision_submitted"; taskId: string; decision: unknown }
  | { type: "approval_rejected"; taskId: string; phase: ApprovalPhase }
  /** External timer: retry the Manager's goal review of the already finished run (never re-runs the Worker). */
  | { type: "review_retry"; taskId: string };

export type OrchestrationEventType = OrchestrationEvent["type"];

// ---------------------------------------------------------------------------
// Ports (injected side-effect adapters)

/** Trusted record of one worker run, produced by the git/validation layer — never worker prose. */
export interface TrustedRunRecord {
  changedPaths: readonly string[];
  validations: readonly ValidationEvidence[];
  acceptance: readonly AcceptanceEvidence[];
  /** Workspace HEAD verified from git after the run. */
  verifiedHeadSha: string | null;
  /** The Manager's goal reviewer was unavailable (infrastructure). Never a goal verdict; never consumes a repair cycle. */
  goalReviewUnavailable?: boolean;
  observedRisk: RiskLevel;
}

export interface WorkerPort {
  /** Starts exactly one run through the adapter registered for the selected kind. */
  start(kind: WorkerKind, contract: WorkerTaskContract, approval?: Approval | null): WorkerHandle;
}

export interface WorkspacePort {
  /** Wraps githubWrite/workspace.prepareAssignedWorkspace. */
  prepare(input: { plan: unknown; lease: unknown; creation: BranchCreation | null }): Promise<PrepareResult>;
  /** Wraps githubWrite/workspace.checkWorkerPreconditions with the live git status. */
  checkPreconditions(input: { prepared: unknown; plan: unknown; contract: WorkerTaskContract; lease: unknown }): Promise<PreconditionResult>;
  /** Branch/HEAD of the leased workspace from git (repair start check). */
  head(lease: WorkspaceLease): Promise<{ branch: string; headSha: string } | null>;
  /** Re-reads branch, HEAD, and dirty paths from trusted Git. */
  observeCommitState(lease: WorkspaceLease): Promise<CommitStateResult>;
  /** Creates one trusted local commit from already validated, Git-observed paths. */
  commitValidated(input: { plan: unknown; lease: unknown; evidence: CommitApprovalEvidence; approval: Approval; at: IsoTimestamp }): Promise<CommitResult>;
}

export interface EvidencePort {
  record(input: { taskId: string; runId: string; contract: WorkerTaskContract; result: WorkerResult; lease: WorkspaceLease; goal?: GoalAcceptanceContext }): Promise<TrustedRunRecord>;
}

export interface QaPort {
  /** Reads the PR and its checks through the read-only client and returns github/qa.evaluateQa. */
  read(prNumber: number): Promise<QaDecision>;
}

export interface RepoStatePort {
  /** Current main HEAD SHA (read-only). */
  mainHeadSha(): Promise<string>;
}

export interface ApprovalCheck {
  taskId: string;
  phase: ApprovalPhase;
  kind: ApprovalKind;
  requestedAction: string;
  bindingShaOrActionId: string;
  /** Structured, sanitized evidence for the commit/publish approval UI. */
  evidence?: CommitApprovalEvidence;
  /** Structured, sanitized evidence for a red-risk pre-execution approval UI. */
  startEvidence?: StartApprovalEvidence;
}

export interface TrustedApprovalResult {
  state: ApprovalEvidenceState;
  /** Present only when approvalAuthorizes() accepted this exact request. */
  approval: Approval | null;
  reason: string;
}

export interface ApprovalPort {
  /** Resolves current trusted store state. Notification event fields never authorize work. */
  resolve(check: ApprovalCheck): Promise<TrustedApprovalResult>;
}

export type PendingSideEffect = "worker" | "commit" | "push" | "pr" | null;

/**
 * Versioned, sanitized Manager Loop checkpoint. This contains structured
 * contracts/evidence only: never source, diffs, raw logs, built prompts or
 * secrets. Implementations may persist it in the existing audit repository.
 */
export interface OrchestrationCheckpoint {
  version: 1;
  sequence: number;
  tasks: readonly PersistedTaskRecord[];
}

export interface PersistedTaskRecord {
  intake: TaskIntake;
  seq: number;
  lineageId: string;
  priority: PriorityAssessment;
  risk: RiskLevel;
  worker: WorkerKind | null;
  state: TaskState;
  status: OrchestrationStatus;
  branchPlanState: BranchPlanState;
  plan: AssignedBranchPlan | null;
  baseContract: WorkerTaskContract | null;
  contract: WorkerTaskContract | null;
  runId: string | null;
  runCount: number;
  workerRunning: boolean;
  workerExecutions: number;
  maxRepairAttempts: number;
  lastResult: WorkerResult | null;
  record: TrustedRunRecord | null;
  repair: RepairCounters;
  /** Manager-guided repair cycles (diagnosis, repair run, revalidation). Optional for older checkpoints. */
  repairCycles?: RepairCycleRecord[];
  infrastructureRetries?: number;
  humanEscalation?: HumanEscalationReport | null;
  humanRound?: number;
  humanDecisionRequest?: HumanDecisionRequest | null;
  escalationPhase?: "pre_push" | "post_qa" | null;
  humanDecisionLog?: HumanDecisionLogEntry[];
  consumedHumanDecisionIds?: string[];
  escalationHistory?: HumanEscalationReport[];
  pendingRepair?: { request: RepairRequest; contract: WorkerTaskContract } | null;
  pendingRetry?: { contract: WorkerTaskContract; errorType: string } | null;
  replans: number;
  receipt: PushReceipt | null;
  pr: TrustedPullRequest | null;
  prState: PullRequestState | null;
  qa: QaDecision | null;
  qaPolls: number;
  nextQaPollDelayMs: number | null;
  approval: Record<ApprovalPhase, ApprovalEvidenceState>;
  approvalPhase: ApprovalPhase | null;
  /** Time the current exact approval binding was presented to a human. */
  approvalRequestedAt?: IsoTimestamp | null;
  /** Exact sanitized state shown for commit/publish approval. */
  commitApprovalEvidence?: CommitApprovalEvidence | null;
  queueReason: string | null;
  blockingReason: string | null;
  escalations: EscalationRecord[];
  capabilities: Capability[];
  pendingSideEffect: PendingSideEffect;
  pendingSideEffectId: string | null;
  /** Runtime intake control; does not alter the TaskState model. */
  paused?: boolean;
  /** Finished run waiting for the Manager's goal review (infrastructure outage). */
  pendingReview?: boolean;
  reviewRetries?: number;
}

export interface OrchestrationPersistencePort {
  load(): OrchestrationCheckpoint | null;
  save(checkpoint: OrchestrationCheckpoint): void;
}

export interface OrchestrationPorts {
  /** Narrow write client: no merge, approve, close, force push or main push exist on it. */
  github: Pick<GitHubWriteClient, "createTaskBranch" | "pushTaskBranch" | "openPullRequest">;
  leases: WorkspaceLeaseRegistry;
  workspace: WorkspacePort;
  worker: WorkerPort;
  evidence: EvidencePort;
  qa: QaPort;
  repo: RepoStatePort;
  approvals: ApprovalPort;
  /** Omitted only by isolated unit fakes that intentionally do not test restart behavior. */
  persistence?: OrchestrationPersistencePort;
  now: () => IsoTimestamp;
  audit: (event: Omit<NewAuditEvent, "id">) => void;
  /** Optional only for backwards-compatible local simulations; configured deployments provide it. */
  lifecycle?: {
    reconcile(work: LifecycleWorkload, now: IsoTimestamp): Promise<LifecycleOutcome>;
  };
}

// ---------------------------------------------------------------------------
// Snapshot (read-only view of one orchestrated task)

export interface TaskSnapshot {
  taskId: string;
  seq: number;
  title: string;
  category: TaskCategory;
  mode: TaskMode;
  /** Accepted answer of a read_only task (Worker report judged by the Manager's reviewer); null otherwise. */
  answer: string | null;
  /** A finished run is waiting for the goal reviewer (infrastructure), with this many retries used. */
  pendingReview: boolean;
  reviewRetries: number;
  risk: RiskLevel;
  priority: PriorityAssessment;
  state: TaskState;
  status: OrchestrationStatus;
  branchPlanState: BranchPlanState;
  branch: string | null;
  worker: WorkerKind | null;
  dependsOn: string[];
  workspaceId: string;
  expectedPaths: string[];
  inFlight: boolean;
  workerRunning: boolean;
  /** Sanitized adapter/worker failure classification from the latest completed run. */
  workerErrorType: WorkerErrorType | null;
  paused: boolean;
  repair: RepairCounters;
  repairCycles: RepairCycleRecord[];
  /** Set only in needs_human_decision. */
  humanEscalation: HumanEscalationReport | null;
  /** Open escalation a human decision must bind to (null when none is open). */
  humanDecisionRequest: HumanDecisionRequest | null;
  /** 1 initially; +1 per accepted human decision. */
  humanRound: number;
  /** Every escalation report ever issued for this task, oldest first. */
  escalationHistory: HumanEscalationReport[];
  humanDecisionLog: HumanDecisionLogEntry[];
  /** Red-risk repair plan waiting for its own fresh pre-execution approval. */
  pendingRepair: { round: number; attempt: number; diagnosis: ManagerDiagnosis; approvalBinding: string } | null;
  /** Red-risk transient retry waiting for a fresh pre-execution approval of its changed contract. */
  pendingRetry: { errorType: string; approvalBinding: string } | null;
  replans: number;
  prNumber: number | null;
  headSha: string | null;
  approvalPhase: ApprovalPhase | null;
  qaStatus: QaDecision["status"] | null;
  /** Suggested delay before the next qa_updated, for an external timer. */
  nextQaPollDelayMs: number | null;
  queueReason: string | null;
  blockingReason: string | null;
  escalations: EscalationRecord[];
  budget: OrchestrationBudget;
}
