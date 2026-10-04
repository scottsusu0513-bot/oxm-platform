import type { WorkerTaskContract } from "../workers/types";
import { workerEffortForAttempt } from "./budget";
import type { ManagerEvidence, RepairCounters, RepairRequest } from "./types";
import { validateEvidence } from "./validator";

/**
 * Structured repair requests: the Manager says WHAT failed, never HOW to fix
 * it. A request carries evidence ids, failed validation/check/criterion
 * names, the unchanged scope and branch, and fixed process instructions — no
 * implementation suggestions, patches, source code, raw logs, or secrets.
 */

export type Intent<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** Constant process rules sent with every repair. Never task- or code-specific advice. */
export const REPAIR_INSTRUCTIONS = [
  "Repair only the failures listed in this request; you decide how.",
  "Stay on the assigned branch. Do not create, switch, rename, or reset branches.",
  "Change only paths within allowedScope.",
  "Rerun every validation in rerunValidations and report the results.",
  "Do not push, open or merge PRs, or change risk, approval, or permission settings.",
] as const;

const MAX_OBJECTIVE = 4000;

/** Builds the next repair request. Re-validates the evidence itself so a caller cannot forge a decision. */
export function buildRepairRequest(evidence: ManagerEvidence): Intent<{ request: RepairRequest }> {
  const v = validateEvidence(evidence);
  if (v.decision !== "needs_repair") return { ok: false, reason: `decision is ${v.decision}, not needs_repair` };

  const e = evidence;
  const attempt = e.repair.attempt + 1;
  if (attempt > v.budget.maxRepairAttempts) return { ok: false, reason: "repair budget exhausted" };
  const head = e.branch.verifiedHeadSha;
  if (head === null) return { ok: false, reason: "no verified head to repair from" };

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
      rerunValidations: Array.from(new Set(e.validations.filter((x) => x.requested).map((x) => x.name))).sort(),
      failureSummaries: v.findings.filter((f) => f.summary).map((f) => ({ evidenceId: f.evidenceId, summary: f.summary as string })),
      instructions: REPAIR_INSTRUCTIONS,
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

/** Deterministic, data-only rendering of a repair request (used as untrusted task data in the worker prompt). */
export function renderRepairBlock(r: RepairRequest): string {
  const lines = [
    `Repair attempt ${r.attempt} of ${r.maxRepairAttempts} (effort: ${r.workerEffort}).`,
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
  if (runId === base.runId) return { ok: false, reason: "repair needs a new runId" };
  const objective = `${base.objective}\n\n${renderRepairBlock(request)}`;
  if (objective.length > MAX_OBJECTIVE) return { ok: false, reason: "repair objective exceeds contract limit" };
  return { ok: true, contract: { ...base, runId, expectedHeadSha: request.expectedHeadSha, objective } };
}
