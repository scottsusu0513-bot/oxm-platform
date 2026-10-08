import type { WorkerTaskContract } from "../workers/types";
import { workerEffortForAttempt } from "./budget";
import { diagnoseFailure } from "./diagnosis";
import type { HumanDecisionEvidence, ManagerDiagnosis, ManagerEvidence, RepairCounters, RepairPlanningContext, RepairRequest } from "./types";
import { isInScope, validateEvidence } from "./validator";

/**
 * Structured repair requests for one Manager-guided repair cycle. A request
 * carries the Manager root-cause diagnosis (failing check, expected vs.
 * actual, root cause, outcome-level required fix, protected areas,
 * acceptance criteria, evidence used, previous repair outcome), the failed
 * evidence ids, the unchanged scope and branch, and fixed process
 * instructions — no patches, source code, raw logs, or secrets. The Worker
 * still decides how to change the code.
 */

export type Intent<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** Constant process rules sent with every repair. Never task- or code-specific advice. */
export const REPAIR_INSTRUCTIONS = [
  "Repair the root cause in the Manager diagnosis; you decide how to change the code.",
  "Keep work that is already verified; close only the gap the diagnosis names instead of redoing the whole task.",
  "Stay on the assigned branch. Do not create, switch, rename, or reset branches.",
  "Change only paths within allowedScope.",
  "Rerun every validation in rerunValidations and report the results.",
  "Do not push, open or merge PRs, or change risk, approval, or permission settings.",
] as const;

const MAX_OBJECTIVE = 4000;

/**
 * Builds the next repair request with a fresh Manager diagnosis. Re-validates
 * the evidence itself so a caller cannot forge a decision. From cycle 2 the
 * previous diagnosis and its repair outcome are required, so the Manager
 * always compares the new failure with what it diagnosed before.
 */
export function buildRepairRequest(
  evidence: ManagerEvidence,
  previous: { diagnosis: ManagerDiagnosis; repairOutcome: string } | null = null,
  resume: { round: number; human: HumanDecisionEvidence | null } = { round: 1, human: null },
  /** GOAL context: mode, durable owner guidance constraints, evidence plan. */
  planning: RepairPlanningContext | null = null,
): Intent<{ request: RepairRequest }> {
  const v = validateEvidence(evidence);
  if (v.decision !== "needs_repair") return { ok: false, reason: `decision is ${v.decision}, not needs_repair` };

  const e = evidence;
  const attempt = e.repair.attempt + 1;
  if (attempt > v.budget.maxRepairAttempts) return { ok: false, reason: "repair budget exhausted" };
  const head = e.branch.verifiedHeadSha;
  if (head === null) return { ok: false, reason: "no verified head to repair from" };
  if (attempt > 1 && previous === null) return { ok: false, reason: "previous Manager diagnosis is required for a later repair cycle" };
  const diagnosed = diagnoseFailure({ evidence: e, validation: v, cycle: attempt, previous, round: resume.round, human: resume.human, planning });
  if (!diagnosed.ok) return { ok: false, reason: diagnosed.reason };

  const names = (prefix: string, codes?: readonly string[]) =>
    Array.from(
      new Set(v.findings.filter((f) => f.evidenceId.startsWith(prefix) && (!codes || codes.includes(f.code))).map((f) => f.evidenceId.slice(prefix.length))),
    ).sort();
  const workerFinding = v.findings.find((f) => f.evidenceId === "worker:result");

  return {
    ok: true,
    request: {
      kind: "repair_request",
      taskId: e.taskId,
      lineageId: e.lineageId,
      worker: e.worker.kind,
      branch: e.branch.assignedBranch,
      baseSha: e.branch.plannedBaseSha,
      expectedHeadSha: head,
      attempt,
      maxRepairAttempts: v.budget.maxRepairAttempts,
      workerEffort: workerEffortForAttempt(attempt, v.budget.maxRepairAttempts),
      failedEvidenceIds: v.failedEvidenceIds,
      failedValidations: names("validation:"),
      ciFailures: names("ci:", ["ci_failed"]),
      failedAcceptanceCriteria: names("acceptance:", ["acceptance_failed"]),
      unverifiedAcceptanceCriteria: names("acceptance:", ["acceptance_unverified"]),
      workerErrorType: workerFinding ? e.worker.errorType : null,
      allowedScope: [...e.scope.allowedScope],
      allowedDirtyPaths: Array.from(new Set(e.scope.changedPaths)).sort(),
      // Owner-rejected validations are dropped from a read-only plan (never evidence for the answer).
      rerunValidations: Array.from(new Set(e.validations.filter((x) => x.requested).map((x) => x.name)))
        .filter((n) => !(diagnosed.diagnosis.deferredValidations ?? []).includes(n))
        .sort(),
      failureSummaries: v.findings.filter((f) => f.summary).map((f) => ({ evidenceId: f.evidenceId, summary: f.summary as string })),
      instructions: REPAIR_INSTRUCTIONS,
      diagnosis: diagnosed.diagnosis,
    },
  };
}

