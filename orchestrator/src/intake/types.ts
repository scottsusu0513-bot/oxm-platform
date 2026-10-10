import type {
  RiskLevel,
  TaskCategory,
  TaskAction,
  TaskCreatingIntent,
  TaskGoal,
  TaskMode,
  TaskState,
  WorkerAvailability,
  WorkerKind,
} from "../domain/types";
import type {
  ApprovalKind,
  AuditEvent,
  IsoTimestamp,
  Task,
} from "../store/types";
import type {
  OrchestrationStatus,
  PriorityClass,
  PrioritySignal,
  TaskIntake,
  TaskSnapshot,
} from "../scheduler/types";
import type { RequiredValidation } from "../workers/types";

export const INTAKE_LIMITS = Object.freeze({
  instruction: 8_000,
  title: 160,
  idempotencyKey: 128,
  criteria: 20,
  criterion: 500,
  scopePaths: 30,
  sourceType: 40,
  sourceReference: 160,
});

export interface TaskSourceMetadata {
  type: string;
  /** Opaque, non-PII caller identity. */
  requesterId: string;
  reference?: string;
}

export interface TaskIntakeRequest {
  requestId?: string;
  idempotencyKey?: string;
  userInstruction: string;
  title?: string;
  priority?: PriorityClass;
  expectedScopeHint?: readonly string[];
  productAreaHint?: string;
  categoryHint?: TaskCategory;
  riskHint?: RiskLevel;
  workerPreference?: WorkerKind;
  acceptanceCriteria?: readonly string[];
  requiredValidations?: readonly RequiredValidation[];
  source: TaskSourceMetadata;
  submittedAt: IsoTimestamp;
  /** Structured signals supplied by a trusted transport, not inferred by an LLM. */
  prioritySignals?: readonly PrioritySignal[];
  /**
   * Goal interpreted by the trusted planning layer. Only the Gateway builds
   * this (from a stored interpretation); no external caller can supply it.
   */
  goal?: IntakeGoal;
  /**
   * Lineage of a re-run: the earlier task whose original goal this task runs again. Only the
   * Gateway's retryTask sets it (from trusted state); it grants nothing and changes no policy.
   */
  retryOf?: string;
}

/** Interpreted goal: intent (which fixes the mode) and semantic goal criteria. */
export interface IntakeGoal {
  intent: TaskCreatingIntent;
  originalRequest: string;
  interpretedObjective: string;
  /** Semantic goal criteria derived by the planner (observable outcomes). */
  criteria: readonly string[];
  /** Planner risk observations (typed signal kinds). They can only raise risk, never lower it. */
  riskObservations?: readonly string[];
  /** Work area of this (possibly decomposed) task; fixes the Worker via the assignment policy. */
  workArea?: "programming" | "visual";
  /** Decomposed request this part belongs to (combined review before the whole is accepted). */
  group?: { id: string; parts: readonly { area: "programming" | "visual"; objective: string }[] };
  /** Explicit PR-only goal (no deployment); absent = production delivery. */
  deliveryTarget?: "pull_request";
}

export type ClassificationPath = "deterministic" | "llm_fallback";
export type IntakeCapability =
  | "validation"
  | "normalization"
  | "deterministic_classifier"
  | "llm_classifier"
  | "risk_policy"
  | "priority_policy"
  | "routing_policy"
  | "scope_policy"
  | "task_store"
  | "scheduler_enqueue";

export interface IntakeClassification {
  category: TaskCategory;
  actions: TaskAction[];
  prioritySignals: PrioritySignal[];
  path: ClassificationPath;
  llmClassifierCalls: number;
  clarificationReasons: string[];
  clarificationRequired: boolean;
  executable: boolean;
}

export interface LlmClassifierOutput {
  category: TaskCategory;
  clarificationReasons: string[];
}

export interface MinimalLlmClassifier {
  classify(input: {
    instruction: string;
    title: string | null;
  }): Promise<LlmClassifierOutput>;
}

