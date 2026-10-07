/**
 * Phase 2C.2 Store — persistence record types for the orchestrator.
 *
 * These records are orchestrator-only and must never live in the production
 * marketplace database. Like domain/, this module is pure type/constant
 * definitions: no DB, no HTTP, no filesystem, no env, no worker execution.
 *
 * Privacy: records never hold secrets, tokens, OAuth codes, passwords or full
 * worker prompts. TaskRun keeps only a promptHash; AuditEvent.metadata is
 * sanitized (see sanitize.ts) before it is persisted.
 *
 * Timestamps are ISO-8601 strings supplied by an injected clock so the store
 * itself stays deterministic.
 */
import type { RiskLevel, TaskCategory, TaskState, WorkerKind } from "../domain/types";

export type IsoTimestamp = string;

export interface Task {
  id: string;
  /** Where the request came from (e.g. "chat", "phone", "manual"). */
  source: string;
  /** Opaque requester identifier — not an email or other PII. */
  requesterId: string;
  rawText: string;
  /** Sanitized display title and durable intake identity. */
  title: string | null;
  requestId: string | null;
  normalizedSummary: string | null;
  category: TaskCategory | null;
  riskLevel: RiskLevel | null;
  riskReasons: string[];
  routedWorker: WorkerKind | null;
  fallbackUsed: boolean;
  priority: "critical" | "high" | "normal" | "low" | null;
  acceptanceCriteria: { id: string; text: string }[];
  requiredValidations: ("tests" | "typecheck" | "smoke")[];
  expectedScope: string[];
  expectedScopeState: "provided" | "derived" | "unresolved";
  classificationPath: "deterministic" | "llm_fallback" | null;
  llmClassifierCalls: number;
  activatedIntakeCapabilities: string[];
  state: TaskState;
  branch: string | null;
  prNumber: number | null;
  retries: number;
  deadlineAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Fields fixed at creation; tasks always start in "received". */
export type NewTask = Pick<Task, "id" | "source" | "requesterId" | "rawText"> &
  Partial<
    Pick<
      Task,
      | "deadlineAt"
      | "title"
      | "requestId"
      | "priority"
      | "acceptanceCriteria"
      | "requiredValidations"
      | "expectedScope"
      | "expectedScopeState"
      | "classificationPath"
      | "llmClassifierCalls"
      | "activatedIntakeCapabilities"
    >
  >;

/**
 * Mutable task fields. `state` is deliberately excluded: state changes go
 * through TaskRepository.transition(), which validates via domain/taskState.
 */
export type TaskPatch = Partial<
  Pick<
    Task,
    | "normalizedSummary"
    | "category"
    | "riskLevel"
    | "riskReasons"
    | "routedWorker"
    | "fallbackUsed"
    | "branch"
    | "prNumber"
    | "retries"
    | "deadlineAt"
  >
>;

export const RUN_EXIT_STATUSES = ["success", "failure", "timeout", "cancelled"] as const;
export type RunExitStatus = (typeof RUN_EXIT_STATUSES)[number];

export interface TaskRun {
  id: string;
  taskId: string;
  worker: WorkerKind;
  model: string;
  codespaceName: string | null;
  /** Lowercase hex SHA-256 of the worker prompt. The prompt itself is never stored. */
  promptHash: string;
  startedAt: IsoTimestamp;
  endedAt: IsoTimestamp | null;
  exitStatus: RunExitStatus | null;
  headSha: string | null;
  summary: string | null;
}

export type NewTaskRun = Pick<TaskRun, "id" | "taskId" | "worker" | "model" | "promptHash"> &
  Partial<Pick<TaskRun, "codespaceName">>;

export type TaskRunPatch = Partial<Pick<TaskRun, "endedAt" | "exitStatus" | "headSha" | "summary">>;

export const APPROVAL_KINDS = ["start", "commit_publish", "merge", "execute_red_action"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface Approval {
  id: string;
  taskId: string;
  kind: ApprovalKind;
  requestedAction: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: IsoTimestamp | null;
  /** Channel the decision arrived through (e.g. "phone", "chat"). */
  channel: string | null;
  expiresAt: IsoTimestamp;
  /** Exact protected-state identity (commit/publish), commit SHA (merge), or action id. Immutable. */
  bindingShaOrActionId: string;
  createdAt: IsoTimestamp;
}

export type NewApproval = Pick<
  Approval,
  "id" | "taskId" | "kind" | "requestedAction" | "expiresAt" | "bindingShaOrActionId"
>;

export interface ApprovalDecision {
  status: "approved" | "rejected";
  decidedBy: string;
  channel: string;
}

export const AUDIT_ACTORS = ["manager", "worker", "human", "system"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AuditEvent {
  id: string;
  taskId: string;
  actor: AuditActor;
  event: string;
  fromState: TaskState | null;
  toState: TaskState | null;
  /** Always sanitized before persistence. */
  metadata: { [key: string]: JsonValue };
  createdAt: IsoTimestamp;
}

export type NewAuditEvent = Pick<AuditEvent, "id" | "taskId" | "actor" | "event"> &
  Partial<Pick<AuditEvent, "fromState" | "toState">> & { metadata?: unknown };