/** Counters for the evidence of the next repair run: attempt + 1 with this outcome appended (monotonic). */
export function advanceRepairCounters(counters: RepairCounters, request: RepairRequest): RepairCounters {
  if (request.attempt !== counters.attempt + 1) throw new Error("[manager] repair attempt must advance by exactly one");
  return {
    attempt: request.attempt,
    prior: [...counters.prior, { attempt: counters.attempt, decision: "needs_repair", failedEvidenceIds: [...request.failedEvidenceIds] }],
  };
}

/** The GPT Manager's validated plan: the primary repair instruction for the Worker. */
function renderManagerPlan(d: ManagerDiagnosis, level: 0 | 1 | 2): string[] {
  const p = d.managerPlan;
  if (!p) return [];
  const cap = (items: readonly string[], n: number, len: number) => items.slice(0, n).map((x) => (x.length > len ? `${x.slice(0, len - 1)}…` : x));
  const lines = [
    `GPT Manager repair plan (validated; this is the instruction to follow):`,
    `- managerRootCause: ${p.rootCause}`,
    ...(p.whyPreviousAttemptFailed ? [`- whyPreviousAttemptFailed: ${p.whyPreviousAttemptFailed}`] : []),
    `- repairStrategy: ${p.repairStrategy}${p.strategyChanged ? " (changed from the previous attempt)" : ""}`,
    `- repairObjective: ${p.repairObjective}`,
    `- repairInstructions: ${cap(p.repairInstructions, level === 2 ? 4 : 12, level === 2 ? 200 : 300).map((x, i) => `${i + 1}) ${x}`).join(" ")}`,
    ...(p.requiredEvidence.length ? [`- requiredEvidence: ${cap(p.requiredEvidence, level === 2 ? 3 : 12, 200).join(" | ")}`] : []),
    ...(p.missingEvidence.length && level < 2 ? [`- missingEvidence: ${p.missingEvidence.join(" | ")}`] : []),
    `- validationPlan: ${p.validationPlan.join(", ") || "none"}`,
    ...(p.touchesPaths.length ? [`- mayChange: ${p.touchesPaths.join(", ")}`] : []),
    ...(p.restartFromScratch ? ["- restartFromScratch: true (the Manager judged the existing work unusable; see managerRootCause)"] : []),
  ];
  if (level === 0) lines.push(`- managerProtectedAreas: ${p.protectedAreas.join(" ")}`);
  return lines;
}

function renderDiagnosis(d: ManagerDiagnosis, compact: boolean): string[] {
  const lines = [
    `Manager diagnosis #${d.cycle} (${d.phase}${d.round > 1 ? `, round ${d.round}` : ""}):`,
    `- failureCode: ${d.failureCode}`,
    `- failingCheck: ${d.failingCheck}`,
    `- expected: ${d.expected}`,
    `- actual: ${d.actual}`,
    `- rootCause: ${d.rootCause}`,
    `- requiredFix: ${d.requiredFix}`,
  ];
  if (d.humanDecision) lines.push(`- humanDecision ${d.humanDecision.decisionId} (${d.humanDecision.kind}): ${d.humanDecision.guidance}`);
  // Owner constraints are never dropped, not even in the compact rendering.
  for (const c of d.ownerConstraints ?? []) lines.push(`- ownerConstraint: ${c}`);
  if (d.deferredValidations?.length) lines.push(`- notRerun (owner rejected; not evidence): ${d.deferredValidations.join(", ")}`);
  if (d.constraintJustification) lines.push(`- constraintJustification: ${d.constraintJustification}`);
  // Evidence requirements: in full; the compact form keeps only the inspection targets (the base
  // objective of a read-only task already carries the Manager's evidence requirements).
  if (d.evidenceRequests?.length)
    lines.push(compact ? `- evidenceRequired: ${d.evidenceRequests.filter((r) => r.startsWith("Inspect:")).join(" | ") || "see objective"}` : `- evidenceRequired: ${d.evidenceRequests.join(" | ")}`);
  if (d.previous) {
    const p = d.previous;
    lines.push(
      `- previousRepair: #${p.cycle} ${p.previousRepairOutcome}; trend=${p.trend}; fingerprintChanged=${p.fingerprintChanged}; previousFailureCode=${p.previousFailureCode}`,
    );
  }
  if (compact) return lines;
  lines.push(`- protectedAreas: ${d.protectedAreas.join(" ")}`);
  lines.push(`- acceptanceCriteria: ${d.acceptanceCriteria.join("; ")}`);
  lines.push(`- evidenceUsed: ${d.evidenceUsed.join(", ")}`);
  return lines;
}