export interface PersistedIntakeRecord {
  idempotencyKey: string;
  requestFingerprint: string;
  taskId: string;
  requestId: string;
  title: string;
  objective: string;
  priority: PriorityClass;
  preferredWorker: WorkerKind | null;
  fallbackEligible: boolean;
  acceptanceCriteria: { id: string; text: string }[];
  requiredValidations: RequiredValidation[];
  expectedScope: string[];
  expectedScopeState: "provided" | "derived" | "unresolved";
  classificationPath: ClassificationPath;
  llmClassifierCalls: number;
  activatedIntakeCapabilities: IntakeCapability[];
  controlState: "active" | "paused" | "cancel_requested";
  enqueued: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface IntakeRecordRepository {
  getByKey(key: string): PersistedIntakeRecord | null;
  getByTask(taskId: string): PersistedIntakeRecord | null;
  create(record: PersistedIntakeRecord): PersistedIntakeRecord;
  update(
    taskId: string,
    patch: Partial<
      Pick<PersistedIntakeRecord, "controlState" | "enqueued" | "updatedAt">
    >
  ): PersistedIntakeRecord;
}

export interface RuntimeSchedulerPort {
  /** Enqueue only. Implementations may post one task_created event, but never run an unbounded loop here. */
  enqueue(task: TaskIntake): void;
  snapshot(taskId: string): TaskSnapshot | null;
  pause(taskId: string): { ok: boolean; reason?: string };
  cancel(taskId: string): {
    ok: boolean;
    cancellationRequested: boolean;
    reason?: string;
  };
}

export type IntakeResult =
  | { outcome: "accepted"; taskId: string; status: AgentTaskStatus }
  | { outcome: "duplicate"; taskId: string; status: AgentTaskStatus }
  | { outcome: "needs_clarification"; reasons: string[]; requestId: string }
  | {
      outcome: "rejected";
      reasonCode: string;
      reason: string;
      requestId: string;
    };

export interface ApprovalNeededStatus {
  required: boolean;
  kind: ApprovalKind | null;
  phase: "pre_execution" | "commit_publish" | "post_qa" | "deploy" | null;
  bindingTarget: string | null;
  action: string | null;
}

/** Technical view the owner can ask for ("給我技術細節"); structured facts only, never model reasoning. */
export interface TaskTechnicalDetails {
  worker: WorkerKind | null;
  workArea: "programming" | "visual" | null;
  temporaryCover: boolean;
  risk: RiskLevel;
  approvalPhase: string | null;
  validations: { name: string; status: string }[];
  unmetCriteria: { id: string; text: string; status: string; summary: string | null }[];
  ownerConstraints: { id: string; kind: string; status: string; evidence: string }[];
  managerRootCause: string | null;
  repairAttempts: { round: number; cycle: number; strategy: string | null; outcome: string }[];
  changedPaths: string[];
  citedFiles: string[];
  /** Classified Git metadata delta (component ids, classes, key names; never values). Absent: nothing changed. */
  gitMetadata?: TaskGitMetadataFacts | null;
}

export interface TaskGitMetadataFacts {
  publicationTrust: string;
  workerViolation: boolean;
  changes: { component: string; what: string; classification: string; keys: string[]; entries: string[] }[];
}

/** Owner-facing Worker assignment state: area, primary, temporary cover, availability pause. */
export interface TaskWorkforceStatus {
  workArea: "programming" | "visual";
  primaryWorker: WorkerKind;
  temporaryCover: boolean;
  handoffs: number;
  /** Set while paused for Worker availability; resetAt only when the provider exposed a trusted time. */
  availabilityPause: { waitingFor: WorkerKind[]; resetAt: string | null; exhausted: WorkerKind; cause: "quota" | "authentication" | "executable" | "service" } | null;
  /** Combined review of the decomposed request (null for standalone tasks). */
  combinedReview: { status: string; ownerSummary: string | null; lead: boolean; leadTaskId: string; round: number; cycle: number; repairTargets: ("programming" | "visual")[] } | null;
}

export interface AgentTaskStatus {
  taskId: string;
  title: string;
  orchestrationStatus:
    | OrchestrationStatus
    | "intake_queued"
    | "paused"
    | "cancel_requested"
    | "cancelled";
  taskState: TaskState;
  priority: PriorityClass;
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
  /** Manager-accepted answer of a read_only task. */
  answer: string | null;
  /** Change work: the Manager's result summary for the owner. */
  resultSummary?: string | null;
  /** Executive view of the Worker assignment (presentation only). */
  workforce?: TaskWorkforceStatus;
  /** Structured technical facts for an explicit owner request (presentation only). */
  details?: TaskTechnicalDetails;
  approval: ApprovalNeededStatus;
  /** Owner-facing lifecycle phase ("completed" only after a verified terminal success). */
  lifecyclePhase?: import("../domain/delivery").LifecyclePhase;
  deliveryTarget?: import("../domain/types").DeliveryTarget;
  /** Production delivery facts after CI (null before the deploy gate). */
  delivery?: import("../scheduler/types").TaskDeliveryView | null;
  /** Live preview of a UI task (null when none was offered). */
  preview?: import("../scheduler/types").TaskPreviewView | null;
  /** Live execution facts for the read-only status observatory (presentation only). */
  execution?: import("../scheduler/types").TaskExecutionView;
  lastMeaningfulAuditEvent: Pick<
    AuditEvent,
    "event" | "createdAt" | "fromState" | "toState"
  > | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AgentRuntimeService {
  submitTask(request: TaskIntakeRequest): Promise<IntakeResult>;
  getTaskStatus(taskId: string): AgentTaskStatus | null;
  pauseTask(taskId: string): AgentTaskStatus | null;
  cancelTask(taskId: string): AgentTaskStatus | null;
}

export interface IntakeDependencies {
  tasks: import("../store/repositories").TaskRepository;
  runs: import("../store/repositories").TaskRunRepository;
  approvals: import("../store/repositories").ApprovalRepository;
  audit: import("../store/repositories").AuditRepository;
  intakeRecords: IntakeRecordRepository;
  scheduler: RuntimeSchedulerPort;
  workerAvailability: () => WorkerAvailability;
  nextTaskId: () => string;
  nextAuditId: () => string;
  now: () => IsoTimestamp;
  llmClassifier?: MinimalLlmClassifier;
}

export interface PreparedIntake {
  requestId: string;
  idempotencyKey: string;
  fingerprint: string;
  instruction: string;
  title: string;
  source: TaskSourceMetadata;
  submittedAt: IsoTimestamp;
  categoryHint?: TaskCategory;
  riskHint?: RiskLevel;
  workerPreference?: WorkerKind;
  requestedPriority?: PriorityClass;
  prioritySignals: PrioritySignal[];
  acceptanceCriteria: { id: string; text: string; kind?: "goal" | "technical" }[];
  requiredValidations: RequiredValidation[];
  expectedScopeHint: string[];
  productAreaHint?: string;
  mode: TaskMode;
  goal?: TaskGoal;
  /** Validated planner risk observations (typed signal kinds; can only raise risk). */
  riskObservations?: string[];
  /** Re-run lineage (see TaskIntakeRequest.retryOf). */
  retryOf?: string;
}

export type ValidationResult =
  | { ok: true; value: PreparedIntake }
  | { ok: false; reasonCode: string; reason: string; requestId: string };

export type StoredTask = Task;
