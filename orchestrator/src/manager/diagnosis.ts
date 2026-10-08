import { isDangerousValue, REDACTED } from "../store/sanitize";
import { applyGuidanceConstraints, type GuidedRepairPlan } from "../executive/guidance";
import type {
  DiagnosisFinding,
  DiagnosisPhase,
  Finding,
  HumanDecisionEvidence,
  HumanEscalationReport,
  ManagerDiagnosis,
  ManagerEvidence,
  ManagerValidation,
  PreviousRepairComparison,
  RepairCycleRecord,
  RepairPlanningContext,
} from "./types";

/**
 * Manager root-cause diagnosis. Pure and deterministic.
 *
 * The Manager analyzes the *actual trusted failure evidence* of the current
 * run (failing validation/CI/acceptance records, worker classification, the
 * verified head) and, from the second cycle on, compares it with the
 * previous diagnosis to decide whether the previous repair changed the
 * failure mode. It never reads source code, diffs, raw logs, or prompts: the
 * diagnosis says which check fails, what was expected vs. observed, the
 * evidence-level root cause and the outcome the repair must reach; the
 * Worker still decides how to change the code.
 */

/** Constant do-not-change constraints carried in every diagnosis. */
export const PROTECTED_AREAS = [
  "No git add/commit/push/switch/merge/rebase/reset/config/remote: the trusted Git layer owns commits.",
  "Do not modify CI workflows, required checks, risk, approval, permission, auth, or secret settings.",
  "Do not weaken, skip, or delete tests or validations to make them pass.",
  "Never touch protected branches; stay on the assigned task branch.",
] as const;

const MAX_LIST = 8;

/** Repairable failures first in this order: the earliest is the primary (root) failure. */
const CODE_ORDER = [
  "ci_failed",
  "validation_failed",
  // A worker that did not finish explains missing validations, not the other way round.
  "worker_worker_failure",
  "worker_worker_error",
  "worker_result_mismatch",
  "worker_malformed_output",
  "worker_validation_incomplete",
  "validation_missing",
  "acceptance_failed",
  "acceptance_unverified",
];

/** Diagnosis text: one line, credential-looking values redacted, bounded (longer than evidence summaries). */
export const MAX_DIAGNOSIS_TEXT = 320;
const s = (value: string) => {
  const line = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (isDangerousValue(line)) return REDACTED;
  return line.length > MAX_DIAGNOSIS_TEXT ? `${line.slice(0, MAX_DIAGNOSIS_TEXT - 1)}…` : line;
};
const short = (sha: string | null) => (sha ? sha.slice(0, 12) : "unverified");
const nameOf = (evidenceId: string) => evidenceId.slice(evidenceId.indexOf(":") + 1);

function repairable(v: ManagerValidation): Finding[] {
  const rank = (code: string) => {
    const i = CODE_ORDER.indexOf(code);
    return i === -1 ? CODE_ORDER.length : i;
  };
  return v.findings
    .filter((f) => f.severity === "needs_repair")
    .slice()
    .sort((a, b) => rank(a.code) - rank(b.code) || a.evidenceId.localeCompare(b.evidenceId));
}

/** Primary (root) repairable failure code, ranked the same way as a diagnosis. */
export function primaryFailureCode(v: ManagerValidation): string | null {
  return repairable(v)[0]?.code ?? null;
}

export function failureFingerprint(v: ManagerValidation): string {
  return Array.from(new Set(repairable(v).map((f) => `${f.evidenceId}=${f.code}`)))
    .sort()
    .join("|");
}

function describe(f: Finding, e: ManagerEvidence): DiagnosisFinding {
  const head = short(e.branch.verifiedHeadSha);
  const name = nameOf(f.evidenceId);
  const summary = f.summary ? `: ${f.summary}` : "";
  let expected: string;
  let actual: string;
  if (f.code === "validation_failed") {
    expected = `trusted validation '${name}' executes and passes on head ${head}`;
    actual = `validation '${name}' failed${summary}`;
  } else if (f.code === "validation_missing") {
    const v = e.validations.find((x) => x.name === name);
    expected = `trusted validation '${name}' executes and passes on head ${head}`;
    actual = `validation '${name}' status=${v?.status ?? "missing"} executed=${v?.executed ?? false}${summary}`;
  } else if (f.code === "ci_failed") {
    expected = `required CI check '${name}' concludes success on head ${short(e.ci?.headSha ?? null)}`;
    actual = `CI check '${name}' concluded failed on head ${short(e.ci?.headSha ?? null)}`;
  } else if (f.code === "acceptance_failed" || f.code === "acceptance_unverified") {
    const a = e.acceptance.find((x) => x.criterionId === name);
    expected = `acceptance criterion ${name} satisfied and backed by passing trusted evidence`;
    actual = `criterion ${name} status=${a?.status ?? "unknown"} via ${a?.evidenceType ?? "none"}:${a?.reference ?? "none"}${summary}`;
  } else {
    expected = "worker run completes with status success and a verified head";
    actual = `worker reported ${e.worker.status} (${e.worker.errorType ?? "unclassified"})${summary}`;
  }
  return { evidenceId: f.evidenceId, failureCode: f.code, expected: s(expected), actual: s(actual) };
}

