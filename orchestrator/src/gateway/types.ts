import type { ApprovalPhase } from "../domain/taskState";
import type { RiskLevel, TaskMode, TaskState, WorkerKind } from "../domain/types";
import type { AgentTaskStatus } from "../intake/types";
import type { Approval, ApprovalKind, IsoTimestamp } from "../store/types";
import type { CommitApprovalEvidence } from "../workers/prompt";
import type { HumanDecisionInput, HumanDecisionRequest } from "../manager/types";
import type { IntentDecision } from "../planning/types";
import type { StartApprovalEvidence, TaskDeliveryView, TaskPreviewView } from "../scheduler/types";
import type { DeployApprovalEvidence } from "../delivery/types";
import type { DeliveryTarget } from "../domain/types";
import type { LifecyclePhase } from "../domain/delivery";

export const GATEWAY_CAPABILITIES = [
  "task:submit",
  "task:read",
  "task:pause",
  "task:cancel",
  "approval:read",
  /** Generic: may decide any approval kind (operator consoles). */
  "approval:grant",
  "approval:reject",
  /** Least-privilege, kind-scoped approval capabilities (e.g. a mobile transport). */
  "approval:grant:start",
  "approval:grant:commit_publish",
  "approval:reject:start",
  "approval:reject:commit_publish",
  /**
   * Decide an Owner merge + production deployment approval bound to exact deploy evidence. A DECISION
   * only: execution stays with the trusted delivery layer after the Manager re-binds fresh PR/CI state.
   */
  "approval:grant:deploy",
  "approval:reject:deploy",
  /** Ask for changes to a result awaiting publish approval (same task). Grants no approval of any kind. */
  "publish:revise",
  /** Ask the trusted planning layer to interpret an owner message (no side effects besides storing the interpretation). */
  "task:interpret",
  /** View an open needs_human_decision escalation and decision outcomes. */
  "human_decision:read",
  /** Submit guidance to an open escalation. Grants no approval of any kind. */
  "human_decision:submit",
] as const;
export type GatewayCapability = (typeof GATEWAY_CAPABILITIES)[number];

export interface AuthContext {
  principalId: string;
  principalType: "service" | "user" | "operator";
  authenticated: boolean;
  roles: readonly string[];
  capabilities: readonly GatewayCapability[];
  requestId: string;
  source: string;
  authenticatedAt: IsoTimestamp;
}

export interface GatewayAuthenticationInput {
  credentials: unknown;
  requestId: string;
  source: string;
}

export interface GatewayAuthenticator {
  verify(input: GatewayAuthenticationInput): Promise<AuthContext>;
}

export interface GatewayCall<T = unknown> {
  authentication: GatewayAuthenticationInput;
  request: T;
}

export interface SubmitTaskRequest {
  idempotencyKey: string;
  userInstruction: string;
  title?: string;
  priority?: "critical" | "high" | "normal" | "low";
  expectedScopeHint?: readonly string[];
  productAreaHint?: string;
  workerPreference?: WorkerKind;
  acceptanceCriteria?: readonly string[];
  requiredValidations?: readonly ("tests" | "typecheck" | "smoke")[];
}

export interface TaskRequest {
  taskId: string;
}

export interface TaskMutationRequest extends TaskRequest {
  idempotencyKey: string;
}

export interface ApprovalDecisionRequest extends TaskMutationRequest {
  approvalRequestId: string;
  kind: ApprovalKind;
  phase: ApprovalPhase;
  action: string;
  bindingTarget: string;
}

