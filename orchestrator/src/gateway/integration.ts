import { fingerprintRequest } from "../intake/normalize";
import type { ManagerLoop } from "../scheduler/loop";
import type {
  ApprovalRequirementReader,
  GatewayControlEventPort,
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
      };
    },
  };
}
