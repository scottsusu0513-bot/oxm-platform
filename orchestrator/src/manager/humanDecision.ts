import { isValidSha } from "../branches/naming";
import { isValidEscalationId, isValidPrincipalId } from "../domain/types";
import { isDangerousValue } from "../store/sanitize";
import type { NewAuditEvent } from "../store/types";
import { isEvidenceId } from "./evidence";
import { managerAudit, type ManagerAuditMetadataInput } from "./intent";
import { buildRepairRequest, type Intent } from "./repair";
import {
  HUMAN_DECISION_KINDS,
  MAX_HUMAN_GUIDANCE_LENGTH,
  type HumanDecisionEvidence,
  type HumanDecisionInput,
  type HumanDecisionRequest,
  type ManagerDiagnosis,
  type ManagerEvidence,
  type ManagerValidation,
  type RepairRequest,
} from "./types";
import { validateEvidence } from "./validator";

/**
 * Resume path for a needs_human_decision escalation. Pure and deterministic.
 *
 * A human decision is untrusted input: it is strictly normalized (whitelisted
 * keys, bounded ids/text, no credential-looking content), bound to the exact
 * open escalation (escalation id, task, branch, expected HEAD), and then
 * consumed by the Manager as new evidence to build a fresh repair plan for
 * the SAME task and branch. It never carries or implies any approval.
 */

const DECISION_KEYS = ["decisionId", "escalationId", "taskId", "branch", "expectedHeadSha", "kind", "guidance", "decidedBy"] as const;

/** Strict normalization; unknown keys (e.g. an attempted "approveCommit" or "merge") reject the decision. */
export function normalizeHumanDecision(raw: unknown): Intent<{ decision: HumanDecisionInput }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "malformed human decision" };
  const r = raw as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !(DECISION_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) return { ok: false, reason: `human decision has unsupported fields: ${extra.slice(0, 5).join(", ")}` };
  for (const k of ["decisionId", "taskId"] as const) {
    if (!isEvidenceId(r[k])) return { ok: false, reason: `human decision ${k} is invalid` };
  }
  // Same canonical rules the Gateway enforces for the session identity and request id.
  if (!isValidEscalationId(r.escalationId)) return { ok: false, reason: "human decision escalationId is invalid" };
  if (!isValidPrincipalId(r.decidedBy)) return { ok: false, reason: "human decision decidedBy is invalid" };
  if (typeof r.branch !== "string" || r.branch.length === 0 || r.branch.length > 200) return { ok: false, reason: "human decision branch is invalid" };
  if (!isValidSha(r.expectedHeadSha)) return { ok: false, reason: "human decision expectedHeadSha is invalid" };
  if (!(HUMAN_DECISION_KINDS as readonly unknown[]).includes(r.kind)) return { ok: false, reason: "human decision kind is not supported" };
  if (typeof r.guidance !== "string") return { ok: false, reason: "human decision guidance is required" };
  const guidance = r.guidance.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (guidance.length === 0) return { ok: false, reason: "human decision guidance is required" };
  if (guidance.length > MAX_HUMAN_GUIDANCE_LENGTH) return { ok: false, reason: "human decision guidance is too long" };
  if (isDangerousValue(guidance)) return { ok: false, reason: "human decision guidance looks like a credential" };
  return {
    ok: true,
    decision: {
      decisionId: r.decisionId as string,
      escalationId: r.escalationId as string,
      taskId: r.taskId as string,
      branch: r.branch,
      expectedHeadSha: r.expectedHeadSha as string,
      kind: r.kind as HumanDecisionInput["kind"],
      guidance,
      decidedBy: r.decidedBy as string,
    },
  };
}

/** The decision must echo the open escalation exactly. */
export function checkHumanDecisionBinding(request: HumanDecisionRequest, d: HumanDecisionInput): Intent<object> {
  if (d.taskId !== request.taskId) return { ok: false, reason: "human decision belongs to another task" };
  if (d.escalationId !== request.escalationId) return { ok: false, reason: "human decision is for a stale or unknown escalation" };
  if (d.branch !== request.branch) return { ok: false, reason: "human decision branch does not match the task branch" };
  if (d.expectedHeadSha !== request.expectedHeadSha) return { ok: false, reason: "human decision HEAD does not match the escalated workspace" };
  return { ok: true };
}

/**
 * Manager consumes a bound human decision and produces the continuation plan:
 * a fresh diagnosis (round + 1, cycle 1) that includes the human response as
 * evidence and is compared with the last diagnosis of the stalled round.
 * The evidence must be the current trusted evidence of the same task/branch
 * at the escalated head, with repair counters reset for the new round.
 */
export function humanDecisionResumeStep(input: {
  evidence: ManagerEvidence;
  request: HumanDecisionRequest;
  decision: HumanDecisionInput;
  previous: { diagnosis: ManagerDiagnosis; repairOutcome: string };
}): Intent<{ human: HumanDecisionEvidence; validation: ManagerValidation; repairRequest: RepairRequest; audit: Omit<NewAuditEvent, "id">[] }> {
  const { evidence: e, request, decision } = input;
  const bound = checkHumanDecisionBinding(request, decision);
  if (!bound.ok) return bound;
  if (e.taskId !== request.taskId || e.lineageId !== request.lineageId) return { ok: false, reason: "evidence belongs to another task lineage" };
  if (e.branch.assignedBranch !== request.branch) return { ok: false, reason: "evidence branch does not match the escalation" };
  if (e.branch.verifiedHeadSha !== request.expectedHeadSha) return { ok: false, reason: "workspace head moved since the escalation" };
  if (e.repair.attempt !== 0 || e.repair.prior.length !== 0) return { ok: false, reason: "a resumed round must start with fresh repair counters" };
  if (input.previous.diagnosis.round !== request.round) return { ok: false, reason: "previous diagnosis is not from the escalated round" };

  const validation = validateEvidence(e);
  if (validation.decision !== "needs_repair") return { ok: false, reason: `evidence is ${validation.decision}, not repairable` };
  const human: HumanDecisionEvidence = {
    decisionId: decision.decisionId,
    escalationId: decision.escalationId,
    round: request.round + 1,
    kind: decision.kind,
    guidance: decision.guidance,
    decidedBy: decision.decidedBy,
  };
  const built = buildRepairRequest(e, input.previous, { round: human.round, human });
  if (!built.ok) return built;

  const meta: ManagerAuditMetadataInput = {
    taskId: e.taskId,
    branch: request.branch,
    headSha: request.expectedHeadSha,
    decision: validation.decision,
    failedEvidenceIds: validation.failedEvidenceIds,
    attempt: built.request.attempt,
    riskLevel: validation.riskLevel,
    reasonCodes: [`human_decision_${decision.kind}`, `round_${human.round}`],
    triggers: validation.triggers,
    intents: validation.intents,
  };
  const d = built.request.diagnosis;
  return {
    ok: true,
    human,
    validation,
    repairRequest: built.request,
    audit: [
      managerAudit("manager_human_decision_consumed", e.taskState, null, meta),
      managerAudit("manager_diagnosis_issued", e.taskState, null, { ...meta, failedEvidenceIds: [d.failingCheck], reasonCodes: [d.failureCode, `round_${d.round}`] }),
      managerAudit("manager_repair_requested", e.taskState, null, meta),
    ],
  };
}
