import { validateTransition, type ApprovalPhase } from "../domain/taskState";
import type { TaskState, WorkerKind } from "../domain/types";
import type { NewAuditEvent, NewTaskRun, TaskPatch } from "../store/types";
import { managerAudit, type ManagerAuditMetadataInput } from "./intent";
import { buildRepairRequest, type Intent } from "./repair";
import type { ManagerDiagnosis, ManagerEvidence, ManagerValidation, RepairPlanningContext, RepairRequest } from "./types";
import { REPAIRABLE_STATES, validateEvidence } from "./validator";

/**
 * Pure thin-Manager flow:
 *   task ready -> evidence collected -> validate ->
 *     accepted             -> next-step intent for the existing PR/QA/approval lifecycle
 *     needs_repair         -> Manager root-cause diagnosis + RepairRequest;
 *                             same worker, same task branch
 *     needs_human_decision -> two Manager-guided cycles failed: escalate to a
 *                             human (no further repair, no commit/push/PR)
 *     blocked              -> stop / replan intent (no automatic retry)
 *     needs_human_approval -> approval intent
 *
 * Nothing is executed or written: transitions are pre-checked with
 * domain/taskState and applied by the caller through TaskRepository; audit
 * events are appended by the caller. The Manager never merges: QA acceptance
 * ("complete_task") hands a production goal to the Owner's deploy gate; the
 * merge is executed only by the trusted delivery layer after that approval.
 */

export const MANAGER_NEXT_STEPS = [
  "open_pr",
  "advance_qa",
  "complete_task",
  "request_post_qa_approval",
  "await_human_approval",
  "dispatch_repair",
  "escalate_human_decision",
  "replan_branch",
  "stop",
] as const;
export type ManagerNextStep = (typeof MANAGER_NEXT_STEPS)[number];

export interface ManagerStep {
  validation: ManagerValidation;
  next: ManagerNextStep;
  transition: TaskState | null;
  repairRequest: RepairRequest | null;
  taskPatch: TaskPatch | null;
  audit: Omit<NewAuditEvent, "id">[];
}

export function managerStep(input: {
  evidence: ManagerEvidence;
  approvalPhase?: ApprovalPhase;
  /** Previous cycle's diagnosis and the outcome of the repair that followed it (cycle >= 2). */
  previousDiagnosis?: { diagnosis: ManagerDiagnosis; repairOutcome: string } | null;
  /** Repair round (1 unless resumed by a human decision; that resume itself uses humanDecisionResumeStep). */
  round?: number;
  /** GOAL context for repair planning (mode, durable owner guidance, evidence plan). */
  planning?: RepairPlanningContext | null;
}): Intent<ManagerStep> {
  const v = validateEvidence(input.evidence);
  const e = input.evidence;
  const from = e.taskState;
  const meta: ManagerAuditMetadataInput = {
    taskId: v.taskId,
    branch: e.branch?.assignedBranch ?? null,
    headSha: e.branch?.verifiedHeadSha ?? null,
    decision: v.decision,
    failedEvidenceIds: v.failedEvidenceIds,
    attempt: e.repair?.attempt ?? 0,
    riskLevel: v.riskLevel,
    reasonCodes: v.reasonCodes,
    triggers: v.triggers,
    intents: v.intents,
  };
  const audit: Omit<NewAuditEvent, "id">[] = [managerAudit("manager_validation_started", from, null, { ...meta, decision: null })];
  if (v.triggers.length > 0) audit.push(managerAudit("escalation_triggered", from, null, meta));

  let next: ManagerNextStep;
  let transition: TaskState | null = null;
  let repairRequest: RepairRequest | null = null;
  let taskPatch: TaskPatch | null = null;
  let approved: boolean | undefined;
  let approvalPhase: ApprovalPhase | undefined;

  switch (v.decision) {
    case "accepted":
      if (from === "running") next = "open_pr";
      else if (from === "pr_opened" || from === "qa_running") next = "advance_qa";
      else if (from === "qa_passed" && v.riskLevel === "red") {
        next = "request_post_qa_approval";
        transition = "awaiting_approval";
      } else if (from === "qa_passed") {
        next = "complete_task";
        transition = "complete";
      } else if (from === "awaiting_approval") {
        if (input.approvalPhase !== "post_qa") return { ok: false, reason: "accepting from awaiting_approval requires the post_qa phase" };
        next = "complete_task";
        transition = "complete";
        approved = true;
        approvalPhase = "post_qa";
      } else return { ok: false, reason: `cannot accept in state ${from}` };
      audit.push(managerAudit("manager_accepted", from, transition, meta));
      break;
    case "needs_human_approval":
      next = "await_human_approval";
      if (from === "qa_passed" && v.riskLevel === "red") transition = "awaiting_approval";
      audit.push(managerAudit("manager_human_approval_required", from, transition, meta));
      break;
    case "needs_repair": {
      const built = buildRepairRequest(e, input.previousDiagnosis ?? null, { round: input.round ?? 1, human: null }, input.planning ?? null);
      if (!built.ok) return { ok: false, reason: built.reason };
      repairRequest = built.request;
      next = "dispatch_repair";
      taskPatch = { retries: built.request.attempt };
      const d = built.request.diagnosis;
      audit.push(
        managerAudit("manager_diagnosis_issued", from, null, {
          ...meta,
          attempt: built.request.attempt,
          failedEvidenceIds: [d.failingCheck],
          reasonCodes: [d.failureCode, ...(d.previous ? [`trend_${d.previous.trend}`] : [])],
        }),
      );
      audit.push(managerAudit("manager_repair_requested", from, null, { ...meta, attempt: built.request.attempt }));
      break;
    }
    case "needs_human_decision":
      next = "escalate_human_decision";
      audit.push(managerAudit("manager_human_decision_required", from, null, meta));
      break;
    case "blocked":
      next = v.intents.includes("replan_branch") && !v.intents.includes("stop_task") ? "replan_branch" : "stop";
      audit.push(managerAudit("manager_blocked", from, null, meta));
      break;
    default:
      return { ok: false, reason: "unknown manager decision" };
  }

  if (transition) {
    // "complete_task" means: QA-accepted. Its pre-check validates the PR-only completion edge; a production
    // goal never takes it — the loop moves to the deploy gate instead and validates its own move.
    const check = validateTransition(from, transition, { riskLevel: v.riskLevel, approved, approvalPhase, ...(transition === "complete" ? { completion: "pull_request" as const } : {}) });
    if (!check.ok) return { ok: false, reason: check.reason };
  }
  return { ok: true, validation: v, next, transition, repairRequest, taskPatch, audit };
}