export interface GatewayTaskStatus {
  taskId: string;
  status: AgentTaskStatus["orchestrationStatus"];
  taskState: TaskState;
  priority: "critical" | "high" | "normal" | "low";
  risk: RiskLevel;
  assignedWorker: WorkerKind | null;
  branch: string | null;
  headSha: string | null;
  prNumber: number | null;
  prState: "open" | "closed" | "merged" | null;
  qaState: string | null;
  repairAttempt: number;
  waitReason: string | null;
  mode: TaskMode;
  /** Manager-accepted answer of a completed read_only task (sanitized). */
  answer: string | null;
  /** Manager's result summary of change work (sanitized); null when the Manager wrote none. */
  resultSummary?: string | null;
  /** Structured technical facts, shown only when the owner explicitly asks (sanitized; no SHAs, secrets or model reasoning). */
  details?: import("../intake/types").TaskTechnicalDetails;
  /** Worker assignment state (area, temporary cover, availability pause); presentation only, never authority. */
  workforce?: {
    workArea: "programming" | "visual";
    primaryWorker: WorkerKind;
    temporaryCover: boolean;
    handoffs: number;
    availabilityPause: { waitingFor: WorkerKind[]; resetAt: string | null; exhausted: WorkerKind; cause: "quota" | "authentication" | "executable" | "service" } | null;
    /** lead: the part that carries the owner-facing combined result (one message per request). */
    combinedReview: {
      status: "waiting_parts" | "reviewing" | "review_unavailable" | "accepted" | "not_accepted" | "repairing" | "diagnosis_unavailable" | "needs_human_decision";
      ownerSummary: string | null;
      lead: boolean;
      leadTaskId: string;
      round: number;
      cycle: number;
      repairTargets: ("programming" | "visual")[];
    } | null;
  };
  approvalRequired: boolean;
  /** Owner-facing lifecycle phase; "completed" only after a verified terminal success. */
  lifecyclePhase?: LifecyclePhase;
  deliveryTarget?: DeliveryTarget;
  /** Production delivery facts (sanitized; no SHAs). */
  delivery?: GatewayDeliveryView | null;
  /** Live preview of a UI task (sanitized; URL validated). */
  preview?: GatewayPreviewView | null;
  /** Live execution facts for the read-only status observatory (sanitized identities and SHAs; no authorization objects or free Worker text). */
  execution?: GatewayExecutionView | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type GatewayDeliveryView = Pick<TaskDeliveryView, "stage" | "prNumber" | "deployStatus" | "health" | "smoke" | "failure" | "observerMissing" | "unverified" | "verifiedAt" | "productionHost">;
export type GatewayPreviewView = TaskPreviewView;
export type GatewayExecutionView = import("../scheduler/types").TaskExecutionView;

export interface PendingApprovalRequirement {
  approvalRequestId: string;
  taskId: string;
  kind: ApprovalKind;
  phase: ApprovalPhase;
  risk: RiskLevel;
  action: string;
  bindingTarget: string;
  requestedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  status: "pending";
  reasonSummary: string;
  /** Sanitized Manager-reviewed evidence; present for commit/publish only. */
  commitEvidence?: CommitApprovalEvidence;
  /** Sanitized description of a red-risk pre-execution approval. */
  startEvidence?: StartApprovalEvidence;
  /** Exact merge + deploy evidence of a deploy approval; present for deploy only. */
  deployEvidence?: DeployApprovalEvidence;
}

// ---------------------------------------------------------------------------
// Natural-language interpretation (trusted planning layer)

export interface InterpretOwnerMessageRequest {
  idempotencyKey: string;
  text: string;
  /** Task the message replied to, resolved by the caller from its trusted correlation ledger. */
  contextTaskId: string | null;
  /** Explicit /goal: only task-creating intents are acceptable. */
  requireTask: boolean;
  priority?: "critical" | "high" | "normal" | "low";
  /** Transport statuses the owner already received for this message (context only; not part of the fingerprint). */
  transportContext?: import("../planning/types").TransportStatusContext[];
}

export interface InterpretationView {
  interpretationId: string;
  decision: IntentDecision;
  duplicate: boolean;
}

export interface PersistedInterpretation {
  interpretationId: string;
  fingerprint: string;
  principalId: string;
  originalRequest: string;
  priority: "critical" | "high" | "normal" | "low" | null;
  decision: IntentDecision;
  createdAt: IsoTimestamp;
}

export interface GatewayInterpretationRepository {
  get(interpretationId: string): PersistedInterpretation | null;
  create(record: PersistedInterpretation): PersistedInterpretation;
}

export interface TaskDirectoryEntry {
  taskId: string;
  title: string;
  status: string;
  mode: TaskMode;
  /** Trusted lineage: this task re-runs that earlier task's original goal. */
  retryOf?: string | null;
}

/**
 * Trusted original contract of a task, read from the Manager's own record (never from a caller).
 * A re-run is built ONLY from this: same goal, criteria, scope, validations and priority.
 */
export interface RetrySource {
  taskId: string;
  title: string;
  /** The exact intake instruction of the original task (objective + server policy + verbatim request). */
  objective: string;
  mode: TaskMode;
  goal: import("../domain/types").TaskGoal | null;
  /** The planner's semantic goal criteria (the fixed per-intent criteria are re-added by intake). */
  goalCriteria: string[];
  /** Planner risk observations of the original (they can only raise risk). */
  riskObservations: string[];
  /** Plain acceptance criteria of a task created without an interpreted goal. */
  acceptanceCriteria: string[];
  expectedScope: string[];
  requiredValidations: string[];
  requestedPriority: "critical" | "high" | "normal" | "low" | null;
  /** One part of a decomposed request (or a cross-part repair): never re-run alone. */
  decomposed: boolean;
  retryOf: string | null;
}

export interface RetrySourcePort {
  source(taskId: string): RetrySource | null;
  /** Task created by an intake idempotency key, if any (a redelivered re-run request is a duplicate). */
  createdBy(idempotencyKey: string): string | null;
  /** Every known task with its lineage and whether it is still active. */
  lineage(): readonly { taskId: string; retryOf: string | null; active: boolean }[];
  /** Scheduler's trusted Worker availability. */
  availability(): Partial<Record<WorkerKind, import("../executive/workAssignment").WorkerAvailabilityState>>;
}

export type RetryTaskResponse =
  | { result: "created"; taskId: string; retryOf: string; status: GatewayTaskStatus; duplicate: boolean }
  | { result: "refused"; taskId: string; assessment: import("./retry").RetryAssessment };

export type PendingApprovalResponse =
  | { result: "pending"; approval: PendingApprovalRequirement }
  | { result: "none" | "not_required"; taskId: string };

export interface ApprovalRequirementReader {
  /** Must re-read the authoritative Manager state on every call. */
  current(taskId: string): Promise<PendingApprovalRequirement | null>;
}

// ---------------------------------------------------------------------------
// Human decision (needs_human_decision resume)

/**
 * The only caller-controlled input of a human decision. Task, branch,
 * expected HEAD, lineage and escalation metadata are resolved from trusted
 * Manager state; decidedBy comes from the authenticated session.
 */
export interface SubmitHumanDecisionRequest {
  escalationId: string;
  idempotencyKey: string;
  guidance: string;
}

/** Trusted Manager-side view of one open escalation (never caller-supplied). */
export interface TrustedHumanDecisionRequirement {
  request: HumanDecisionRequest;
  /** Opaque requester id of the task; null when unknown (then only operators may decide). */
  requesterId: string | null;
  whyNeeded: string;
  currentBlocker: { failureCode: string; failingCheck: string; expected: string; actual: string };
  managerRecommendation: string;
  inputRequested: string;
  cyclesCompleted: number;
  fingerprintTrend: "stagnated" | "changed";
  /** Latest Manager root-cause diagnosis (structured Manager text, sanitized again on read). */
  rootCause?: string;
  /** What each Manager-guided repair cycle of this round attempted and how it ended. */
  repairAttempts?: readonly { cycle: number; attempted: string; outcome: string }[];
  /** A decomposed request's combined-repair decision (its lead task's own work is complete). */
  groupDecision?: boolean;
  /** GPT Manager question + options when it asked the owner to choose. */
  ownerDecision?: { question: string; options: readonly { id: string; summary: string }[]; recommended: string | null } | null;
}

export interface HumanDecisionOutcomeRecord {
  decisionId: string | null;
  escalationId: string | null;
  outcome: "accepted" | "rejected" | "duplicate";
  reason: string;
  at: IsoTimestamp;
}

export interface HumanDecisionRequirementReader {
  /** Must re-read the authoritative Manager state on every call. */
  current(taskId: string): TrustedHumanDecisionRequirement | null;
  outcomes(taskId: string): readonly HumanDecisionOutcomeRecord[];
}

/** Sanitized phone-UI view of an open escalation. */
export interface PendingHumanDecisionView {
  escalationId: string;
  taskId: string;
  round: number;
  cyclesCompleted: number;
  whyNeeded: string;
  currentBlocker: { failureCode: string; failingCheck: string; expected: string; actual: string };
  managerRecommendation: string;
  inputRequested: string;
  fingerprintTrend: "stagnated" | "changed";
  /** GPT Manager's question + options when it asked the owner to choose (owner language). */
  ownerDecision?: { question: string; options: { id: string; summary: string }[]; recommended: string | null } | null;
  rootCause: string;
  repairAttempts: { cycle: number; attempted: string; outcome: string }[];
  /** A decision is guidance only: it never approves commit, publish, merge, deploy, or red risk. */
  grantsApproval: false;
}

export interface HumanDecisionOutcomeView {
  decisionId: string | null;
  escalationId: string | null;
  outcome: "accepted" | "stale" | "duplicate" | "rejected";
  reason: string;
  at: IsoTimestamp;
}

export interface HumanDecisionStatusResponse {
  taskId: string;
  pending: PendingHumanDecisionView | null;
  lastOutcome: HumanDecisionOutcomeView | null;
}

export interface HumanDecisionSubmitResponse {
  taskId: string;
  escalationId: string;
  decisionId: string;
  /** Delivery result; the Manager's accept/stale/duplicate outcome is read via the status view. */
  result: "submitted";
  duplicate: boolean;
}

export interface PersistedHumanDecisionSubmission {
  idempotencyKey: string;
  fingerprint: string;
  principalId: string;
  taskId: string;
  escalationId: string;
  decisionId: string;
  eventEmitted: boolean;
  createdAt: IsoTimestamp;
}

export interface GatewayHumanDecisionRepository {
  get(idempotencyKey: string): PersistedHumanDecisionSubmission | null;
  create(record: PersistedHumanDecisionSubmission): PersistedHumanDecisionSubmission;
  markEventEmitted(idempotencyKey: string): PersistedHumanDecisionSubmission;
}

export interface GatewayControlEventPort {
  taskSubmitted(taskId: string): void;
  taskPauseRequested(taskId: string): void;
  taskCancelRequested(taskId: string): void;
  /** Notification only. The Manager must re-read ApprovalRepository. */
  reEvaluateApproval(
    taskId: string,
    phase: ApprovalPhase,
    decision: ApprovalDecisionValue,
  ): void;
  /** Emits the typed human_decision_submitted event; the Manager re-binds and may still reject it. */
  humanDecisionSubmitted(taskId: string, decision: HumanDecisionInput): void;
  /** Emits publish_revision_requested; the Manager re-binds to the exact publish gate and may still reject it. */
  publishRevisionRequested(taskId: string, decision: HumanDecisionInput): void;
}

export type GatewayRateAction =
  | "task_submit"
  | "task_read"
  | "task_pause"
  | "task_cancel"
  | "approval_read"
  | "approval_mutate"
  | "human_decision_read"
  | "human_decision_mutate"
  | "task_interpret";

export interface GatewayRateLimiter {
  consume(input: {
    principalId: string;
    action: GatewayRateAction;
    requestId: string;
  }): { allowed: boolean; retryAfterSeconds?: number };
}

export type ApprovalDecisionValue = "approved" | "rejected";
export interface PersistedGatewayDecision {
  idempotencyKey: string;
  fingerprint: string;
  approvalId: string;
  taskId: string;
  decision: ApprovalDecisionValue;
  eventEmitted: boolean;
  createdAt: IsoTimestamp;
}

export interface GatewayDecisionRepository {
  get(idempotencyKey: string): PersistedGatewayDecision | null;
  create(record: PersistedGatewayDecision): PersistedGatewayDecision;
  markEventEmitted(idempotencyKey: string): PersistedGatewayDecision;
}

export interface GatewayAuditEvent {
  event:
    | "gateway_request_received"
    | "gateway_auth_failed"
    | "gateway_forbidden"
    | "task_submit_requested"
    | "task_status_read"
    | "task_pause_requested"
    | "task_cancel_requested"
    | "approval_viewed"
    | "approval_granted"
    | "approval_rejected"
    | "approval_stale_rejected"
    | "human_decision_viewed"
    | "human_decision_submitted"
    | "human_decision_rejected"
    | "owner_question_answered"
    | "live_status_task_selected"
    | "live_status_response_produced"
    | "live_status_requested"
    | "live_status_snapshot_produced"
    | "gateway_rate_limited";
  principalId?: string;
  taskId?: string;
  requestId: string;
  action: string;
  outcome: string;
  reasonCode?: string;
  approvalKind?: ApprovalKind;
  approvalPhase?: ApprovalPhase;
  bindingReference?: string;
}

export interface GatewayAuditSink {
  record(event: GatewayAuditEvent): void;
}

export interface GatewayExpiryPolicy {
  maxRequestAgeMs: number;
  approvalLifetimeMs: number;
}

export interface ApprovalDecisionResponse {
  taskId: string;
  approvalId: string;
  decision: ApprovalDecisionValue;
  status: Approval["status"];
  duplicate: boolean;
}

export interface AgentGatewayService {
  submitTask(call: GatewayCall<unknown>): Promise<{ taskId: string; status: GatewayTaskStatus; duplicate: boolean }>;
  getTaskStatus(call: GatewayCall<unknown>): Promise<GatewayTaskStatus>;
  pauseTask(call: GatewayCall<unknown>): Promise<GatewayTaskStatus>;
  cancelTask(call: GatewayCall<unknown>): Promise<GatewayTaskStatus>;
  getPendingApproval(call: GatewayCall<unknown>): Promise<PendingApprovalResponse>;
  approveTask(call: GatewayCall<unknown>): Promise<ApprovalDecisionResponse>;
  rejectTask(call: GatewayCall<unknown>): Promise<ApprovalDecisionResponse>;
  getHumanDecision(call: GatewayCall<unknown>): Promise<HumanDecisionStatusResponse>;
  submitHumanDecision(call: GatewayCall<unknown>): Promise<HumanDecisionSubmitResponse>;
  /** Natural-language owner message -> validated internal intent (stored, idempotent). */
  interpretOwnerMessage(call: GatewayCall<unknown>): Promise<InterpretationView>;
  /** Creates the task described by a stored task interpretation through normal intake. */
  /** A mixed programming+visual request returns the programming task first and the visual part in relatedTaskIds. */
  submitInterpretedTask(call: GatewayCall<unknown>): Promise<{ taskId: string; status: GatewayTaskStatus; duplicate: boolean; relatedTaskIds?: string[]; parts?: { taskId: string; area: "programming" | "visual" }[] }>;
  /**
   * Answers a stored read-only interpretation directly (Manager conversation / read-only lookup).
   * Never creates a task, branch, Worker run, file change, commit or push.
   */
  answerOwnerQuestion(call: GatewayCall<unknown>): Promise<{ answer: string }>;
  /**
   * The Manager's proactive owner message for a task's terminal state, from trusted state only.
   * Throws "unavailable" when the Manager cannot compose it (the caller then uses its declared fallback).
   */
  composeOwnerNotice(call: GatewayCall<unknown>): Promise<{ text: string; basis: { taskId: string; status: string; retryKind: string | null } }>;
  /** Read-only: whether the task's original goal could be re-run now (deterministic policy, trusted state). */
  getRetryEligibility(call: GatewayCall<unknown>): Promise<import("./retry").RetryAssessment>;
  /**
   * Re-runs the task named by a stored retry_task interpretation: a NEW task through normal intake with
   * the original trusted goal and lineage (routing, risk, validation and approvals all apply again).
   * The stopped task itself never changes state. Refused (nothing created) unless the policy allows it.
   */
  retryTask(call: GatewayCall<unknown>): Promise<RetryTaskResponse>;
  /**
   * The Owner asks for changes to a result that awaits publish approval (e.g. after the preview). Bound
   * server-side to the current publish gate (task, branch, workspace HEAD); idempotent per key. The SAME
   * task is repaired; nothing is approved, committed, published, merged or deployed.
   */
  requestPublishRevision(call: GatewayCall<unknown>): Promise<{ taskId: string; result: "submitted"; duplicate: boolean }>;
}
