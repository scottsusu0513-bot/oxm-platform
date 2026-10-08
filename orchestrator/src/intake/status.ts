import type { TaskTechnicalDetails } from "./types";
import type { TaskSnapshot } from "../scheduler/types";
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
    ? snap?.approvalPhase ?? ((snap?.prNumber ?? task.prNumber) === null ? "pre_execution" : "post_qa")
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
    mode: snap?.mode ?? "change",
    answer: snap?.answer ?? null,
    ...(snap ? { details: technicalDetails(snap) } : {}),
    ...(snap
      ? {
          workforce: {
            workArea: snap.workArea,
            primaryWorker: snap.primaryWorker,
            temporaryCover: snap.temporaryCover,
            handoffs: snap.handoffs.length,
            availabilityPause: snap.availabilityPause
              ? { waitingFor: [...snap.availabilityPause.waitingFor], resetAt: snap.availabilityPause.resetAt, exhausted: snap.availabilityPause.exhausted, cause: snap.availabilityPause.cause ?? "quota" }
              : null,
            combinedReview: snap.combinedReview
              ? {
                  status: snap.combinedReview.status,
                  ownerSummary: snap.combinedReview.verdict?.ownerSummary ?? null,
                  lead: snap.combinedReview.leadTaskId === snap.taskId,
                  leadTaskId: snap.combinedReview.leadTaskId,
                  round: snap.combinedReview.round ?? 1,
                  cycle: snap.combinedReview.cycle ?? 0,
                  repairTargets: snap.combinedReview.cycles?.at(-1)?.plan.targets.map((t) => t.area) ?? [],
                }
              : null,
          },
        }
      : {}),
    approval: {
      required: approvalState || pending !== null,
      kind:
        pending?.kind ??
        (phase === "pre_execution"
          ? "start"
          : phase === "commit_publish"
            ? "commit_publish"
          : phase === "post_qa"
            ? "merge"
            : null),
      phase,
      bindingTarget:
        pending?.bindingShaOrActionId ??
        (phase === "post_qa"
          ? (snap?.headSha ?? null)
          : phase === "commit_publish"
            ? null
          : phase === "pre_execution"
            ? `start:${task.id}`
            : null),
      action:
        pending?.requestedAction ??
        (phase === "pre_execution"
          ? "start"
          : phase === "commit_publish"
            ? "commit_and_publish_task_branch_for_pr_review"
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

/** Structured technical facts of a task for an explicit owner request. No model reasoning, no bindings. */
function technicalDetails(snap: TaskSnapshot): TaskTechnicalDetails {
  const ev = snap.evidence;
  const textOf = (id: string) => ev?.criteria.find((c) => c.id === id)?.text ?? id;
  const lastPlan = snap.repairCycles.at(-1)?.diagnosis ?? null;
  return {
    worker: snap.worker,
    workArea: snap.workArea ?? null,
    temporaryCover: snap.temporaryCover === true,
    risk: snap.risk,
    approvalPhase: snap.approvalPhase,
    validations: ev?.validations ?? [],
    unmetCriteria: (ev?.acceptance ?? [])
      .filter((a) => a.status !== "satisfied" && !a.criterionId.startsWith("OC-"))
      .map((a) => ({ id: a.criterionId, text: textOf(a.criterionId), status: a.status, summary: a.summary ?? null })),
    ownerConstraints: (ev?.ownerConstraints ?? []).map((c) => ({ id: c.checkId, kind: c.kind, status: c.status, evidence: c.evidence })),
    managerRootCause: lastPlan ? (lastPlan.managerPlan?.rootCause ?? lastPlan.rootCause) : null,
    repairAttempts: snap.repairCycles.map((c) => ({
      round: c.round,
      cycle: c.cycle,
      strategy: c.diagnosis.managerPlan?.repairStrategy ?? null,
      outcome: c.revalidation ? c.revalidation.decision : c.workerResult ? `worker ${c.workerResult.status}` : "running",
    })),
    changedPaths: ev?.changedPaths ?? [],
    citedFiles: ev?.citedFiles ?? [],
  };
}