function compare(current: ManagerValidation, fingerprint: string, previous: ManagerDiagnosis, previousRepairOutcome: string): PreviousRepairComparison {
  const prevIds = new Set(previous.findings.map((f) => f.evidenceId));
  const prevPairs = new Set(previous.fingerprint.split("|").filter(Boolean));
  const nowPairs = new Set(fingerprint.split("|").filter(Boolean));
  const nowIds = new Set(repairable(current).map((f) => f.evidenceId));
  const resolved = Array.from(prevIds).filter((id) => !nowIds.has(id)).sort();
  const persisting = Array.from(nowIds).filter((id) => prevIds.has(id)).sort();
  const added = Array.from(nowIds).filter((id) => !prevIds.has(id)).sort();
  const samePairs = prevPairs.size === nowPairs.size && Array.from(nowPairs).every((p) => prevPairs.has(p));
  const trend = samePairs ? "stagnated" : added.length === 0 && resolved.length > 0 ? "partially_resolved" : "shifted";
  return {
    cycle: previous.cycle,
    previousFailureCode: previous.failureCode,
    previousFingerprint: previous.fingerprint,
    currentFingerprint: fingerprint,
    fingerprintChanged: previous.fingerprint !== fingerprint,
    failureModeChanged: !samePairs,
    resolvedEvidenceIds: resolved.slice(0, MAX_LIST),
    persistingEvidenceIds: persisting.slice(0, MAX_LIST),
    newEvidenceIds: added.slice(0, MAX_LIST),
    trend,
    previousRepairOutcome: s(previousRepairOutcome),
  };
}

function rootCauseFor(primary: DiagnosisFinding, e: ManagerEvidence, phase: DiagnosisPhase, all: DiagnosisFinding[], prev: PreviousRepairComparison | null): string {
  const name = nameOf(primary.evidenceId);
  const dependents = all.filter((f) => f.evidenceId.startsWith("acceptance:") && f !== primary).map((f) => nameOf(f.evidenceId));
  const dep = dependents.length ? ` Unverified/failed acceptance (${dependents.slice(0, 4).join(", ")}) follows from it.` : "";
  let cause: string;
  switch (primary.failureCode) {
    case "ci_failed":
      cause = `Pushed head passed local trusted validation but CI check '${name}' fails: the change does not hold in the CI environment or under checks not covered by the local run.`;
      break;
    case "validation_failed":
      cause = `Task-owned changes on the branch do not satisfy required validation '${name}' (${primary.actual}).`;
      break;
    case "validation_missing":
      cause = `Required validation '${name}' was not executed to a passing result, so the change is unproven.`;
      break;
    case "worker_validation_incomplete":
      cause = `Worker finished without all required validations passing (${e.validations.filter((v) => v.requested && v.status !== "passed").map((v) => v.name).join(", ") || "unreported"}).`;
      break;
    case "acceptance_failed":
    case "acceptance_unverified":
      cause = `Acceptance criterion ${name} is not backed by passing trusted evidence.`;
      break;
    default:
      cause = `Worker did not complete the objective (${e.worker.errorType ?? "unclassified"}); no verified change satisfies the required validations.`;
  }
  if (prev?.trend === "stagnated") cause = `Repair #${prev.cycle} did not change the failure mode (${prev.currentFingerprint || primary.failureCode}); the cause from diagnosis #${prev.cycle} persists. ${cause}`;
  else if (prev?.trend === "partially_resolved") cause = `Repair #${prev.cycle} resolved ${prev.resolvedEvidenceIds.join(", ")} but ${prev.persistingEvidenceIds.join(", ") || primary.evidenceId} still fails. ${cause}`;
  else if (prev?.trend === "shifted") cause = `Repair #${prev.cycle} changed the failure mode (new: ${prev.newEvidenceIds.join(", ") || primary.evidenceId}). ${cause}`;
  if (phase === "post_pr_ci" && primary.failureCode !== "ci_failed") cause = `${cause} Observed after the PR was opened.`;
  return s(`${cause}${dep}`);
}