/** Deterministic, data-only rendering of a repair request (used as untrusted task data in the worker prompt). */
export function renderRepairBlock(r: RepairRequest, compact = false, minimal = false): string {
  if (minimal) {
    // Last resort for very long objectives: the plan, owner constraints, rerun and the fixed process rules.
    return [
      `Repair attempt ${r.attempt} of ${r.maxRepairAttempts} (Manager-guided repair cycle).`,
      ...renderManagerPlan(r.diagnosis, 2),
      ...(r.diagnosis.managerPlan ? [] : [`- requiredFix: ${r.diagnosis.requiredFix}`]),
      ...(r.diagnosis.ownerConstraints ?? []).map((c) => `- ownerConstraint: ${c}`),
      r.rerunValidations.length ? `Rerun: ${r.rerunValidations.join(", ")}.` : "Rerun: none (gather the required evidence instead).",
      ...r.instructions,
    ].join("\n");
  }
  const lines = [
    `Repair attempt ${r.attempt} of ${r.maxRepairAttempts} (Manager-guided repair cycle; effort: ${r.workerEffort}).`,
    ...renderManagerPlan(r.diagnosis, compact ? 1 : 0),
    ...renderDiagnosis(r.diagnosis, compact),
    `Failed evidence: ${r.failedEvidenceIds.join(", ") || "none"}.`,
  ];
  if (r.workerErrorType) lines.push(`Worker error: ${r.workerErrorType}.`);
  if (r.failedValidations.length) lines.push(`Failed validations: ${r.failedValidations.join(", ")}.`);
  if (r.ciFailures.length) lines.push(`CI check failures: ${r.ciFailures.join(", ")}.`);
  if (r.failedAcceptanceCriteria.length) lines.push(`Failed acceptance criteria: ${r.failedAcceptanceCriteria.join(", ")}.`);
  if (r.unverifiedAcceptanceCriteria.length) lines.push(`Unverified acceptance criteria: ${r.unverifiedAcceptanceCriteria.join(", ")}.`);
  // Compact: the first summaries only (the diagnosis already names the primary failure).
  const summaries = compact ? r.failureSummaries.slice(0, 2).map((x) => ({ ...x, summary: x.summary.length > 160 ? `${x.summary.slice(0, 159)}…` : x.summary })) : r.failureSummaries;
  for (const s of summaries) lines.push(`- ${s.evidenceId}: ${s.summary}`);
  if (compact && r.failureSummaries.length > summaries.length) lines.push(`- (+${r.failureSummaries.length - summaries.length} more with the same evidence gap)`);
  lines.push(`Scope remains: ${r.allowedScope.join(", ")}.`);
  lines.push(r.rerunValidations.length ? `Rerun: ${r.rerunValidations.join(", ")}.` : "Rerun: none (gather the required evidence instead).");
  lines.push(...r.instructions);
  return lines.join("\n");
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = Array.from(new Set(a)).sort();
  const y = Array.from(new Set(b)).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Derives the next worker contract for a repair run. Same task, same branch,
 * same scope, same validations and acceptance criteria; only runId, the
 * expected starting head, and the appended repair block change. A request
 * for a different task, branch, or scope is refused, so a repair can never
 * move work to a new or unrelated branch.
 */
export function repairWorkerContract(base: WorkerTaskContract, request: RepairRequest, runId: string): Intent<{ contract: WorkerTaskContract }> {
  if (base.taskId !== request.taskId) return { ok: false, reason: "repair request belongs to another task" };
  if (base.branch !== request.branch) return { ok: false, reason: "repair must stay on the assigned task branch" };
  if (!sameSet(base.allowedScope, request.allowedScope)) return { ok: false, reason: "repair cannot change the task scope" };
  if (!request.allowedDirtyPaths.every((path) => isInScope(path, base.allowedScope)))
    return { ok: false, reason: "repair dirty paths must remain within the task scope" };
  if (runId === base.runId) return { ok: false, reason: "repair needs a new runId" };
  if (request.diagnosis?.kind !== "manager_diagnosis" || request.diagnosis.taskId !== base.taskId || request.diagnosis.cycle !== request.attempt)
    return { ok: false, reason: "repair requires the Manager diagnosis for this cycle" };
  let objective = `${base.objective}\n\n${renderRepairBlock(request)}`;
  if (objective.length > MAX_OBJECTIVE) objective = `${base.objective}\n\n${renderRepairBlock(request, true)}`;
  if (objective.length > MAX_OBJECTIVE) objective = `${base.objective}\n\n${renderRepairBlock(request, true, true)}`;
  if (objective.length > MAX_OBJECTIVE) return { ok: false, reason: "repair objective exceeds contract limit" };
  return { ok: true, contract: { ...base, runId, expectedHeadSha: request.expectedHeadSha, objective, allowedDirtyPaths: [...request.allowedDirtyPaths] } };
}
