import type { ApprovalPhase, CompletionBasis, TransitionResult } from "../domain/taskState";
import type { TaskState } from "../domain/types";
import type {
  Approval,
  ApprovalDecision,
  ApprovalKind,
  AuditEvent,
  IsoTimestamp,
  NewApproval,
  NewAuditEvent,
  NewTask,
  NewTaskRun,
  Task,
  TaskPatch,
  TaskRun,
  TaskRunPatch,
} from "./types";

/**
 * Repository contracts for orchestrator persistence. Implementations must
 * return copies (never internal references) and must not hold secrets or
 * full prompts. Any backing store must be separate from the marketplace DB.
 */

export interface TaskTransitionContext {
  /** Required when leaving awaiting_approval (other than to failed/cancelled). */
  approvalPhase?: ApprovalPhase;
  approved?: boolean;
  /** Required for every change-task edge into "complete" (see domain/taskState). */
  completion?: CompletionBasis;
  declined?: boolean;
}

export interface TaskRepository {
  create(input: NewTask): Task;
  get(id: string): Task | null;
  /** Updates non-state fields. Throws if the patch contains `state` or immutable fields. */
  update(id: string, patch: TaskPatch): Task;
  /**
   * Applies a state change validated by domain/taskState.validateTransition.
   * riskLevel is taken from the stored task, never from the caller.
   */
  transition(id: string, to: TaskState, ctx?: TaskTransitionContext): Task;
}

export interface TaskRunRepository {
  create(input: NewTaskRun): TaskRun;
  get(id: string): TaskRun | null;
  update(id: string, patch: TaskRunPatch): TaskRun;
  listByTask(taskId: string): TaskRun[];
}

export interface ApprovalRepository {
  /** Creates a pending approval bound to bindingShaOrActionId. */
  create(input: NewApproval): Approval;
  get(id: string): Approval | null;
  /** Only pending, unexpired approvals can be decided. Binding is immutable. */
  decide(id: string, decision: ApprovalDecision): Approval;
  /** Marks a pending approval expired. */
  expire(id: string): Approval;
  listByTask(taskId: string): Approval[];
}

/** Append-only: there is intentionally no update or delete operation. */
export interface AuditRepository {
  append(input: NewAuditEvent): AuditEvent;
  list(filter?: { taskId?: string }): AuditEvent[];
}

export interface ApprovalRequest {
  taskId: string;
  kind: ApprovalKind;
  bindingShaOrActionId: string;
  at: IsoTimestamp;
}

/**
 * True only if `approval` authorizes exactly this task/kind/SHA-or-action at
 * time `at`. An approval for one SHA/action can never authorize another.
 */
export function approvalAuthorizes(approval: Approval, req: ApprovalRequest): TransitionResult {
  if (approval.status !== "approved") return { ok: false, reason: `approval is ${approval.status}` };
  if (approval.taskId !== req.taskId) return { ok: false, reason: "approval belongs to another task" };
  if (approval.kind !== req.kind) return { ok: false, reason: `approval kind is ${approval.kind}` };
  if (approval.bindingShaOrActionId !== req.bindingShaOrActionId) {
    return { ok: false, reason: "approval is bound to a different SHA/action" };
  }
  const at = Date.parse(req.at);
  if (Number.isNaN(at)) return { ok: false, reason: "request timestamp is invalid" };
  if (at >= Date.parse(approval.expiresAt)) {
    return { ok: false, reason: "approval has expired" };
  }
  return { ok: true };
}