function requiredFixFor(primary: DiagnosisFinding, prev: PreviousRepairComparison | null, planning: RepairPlanningContext | null, guided: GuidedRepairPlan): string {
  const name = nameOf(primary.evidenceId);
  const reruns = guided.rerunValidations.join(", ");
  const readOnly = planning?.mode === "read_only";
  const plan = planning?.evidencePlan ?? null;
  const targets = guided.evidenceTargets.length ? guided.evidenceTargets : (plan?.targets ?? []);
  const where = targets.length ? ` Start from: ${targets.join(", ")}.` : "";
  let fix: string;
  if (primary.failureCode === "ci_failed") fix = `Make CI check '${name}' pass by correcting task-owned changes within scope; reproduce it via the required validations (${reruns || "none"}) before reporting.`;
  else if (primary.evidenceId.startsWith("validation:") && readOnly)
    fix = `Read-only task: do not change any file. Validation '${name}' reflects the repository state, not the answer; report it as a finding and base the answer on direct repository evidence.${where}`;
  else if (primary.evidenceId.startsWith("validation:")) fix = `Make validation '${name}' pass by correcting task-owned changes within scope, then rerun ${reruns || name}.`;
  else if (primary.evidenceId.startsWith("acceptance:") && (readOnly || guided.wantsDirectEvidence))
    // Concrete evidence requirements travel in diagnosis.evidenceRequests (kept out of this bounded line).
    fix = `Gather the direct repository evidence criterion ${name} needs: read the relevant source files and quote exact file paths with line references and bounded excerpts in the answer.${where}${
      reruns ? ` Validation (${reruns}) is secondary and never the evidence for the goal.` : " Do not rerun validations as a substitute for evidence."
    }`;
  else if (primary.evidenceId.startsWith("acceptance:")) fix = `Produce trusted passing evidence for criterion ${name}${reruns ? ` (rerun ${reruns})` : ""} within scope.`;
  else fix = `Complete the objective within scope${reruns ? ` and rerun ${reruns} until every required validation passes` : ""}.`;
  if (prev?.trend === "stagnated")
    fix = `${fix} Use another approach than repair #${prev.cycle}: it left the failure unchanged${primary.evidenceId.startsWith("acceptance:") ? " (it did not return the evidence the Manager needs)" : ""}.`;
  if (guided.justification) fix = `${fix} ${guided.justification}`;
  return s(fix);
}

/**
 * Builds the Manager diagnosis for the next repair cycle from the current
 * validation, the evidence it was computed from, and (from cycle 2) the
 * previous diagnosis and the outcome of the repair that followed it.
 * Refuses when there is no repairable failure to diagnose.
 */