/**
 * Start record for a repair run. The existing workerStartIntent always
 * transitions into "running", which is not a valid edge for a task that is
 * already running or in QA; a repair instead records a new TaskRun and an
 * audit event with NO state transition. Refuses unless the same worker runs
 * on the request's assigned branch at its expected head, in a state where a
 * repair is possible.
 */
export function repairStartIntent(input: {
  request: RepairRequest;
  currentState: TaskState;
  worker: WorkerKind;
  runId: string;
  model: string;
  promptHash: string | null;
  workspaceBranch: string;
  workspaceHeadSha: string;
  riskLevel: ManagerAuditMetadataInput["riskLevel"];
}): Intent<{ taskRun: NewTaskRun; transition: null; audit: Omit<NewAuditEvent, "id"> }> {
  const { request: r } = input;
  if (!REPAIRABLE_STATES.includes(input.currentState)) return { ok: false, reason: `cannot start a repair in state ${input.currentState}` };
  if (input.worker !== r.worker) return { ok: false, reason: "repairs never switch workers" };
  if (input.workspaceBranch !== r.branch) return { ok: false, reason: "repair must run on the assigned task branch" };
  if (input.workspaceHeadSha !== r.expectedHeadSha) return { ok: false, reason: "workspace head does not match the repair request" };
  if (r.attempt < 1 || r.attempt > r.maxRepairAttempts) return { ok: false, reason: "repair attempt is outside the budget" };
  if (!input.promptHash || !/^[0-9a-f]{64}$/.test(input.promptHash)) return { ok: false, reason: "a valid promptHash is required to record a run" };
  return {
    ok: true,
    taskRun: { id: input.runId, taskId: r.taskId, worker: r.worker, model: input.model, promptHash: input.promptHash },
    transition: null,
    audit: managerAudit("repair_attempt_started", input.currentState, null, {
      taskId: r.taskId,
      branch: r.branch,
      headSha: r.expectedHeadSha,
      decision: "needs_repair",
      failedEvidenceIds: r.failedEvidenceIds,
      attempt: r.attempt,
      riskLevel: input.riskLevel,
    }),
  };
}
