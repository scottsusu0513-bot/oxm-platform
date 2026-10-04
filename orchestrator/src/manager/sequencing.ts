import { validateTransition, type ApprovalPhase } from "../domain/taskState";
import type { TaskState } from "../domain/types";
import type { NewAuditEvent } from "../store/types";
import { managerStep, type ManagerStep } from "./lifecycle";
import type { Intent } from "./repair";
import type { ManagerEvidence } from "./types";

/**
 * Thin sequencing gate between existing *source* intents and the store.
 *
 * workers/lifecycle.workerFinishIntent sends every worker failure to
 * "failed", and github/intent.qaTaskIntent sends a final QA failure to
 * "failed". Both are left unchanged. Instead, the caller passes the source
 * intent through this gate together with the Manager evidence for the same
 * task/state, and applies the gate's `transition` in place of the source's.
 *
 * - needs_repair: any source transition (including "failed") is withheld;
 *   the task stays in its current non-terminal state and a RepairRequest
 *   is returned for the same worker on the same assigned branch.
 * - blocked + stop: a source "failed" is applied (budget exhausted or
 *   non-repairable). A forward transition (e.g. qa_passed) is withheld.
 * - blocked + replan / needs_human_approval: "failed" is withheld.
 * - accepted: the source transition is applied unchanged; a source
 *   "failed" with accepted evidence is inconsistent and refused.
 * - "cancelled" is always honoured.
 *
 * The gate never adds a transition the source did not propose, and every
 * applied transition is re-checked with domain/taskState.validateTransition.
 * It executes nothing: no worker run, no GitHub write, no code reading.
 */

export interface SourceTransition {
  taskId: string;
  fromState: TaskState;
  transition: TaskState | null;
}

export interface GatedStep {
  manager: ManagerStep;
  /** Transition the caller may apply (null = stay in the current state). */
  transition: TaskState | null;
  /** Transition the source proposed but the Manager withheld (null when nothing was withheld). */
  withheldTransition: TaskState | null;
}

export function gateTransition(input: {
  source: SourceTransition;
  evidence: ManagerEvidence;
  approvalPhase?: ApprovalPhase;
}): Intent<GatedStep> {
  const { source, evidence } = input;
  if (evidence.taskId !== source.taskId) return { ok: false, reason: "evidence belongs to another task" };
  if (evidence.taskState !== source.fromState) return { ok: false, reason: "evidence state does not match the source intent" };

  const step = managerStep({ evidence, approvalPhase: input.approvalPhase });
  if (!step.ok) return step;
  const proposed = source.transition;
  const decision = step.validation.decision;

  let transition: TaskState | null;
  if (proposed === null || proposed === "cancelled") transition = proposed;
  else if (decision === "needs_repair") transition = null;
  else if (decision === "blocked") transition = proposed === "failed" && step.next === "stop" ? "failed" : null;
  else if (decision === "needs_human_approval") transition = proposed === "failed" ? null : proposed;
  else if (proposed === "failed") return { ok: false, reason: "source reports failure but the evidence was accepted" };
  else transition = proposed;

  if (transition !== null) {
    const check = validateTransition(source.fromState, transition, { riskLevel: step.validation.riskLevel });
    if (!check.ok) return { ok: false, reason: check.reason };
  }
  return { ok: true, manager: step, transition, withheldTransition: transition === proposed ? null : proposed };
}

/**
 * Gate for workers/lifecycle.workerFinishIntent. The caller still applies the
 * source's taskRunPatch and taskRiskUpdate (risk only escalates), but uses
 * the gated transition and this rewritten worker audit (toState = applied).
 */
export function gateWorkerFinish(input: {
  finish: { transition: TaskState | null; audit: Omit<NewAuditEvent, "id"> };
  evidence: ManagerEvidence;
}): Intent<GatedStep & { workerAudit: Omit<NewAuditEvent, "id"> }> {
  const { finish } = input;
  if (finish.audit.fromState == null) return { ok: false, reason: "worker finish audit has no fromState" };
  const gated = gateTransition({
    source: { taskId: finish.audit.taskId, fromState: finish.audit.fromState, transition: finish.transition },
    evidence: input.evidence,
  });
  if (!gated.ok) return gated;
  return { ...gated, workerAudit: { ...finish.audit, toState: gated.transition } };
}

/**
 * Gate for github/intent.qaTaskIntent. The caller records the QA audit event
 * with toState = the gated transition.
 */
export function gateQaResult(input: {
  qa: { transition: TaskState | null };
  taskId: string;
  currentState: TaskState;
  evidence: ManagerEvidence;
  approvalPhase?: ApprovalPhase;
}): Intent<GatedStep> {
  return gateTransition({
    source: { taskId: input.taskId, fromState: input.currentState, transition: input.qa.transition },
    evidence: input.evidence,
    approvalPhase: input.approvalPhase,
  });
}