export function diagnoseFailure(input: {
  evidence: ManagerEvidence;
  validation: ManagerValidation;
  cycle: number;
  previous?: { diagnosis: ManagerDiagnosis; repairOutcome: string } | null;
  /** Repair round (default 1). A later round starts only from a human decision. */
  round?: number;
  /** Human decision consumed as evidence; required for, and only allowed on, cycle 1 of a round > 1. */
  human?: HumanDecisionEvidence | null;
  /** GOAL-level planning context: mode, durable owner constraints, evidence plan (every cycle). */
  planning?: RepairPlanningContext | null;
}): { ok: true; diagnosis: ManagerDiagnosis } | { ok: false; reason: string } {
  const { evidence: e, validation: v, cycle } = input;
  const round = input.round ?? 1;
  const human = input.human ?? null;
  const failures = repairable(v);
  if (failures.length === 0) return { ok: false, reason: "no repairable failure evidence to diagnose" };
  if (!Number.isInteger(cycle) || cycle < 1) return { ok: false, reason: "diagnosis cycle must be a positive integer" };
  if (!Number.isInteger(round) || round < 1) return { ok: false, reason: "diagnosis round must be a positive integer" };
  const resumes = round > 1 && cycle === 1;
  if (resumes !== (human !== null)) return { ok: false, reason: "a human decision starts, and only starts, a resumed round" };
  if (human && human.round !== round) return { ok: false, reason: "human decision belongs to another round" };
  if (input.previous) {
    const p = input.previous.diagnosis;
    const adjacent = resumes ? p.round === round - 1 : p.round === round && p.cycle === cycle - 1;
    if (!adjacent) return { ok: false, reason: "previous diagnosis does not precede this cycle" };
    if (p.taskId !== e.taskId) return { ok: false, reason: "previous diagnosis belongs to another task" };
  } else if (resumes) return { ok: false, reason: "a resumed round requires the previous diagnosis" };
  const phase: DiagnosisPhase = e.ci !== null && e.pr !== null ? "post_pr_ci" : "local_validation";
  const findings = failures.map((f) => describe(f, e));
  const primary = findings[0];
  const fingerprint = failureFingerprint(v);
  const prev = input.previous ? compare(v, fingerprint, input.previous.diagnosis, input.previous.repairOutcome) : null;
  const scope = e.scope.allowedScope.join(", ");
  const acceptance = [
    ...Array.from(new Set(e.validations.filter((x) => x.requested).map((x) => x.name))).sort().map((n) => `validation:${n} passes (trusted, executed)`),
    ...e.acceptanceCriteriaIds.map((id) => `acceptance:${id} satisfied by trusted evidence`),
    ...(phase === "post_pr_ci" ? (e.ci?.requiredChecks ?? []).map((c) => `ci:${c} success on the repaired head`) : []),
    "changed paths stay within allowedScope",
  ];
  const planning = input.planning ?? null;
  const guided = applyGuidanceConstraints({
    mode: planning?.mode ?? "change",
    rerunValidations: Array.from(new Set(e.validations.filter((x) => x.requested).map((x) => x.name))),
    constraints: planning?.constraints ?? [],
  });
  let rootCause = rootCauseFor(primary, e, phase, findings, prev);
  let requiredFix = requiredFixFor(primary, prev, planning, guided);
  if (human) {
    rootCause = s(`Human decision ${human.decisionId} adds information after round ${round - 1} stalled. ${rootCause}`);
    requiredFix = s(`Apply the human decision (humanDecision.guidance) to this failure. ${requiredFix}`);
  } else if (guided.constraintLines.length > 0) {
    requiredFix = s(`Honor the owner's earlier guidance (ownerConstraints). ${requiredFix}`);
  }
  const plan = planning?.evidencePlan ?? null;
  const evidenceRequests = [
    ...(plan && plan.kind !== "change" ? plan.requirements : []),
    ...(guided.evidenceTargets.length ? [`Inspect: ${guided.evidenceTargets.join(", ")}`] : []),
  ].slice(0, MAX_LIST);
  const diagnosis: ManagerDiagnosis = {
    kind: "manager_diagnosis",
    taskId: e.taskId,
    round,
    cycle,
    phase,
    headSha: e.branch.verifiedHeadSha,
    failureCode: primary.failureCode,
    failingCheck: primary.evidenceId,
    expected: primary.expected,
    actual: primary.actual,
    rootCause,
    requiredFix,
    protectedAreas: [s(`Change only paths within allowedScope: ${scope}.`), ...PROTECTED_AREAS],
    acceptanceCriteria: acceptance.slice(0, MAX_LIST * 2).map(s),
    evidenceUsed: [
      `head:${e.branch.verifiedHeadSha ?? "unverified"}`,
      `worker:${e.worker.status}${e.worker.errorType ? `/${e.worker.errorType}` : ""}`,
      ...v.failedEvidenceIds.slice(0, MAX_LIST * 2),
      ...(prev ? [`diagnosis:${input.previous!.diagnosis.round}.${prev.cycle}`] : []),
      ...(human ? [`human:${human.decisionId}`] : []),
    ],
    fingerprint,
    findings: findings.slice(0, MAX_LIST),
    previous: prev,
    humanDecision: human ? structuredClone(human) : null,
    ...(guided.constraintLines.length ? { ownerConstraints: guided.constraintLines.slice(0, MAX_LIST).map(s) } : {}),
    ...(evidenceRequests.length ? { evidenceRequests: evidenceRequests.map(s) } : {}),
    ...(guided.deferredValidations.length ? { deferredValidations: [...guided.deferredValidations] } : {}),
    ...(guided.justification ? { constraintJustification: s(guided.justification) } : {}),
  };
  return { ok: true, diagnosis };
}

function outcomeText(c: RepairCycleRecord): { workerResult: string; revalidation: string } {
  const w = c.workerResult ? `${c.workerResult.status}${c.workerResult.errorType ? `/${c.workerResult.errorType}` : ""}` : "not_completed";
  const r = c.revalidation
    ? `${c.revalidation.decision}${c.revalidation.failureCode ? ` (${c.revalidation.failureCode})` : ""}${c.revalidation.fingerprint ? ` fp=${c.revalidation.fingerprint}` : ""}`
    : "not_revalidated";
  return { workerResult: s(w), revalidation: s(r) };
}

