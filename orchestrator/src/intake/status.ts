import type {
  ApprovalRepository,
  AuditRepository,
  TaskRunRepository,
} from "../store/repositories";
import type { Task } from "../store/types";
import type {
  AgentTaskStatus,
  PersistedIntakeRecord,
  RuntimeSchedulerPort,
} from "./types";

export function buildTaskStatus(input: {
  task: Task;
  intake: PersistedIntakeRecord;
  scheduler: RuntimeSchedulerPort;
  runs: TaskRunRepository;
  approvals: ApprovalRepository;
  audit: AuditRepository;
}): AgentTaskStatus {
  const { task, intake } = input;
  const snap = input.scheduler.snapshot(task.id);
  const runs = input.runs
    .listByTask(task.id)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latestRun = runs.at(-1) ?? null;
  const pending =
    input.approvals
      .listByTask(task.id)
      .filter(a => a.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const lastAudit =
    input.audit
      .list({ taskId: task.id })
      .filter(e => e.event !== "task_status_read")
      .at(-1) ?? null;
  const approvalState =
    snap?.status === "needs_human_approval" ||
    task.state === "awaiting_approval";
  const phase = approvalState
    ? (snap?.prNumber ?? task.prNumber) === null
      ? "pre_execution"
      : "post_qa"
    : null;
  const orchestrationStatus =
    intake.controlState === "paused"
      ? "paused"
      : intake.controlState === "cancel_requested"
        ? task.state === "cancelled"
          ? "cancelled"
          : "cancel_requested"
        : (snap?.status ?? "intake_queued");
  return {
    taskId: task.id,
    title: task.title ?? intake.title,
    orchestrationStatus,
    taskState: snap?.state ?? task.state,
    priority: task.priority ?? intake.priority,
    risk: task.riskLevel ?? "red",
    assignedWorker: snap?.worker ?? task.routedWorker,
    branch: snap?.branch ?? task.branch,
    headSha: snap?.headSha ?? latestRun?.headSha ?? null,
    prNumber: snap?.prNumber ?? task.prNumber,
    prState: (snap?.prNumber ?? task.prNumber) === null ? null : "open",
    qaState: snap?.qaStatus ?? null,
    repairAttempt: snap?.repair.attempt ?? task.retries,
    waitReason: snap?.blockingReason ?? snap?.queueReason ?? null,
    approval: {
      required: approvalState || pending !== null,
      kind:
        pending?.kind ??
        (phase === "pre_execution"
          ? "start"
          : phase === "post_qa"
            ? "merge"
            : null),
      phase,
      bindingTarget:
        pending?.bindingShaOrActionId ??
        (phase === "post_qa"
          ? (snap?.headSha ?? null)
          : phase === "pre_execution"
            ? `start:${task.id}`
            : null),
      action:
        pending?.requestedAction ??
        (phase === "pre_execution"
          ? "start"
          : phase === "post_qa"
            ? "complete_post_qa"
            : null),
    },
    lastMeaningfulAuditEvent: lastAudit
      ? {
          event: lastAudit.event,
          createdAt: lastAudit.createdAt,
          fromState: lastAudit.fromState,
          toState: lastAudit.toState,
        }
      : null,
    createdAt: task.createdAt,
    updatedAt:
      task.updatedAt > intake.updatedAt ? task.updatedAt : intake.updatedAt,
  };
}
