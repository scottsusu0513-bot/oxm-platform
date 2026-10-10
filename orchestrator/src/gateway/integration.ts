import { isTerminalState } from "../domain/taskState";
import { FIXED_GOAL_CRITERIA, fingerprintRequest } from "../intake/normalize";
import type { ManagerLoop } from "../scheduler/loop";
import type {
  ApprovalRequirementReader,
  GatewayControlEventPort,
  HumanDecisionRequirementReader,
  RetrySourcePort,
} from "./types";

/**
 * Narrow Manager adapter. Pause/cancel/submit are already posted by
 * AgentRuntimeService; this adapter deliberately does not duplicate them.
 */
export function createManagerLoopGatewayEvents(
  loop: Pick<ManagerLoop, "post">,
): GatewayControlEventPort {
  return {
    taskSubmitted() {},
    taskPauseRequested() {},
    taskCancelRequested() {},
    reEvaluateApproval(taskId, phase, decision) {
      loop.post({
        type: decision === "approved" ? "approval_granted" : "approval_rejected",
        taskId,
        phase,
      });
    },
    humanDecisionSubmitted(taskId, decision) {
      loop.post({ type: "human_decision_submitted", taskId, decision });
    },
  };
}

/**
 * Trusted server-side resolution of an open needs_human_decision escalation
 * from the Manager's current state. requesterOf reads the stored task owner.
 */
export function createManagerHumanDecisionReader(
  loop: Pick<ManagerLoop, "task">,
  requesterOf: (taskId: string) => string | null,
): HumanDecisionRequirementReader {
  return {
    current(taskId) {
      const snap = loop.task(taskId);
      const report = snap?.humanEscalation;
      const waitingForGuidanceManager =
        snap?.status === "waiting_infrastructure" &&
        snap.queueReason?.startsWith("GPT Manager guidance interpretation unavailable") === true;
      if (!snap || (snap.status !== "needs_human_decision" && !waitingForGuidanceManager) || !snap.humanDecisionRequest || !report) return null;
      return {
        request: structuredClone(snap.humanDecisionRequest),
        requesterId: requesterOf(taskId),
        whyNeeded: snap.blockingReason ?? "Manager-guided repair cycles did not resolve the failure",
        currentBlocker: {
          failureCode: report.currentBlocker.failureCode,
          failingCheck: report.currentBlocker.failingCheck,
          expected: report.currentBlocker.expected,
          actual: report.currentBlocker.actual,
        },
        managerRecommendation: report.managerRecommendation,
        inputRequested: report.humanDecisionRequired,
        cyclesCompleted: report.cyclesCompleted,
        fingerprintTrend: report.fingerprintTrend,
        rootCause: report.diagnoses.at(-1)?.managerPlan?.rootCause ?? report.diagnoses.at(-1)?.rootCause ?? "",
        ownerDecision: report.ownerDecision ?? null,
        groupDecision: report.groupDecision === true,
        repairAttempts: report.repairOutcomes.map((o) => {
          const diagnosis = report.diagnoses.find((d) => d.cycle === o.cycle);
          return {
            cycle: o.cycle,
            attempted: diagnosis?.requiredFix ?? "Manager-guided repair",
            outcome: `worker ${o.workerResult}; revalidation ${o.revalidation}`,
          };
        }),
      };
    },
    outcomes(taskId) {
      return structuredClone(loop.task(taskId)?.humanDecisionLog ?? []);
    },
  };
}

/** Exposes the Manager's exact current action/SHA binding without side effects. */
export function createManagerApprovalRequirementReader(
  loop: Pick<ManagerLoop, "pendingApproval">,
  requestLifetimeMs = 24 * 60 * 60 * 1000,
): ApprovalRequirementReader {
  return {
    async current(taskId) {
      const check = await loop.pendingApproval(taskId);
      if (!check) return null;
      const approvalRequestId = `approval-${fingerprintRequest({
        taskId: check.taskId,
        phase: check.phase,
        kind: check.kind,
        action: check.requestedAction,
        binding: check.bindingShaOrActionId,
        requestedAt: check.requestedAt,
      })}`;
      return {
        approvalRequestId,
        taskId: check.taskId,
        kind: check.kind,
        phase: check.phase,
        risk: check.risk,
        action: check.requestedAction,
        bindingTarget: check.bindingShaOrActionId,
        requestedAt: check.requestedAt,
        expiresAt: new Date(
          Date.parse(check.requestedAt) + requestLifetimeMs,
        ).toISOString(),
        status: "pending",
        reasonSummary: `${check.phase} approval required for ${check.requestedAction}`,
        ...(check.evidence ? { commitEvidence: structuredClone(check.evidence) } : {}),
        ...(check.startEvidence ? { startEvidence: structuredClone(check.startEvidence) } : {}),
      };
    },
  };
}

/**
 * Trusted re-run source: the Manager's own record of each task's original intake (goal,
 * criteria, scope, validations), the re-run lineage and the scheduler's Worker availability.
 * `createdBy` resolves an intake idempotency key to the task it created (intake records).
 */
export function createManagerRetrySourcePort(loop: Pick<ManagerLoop, "intakeOf" | "tasks" | "workerAvailability">, createdBy: (idempotencyKey: string) => string | null): RetrySourcePort {
  return {
    source(taskId) {
      const intake = loop.intakeOf(taskId);
      if (!intake) return null;
      const goal = intake.goal ?? null;
      const fixed = new Set(goal ? FIXED_GOAL_CRITERIA[goal.intent] : []);
      const goalCriteria = intake.acceptanceCriteria.filter((c) => c.kind === "goal" && !fixed.has(c.text)).map((c) => c.text);
      return {
        taskId,
        title: intake.title,
        objective: intake.objective,
        mode: intake.mode === "read_only" ? "read_only" : "change",
        goal: goal ? structuredClone(goal) : null,
        // A goal whose planner criteria all coincided with the fixed ones keeps the first fixed one (never empty).
        goalCriteria: goalCriteria.length ? goalCriteria : goal ? FIXED_GOAL_CRITERIA[goal.intent].slice(0, 1) : [],
        riskObservations: (intake.riskSignals ?? []).filter((r) => r.source === "planner_observation").map((r) => r.kind),
        acceptanceCriteria: intake.acceptanceCriteria.map((c) => c.text),
        expectedScope: [...intake.expectedPaths],
        requiredValidations: [...intake.requiredValidations],
        requestedPriority: intake.requestedPriority ?? null,
        decomposed: Boolean(goal?.group || intake.groupRepairOf),
        retryOf: intake.retryOf ?? null,
      };
    },
    createdBy,
    lineage: () => loop.tasks().map((t) => ({ taskId: t.taskId, retryOf: t.retryOf, active: !isTerminalState(t.state) })),
    availability: () => loop.workerAvailability(),
  };
}
