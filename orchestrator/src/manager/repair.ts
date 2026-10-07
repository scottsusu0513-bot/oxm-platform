import type { WorkerTaskContract } from "../workers/types";
import { workerEffortForAttempt } from "./budget";
import { diagnoseFailure } from "./diagnosis";
import type { HumanDecisionEvidence, ManagerDiagnosis, ManagerEvidence, RepairCounters, RepairRequest } from "./types";
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
): Intent<{ request: RepairRequest }> {
  const v = validateEvidence(evidence);
  if (v.decision !== "needs_repair") return { ok: false, reason: `decision is ${v.decision}, not needs_repair` };

  const e = evidence;
  const attempt = e.repair.attempt + 1;
  if (attempt > v.budget.maxRepairAttempts) return { ok: false, reason: "repair budget exhausted" };
  const head = e.branch.verifiedHeadSha;
  if (head === null) return { ok: false, reason: "no verified head to repair from" };
  if (attempt > 1 && previous === null) return { ok: false, reason: "previous Manager diagnosis is required for a later repair cycle" };
  const diagnosed = diagnoseFailure({ evidence: e, validation: v, cycle: attempt, previous, round: resume.round, human: resume.human });
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
      rerunValidations: Array.from(new Set(e.validations.filter((x) => x.requested).map((x) => x.name))).sort(),
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
export function renderRepairBlock(r: RepairRequest, compact = false): string {
  const lines = [
    `Repair attempt ${r.attempt} of ${r.maxRepairAttempts} (Manager-guided repair cycle; effort: ${r.workerEffort}).`,
    ...renderDiagnosis(r.diagnosis, compact),
    `Failed evidence: ${r.failedEvidenceIds.join(", ") || "none"}.`,
  ];
  if (r.workerErrorType) lines.push(`Worker error: ${r.workerErrorType}.`);
  if (r.failedValidations.length) lines.push(`Failed validations: ${r.failedValidations.join(", ")}.`);
  if (r.ciFailures.length) lines.push(`CI check failures: ${r.ciFailures.join(", ")}.`);
  if (r.failedAcceptanceCriteria.length) lines.push(`Failed acceptance criteria: ${r.failedAcceptanceCriteria.join(", ")}.`);
  if (r.unverifiedAcceptanceCriteria.length) lines.push(`Unverified acceptance criteria: ${r.unverifiedAcceptanceCriteria.join(", ")}.`);
  for (const s of r.failureSummaries) lines.push(`- ${s.evidenceId}: ${s.summary}`);
  lines.push(`Scope remains: ${r.allowedScope.join(", ")}.`);
  lines.push(`Rerun: ${r.rerunValidations.join(", ")}.`);
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
  if (objective.length > MAX_OBJECTIVE) return { ok: false, reason: "repair objective exceeds contract limit" };
  return { ok: true, contract: { ...base, runId, expectedHeadSha: request.expectedHeadSha, objective, allowedDirtyPaths: [...request.allowedDirtyPaths] } };
}
