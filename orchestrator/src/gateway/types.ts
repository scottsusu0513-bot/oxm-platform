import type { ApprovalPhase } from "../domain/taskState";
import type { RiskLevel, TaskState, WorkerKind } from "../domain/types";
import type { AgentTaskStatus } from "../intake/types";
import type { Approval, ApprovalKind, IsoTimestamp } from "../store/types";

export const GATEWAY_CAPABILITIES = [
  "task:submit",
  "task:read",
  "task:pause",
  "task:cancel",
  "approval:read",
  "approval:grant",
  "approval:reject",
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
  approvalRequired: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

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
}

export type PendingApprovalResponse =
  | { result: "pending"; approval: PendingApprovalRequirement }
  | { result: "none" | "not_required"; taskId: string };

export interface ApprovalRequirementReader {
  /** Must re-read the authoritative Manager state on every call. */
  current(taskId: string): Promise<PendingApprovalRequirement | null>;
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
}

export type GatewayRateAction =
  | "task_submit"
  | "task_read"
  | "task_pause"
  | "task_cancel"
  | "approval_read"
  | "approval_mutate";

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
}
