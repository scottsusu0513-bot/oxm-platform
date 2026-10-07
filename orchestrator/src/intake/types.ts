import type {
  RiskLevel,
  TaskCategory,
  TaskAction,
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
  phase: "pre_execution" | "commit_publish" | "post_qa" | null;
  bindingTarget: string | null;
  action: string | null;
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
  approval: ApprovalNeededStatus;
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
  acceptanceCriteria: { id: string; text: string }[];
  requiredValidations: RequiredValidation[];
  expectedScopeHint: string[];
  productAreaHint?: string;
}

export type ValidationResult =
  | { ok: true; value: PreparedIntake }
  | { ok: false; reasonCode: string; reason: string; requestId: string };

export type StoredTask = Task;