/** Human-readable one-line repair outcome handed to the next diagnosis. */
export function repairOutcomeSummary(c: RepairCycleRecord): string {
  const o = outcomeText(c);
  return s(`repair #${c.cycle}: worker ${o.workerResult}; revalidation ${o.revalidation}`);
}

/**
 * Report for the needs_human_decision escalation after every Manager-guided
 * repair cycle completed and the failure persists. It carries every
 * diagnosis and repair outcome, a fresh analysis of the current blocker
 * against the last diagnosis, the fingerprint trend, a recommendation and
 * the exact decision the human must make.
 */
export function buildHumanEscalationReport(input: {
  evidence: ManagerEvidence;
  validation: ManagerValidation;
  /** Cycles of the current round only; earlier rounds are in earlier reports. */
  cycles: readonly RepairCycleRecord[];
  prNumber: number | null;
  round?: number;
}): HumanEscalationReport {
  const { evidence: e, validation: v } = input;
  const round = input.round ?? 1;
  const cycles = input.cycles.filter((c) => c.round === round);
  const last = cycles.at(-1) ?? null;
  const analysis = diagnoseFailure({
    evidence: e,
    validation: v,
    cycle: (last?.cycle ?? 0) + 1,
    round,
    previous: last ? { diagnosis: last.diagnosis, repairOutcome: repairOutcomeSummary(last) } : null,
  });
  const current = analysis.ok
    ? analysis.diagnosis
    : null;
  const fingerprints = [...cycles.map((c) => c.diagnosis.fingerprint), current?.fingerprint ?? failureFingerprint(v)];
  const stagnated = fingerprints.every((f) => f === fingerprints[0]);
  const blocker = current
    ? { failureCode: current.failureCode, failingCheck: current.failingCheck, expected: current.expected, actual: current.actual, fingerprint: current.fingerprint }
    : { failureCode: v.reasonCodes[0] ?? "unknown", failingCheck: v.failedEvidenceIds[0] ?? "unknown", expected: "accepted trusted evidence", actual: s(v.reasonCodes.join(", ")), fingerprint: failureFingerprint(v) };
  // With no completed cycle (a policy allowing zero repairs) the current analysis is the original failure.
  const first = cycles[0]?.diagnosis ?? current;
  const pr = input.prNumber !== null ? ` PR #${input.prNumber} stays open with no further pushes.` : " No commit, push, or PR has been made.";
  const recommendation = stagnated
    ? `Both Manager-guided repairs left '${blocker.failingCheck}' failing with the same fingerprint; the Worker likely lacks information or the requirement conflicts with the protected constraints. Recommend a human review of that check before any further repair.`
    : `Repairs changed the failure mode (${fingerprints.join(" -> ")}) without converging; recommend a human review of '${blocker.failingCheck}' and of whether the task scope or acceptance criteria are correct.`;
  const escalationId = `${e.taskId}.hd.${round}`;
  return {
    kind: "human_escalation_report",
    state: "needs_human_decision",
    taskId: e.taskId,
    round,
    decisionRequest: {
      kind: "human_decision_request",
      escalationId,
      taskId: e.taskId,
      lineageId: e.lineageId,
      branch: e.branch.assignedBranch,
      expectedHeadSha: e.branch.verifiedHeadSha ?? "",
      round,
      cyclesCompleted: cycles.length,
      fingerprint: blocker.fingerprint,
    },
    cyclesCompleted: cycles.length,
    originalFailure: first ? { failureCode: first.failureCode, failingCheck: first.failingCheck, actual: first.actual, fingerprint: first.fingerprint } : null,
    diagnoses: cycles.map((c) => structuredClone(c.diagnosis)),
    repairOutcomes: cycles.map((c) => ({ cycle: c.cycle, repairRunId: c.repairRunId, ...outcomeText(c) })),
    currentBlocker: blocker,
    fingerprintTrend: stagnated ? "stagnated" : "changed",
    currentComparison: current?.previous ?? null,
    managerRecommendation: s(recommendation),
    humanDecisionRequired: s(
      `Decide one: (a) submit a human decision for escalation ${escalationId} with the missing information for '${blocker.failingCheck}' to resume this task; (b) cancel the task (scope/acceptance changes need a new task). A decision never approves commit, publish, merge, or deploy.${pr}`,
    ),
  };
}
