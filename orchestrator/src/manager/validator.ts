import { checkTaskBranchName } from "../branches/naming";
import { isProtectedBranch } from "../domain/risk";
import type { RiskLevel, TaskState } from "../domain/types";
import type { CheckOutcome } from "../github/types";
import type { WorkerErrorType } from "../workers/types";
import { managerBudget } from "./budget";
import { isEvidenceId, normalizeManagerEvidence, sanitizeSummary } from "./evidence";
import type {
  EscalationIntent,
  EscalationTrigger,
  Finding,
  ManagerDecision,
  ManagerEvidence,
  ManagerValidation,
} from "./types";

/**
 * Pure, deterministic evidence validator.
 *
 * Validates evidence, not implementation: it never reads code, never infers
 * correctness from prose, never calls an LLM, worker, shell, or GitHub. It
 * only cross-checks structured evidence records and returns a decision.
 *
 * Precedence (most restrictive wins):
 *   blocked > needs_human_approval > needs_human_decision > needs_repair > accepted
 * needs_human_decision is never forced by a single finding: it replaces
 * needs_repair only once the Manager-guided repair cycles are exhausted.
 * Rationale: an unsafe or untrusted state must stop work; and once approval
 * is required, no further worker execution (including repairs) happens
 * without it.
 */

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };
const SEVERITY: Record<ManagerDecision, number> = { accepted: 0, needs_repair: 1, needs_human_decision: 2, needs_human_approval: 3, blocked: 4 };

/** States in which a worker run has happened and evidence can be judged. */
export const VALIDATABLE_STATES: readonly TaskState[] = ["running", "pr_opened", "qa_running", "qa_passed", "awaiting_approval"];
/** States in which a PR exists, so trusted CI on the exact head is required. */
export const CI_REQUIRED_STATES: readonly TaskState[] = ["pr_opened", "qa_running", "qa_passed", "awaiting_approval"];

/**
 * States a repair can run in without a backwards transition: the task stays
 * where it is and QA re-polls the new head. After qa_passed a repair would
 * need to move back to QA, which the state machine does not allow.
 */
export const REPAIRABLE_STATES: readonly TaskState[] = ["running", "pr_opened", "qa_running"];

/**
 * Transient runtime/tool/quota/infrastructure failures. The Manager Loop may
 * re-run the same contract a bounded number of times WITHOUT a Manager
 * diagnosis, so they never consume a Manager-guided repair cycle. When the
 * Manager itself sees one (retries exhausted), it is an unrecoverable
 * infrastructure condition and blocks — it is never sent to repair.
 */
export const TRANSIENT_WORKER_ERRORS: readonly WorkerErrorType[] = ["timeout", "process_error", "runtime_unavailable"];

/** Worker failures the same worker may repair; everything else is not repairable by retrying. */
const WORKER_ERROR_POLICY: Record<WorkerErrorType, { severity: Finding["severity"]; trigger: EscalationTrigger }> = {
  worker_failure: { severity: "needs_repair", trigger: "worker_failure" },
  worker_error: { severity: "needs_repair", trigger: "worker_failure" },
  validation_incomplete: { severity: "needs_repair", trigger: "validation_failure" },
  result_mismatch: { severity: "needs_repair", trigger: "worker_failure" },
  malformed_output: { severity: "needs_repair", trigger: "worker_failure" },
  timeout: { severity: "blocked", trigger: "infrastructure_failure" },
  red_approval_missing: { severity: "needs_human_approval", trigger: "approval_required" },
  scope_violation: { severity: "blocked", trigger: "scope_violation" },
  protected_branch: { severity: "blocked", trigger: "unsafe_branch_state" },
  branch_mismatch: { severity: "blocked", trigger: "unsafe_branch_state" },
  branch_changed: { severity: "blocked", trigger: "unsafe_branch_state" },
  git_metadata_changed: { severity: "blocked", trigger: "unsafe_branch_state" },
  dirty_worktree: { severity: "blocked", trigger: "unsafe_branch_state" },
  invalid_contract: { severity: "blocked", trigger: "task_state_blocked" },
  cancelled: { severity: "blocked", trigger: "task_state_blocked" },
  git_error: { severity: "blocked", trigger: "missing_trusted_evidence" },
  temp_file_error: { severity: "blocked", trigger: "missing_trusted_evidence" },
  runtime_unavailable: { severity: "blocked", trigger: "infrastructure_failure" },
  runtime_misconfigured: { severity: "blocked", trigger: "missing_trusted_evidence" },
  policy_error: { severity: "blocked", trigger: "missing_trusted_evidence" },
  process_error: { severity: "blocked", trigger: "infrastructure_failure" },
};

const CI_OUTCOME_RANK: Record<CheckOutcome, number> = { success: 0, pending: 1, unknown: 2, missing: 3, failed: 4, blocked: 5 };

const REPLAN_TRIGGERS: readonly EscalationTrigger[] = ["stale_base", "branch_conflict"];

export function isInScope(path: string, scope: readonly string[]): boolean {
  return scope.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

export function scopeViolations(evidence: Pick<ManagerEvidence, "scope">): string[] {
  return evidence.scope.changedPaths.filter((p) => !isInScope(p, evidence.scope.allowedScope));
}

function collectFindings(e: ManagerEvidence, approvalRequired: boolean): { findings: Finding[]; triggers: EscalationTrigger[] } {
  const findings: Finding[] = [];
  const triggers: EscalationTrigger[] = [];
  const add = (evidenceId: string, severity: Finding["severity"], code: string, trigger: EscalationTrigger, summary?: string) =>
    findings.push({ evidenceId, severity, code, trigger, ...(summary ? { summary: sanitizeSummary(summary) } : {}) });

  // Task state
  if (!VALIDATABLE_STATES.includes(e.taskState)) {
    add("task:state", "blocked", `task_state_${e.taskState}`, "task_state_blocked");
  }
  const ciRequired = CI_REQUIRED_STATES.includes(e.taskState);

  // Worker result
  if (e.worker.status === "success") {
    if (e.worker.errorType !== null) add("worker:result", "blocked", "worker_result_inconsistent", "missing_trusted_evidence");
  } else if (e.worker.status === "cancelled") {
    add("worker:result", "blocked", "worker_cancelled", "task_state_blocked");
  } else if (e.worker.errorType === null) {
    add("worker:result", "blocked", "worker_failure_unclassified", "missing_trusted_evidence");
  } else {
    const p = WORKER_ERROR_POLICY[e.worker.errorType];
    add("worker:result", p.severity, `worker_${e.worker.errorType}`, p.trigger);
  }

  // Branch / workspace
  const b = e.branch;
  if (isProtectedBranch(b.assignedBranch) || !checkTaskBranchName(b.assignedBranch).ok) {
    add("branch:assigned", "blocked", "assigned_branch_invalid", "unsafe_branch_state");
  }
  if (b.branchPlanDecision !== "new_branch" && b.branchPlanDecision !== "reuse_branch") {
    add("branch:plan", "blocked", `branch_plan_${b.branchPlanDecision}`, "unsafe_branch_state");
  }
  if (b.workerBranch !== b.assignedBranch) add("branch:worker", "blocked", "branch_mismatch", "unsafe_branch_state");
  if (b.workspaceProof !== "verified") add("branch:workspace", "blocked", `workspace_proof_${b.workspaceProof}`, "unsafe_branch_state");
  if (b.conflict) add("branch:conflict", "blocked", "branch_conflict", "branch_conflict");
  if (b.baseFreshness === "stale") add("branch:base", "blocked", "stale_base", "stale_base");
  if (b.verifiedHeadSha === null) {
    add("branch:head", "blocked", "head_unverified", "missing_trusted_evidence");
  } else if (b.workerHeadSha !== null && b.workerHeadSha !== b.verifiedHeadSha) {
    add("branch:head", "blocked", "head_mismatch", "unsafe_branch_state");
  } else if (b.workerHeadSha === null && e.worker.status === "success") {
    add("branch:head", "blocked", "worker_head_missing", "missing_trusted_evidence");
  }
  if (ciRequired) {
    if (e.pr === null) add("pr", "blocked", "pr_missing", "missing_trusted_evidence");
    else if (e.pr.state !== "open") add("pr", "blocked", `pr_${e.pr.state}`, "task_state_blocked");
  }

  // Scope
  const violations = scopeViolations(e);
  if (e.scope.allowedScope.length === 0) add("scope", "blocked", "scope_undefined", "scope_violation");
  else if (violations.length > 0) {
    add("scope", "blocked", "scope_violation", "scope_violation", `outside scope: ${violations.slice(0, 5).join(", ")}`);
  }

  // Validations
  const requested = e.validations.filter((v) => v.requested);
  const names = e.validations.map((v) => v.name);
  if (requested.length === 0) add("validation", "blocked", "validations_undefined", "missing_trusted_evidence");
  if (new Set(names).size !== names.length) add("validation", "blocked", "validation_duplicate", "missing_trusted_evidence");
  const passedValidations = new Set<string>();
  for (const v of requested) {
    const vid = `validation:${v.name}`;
    if (!v.trusted) add(vid, "blocked", "validation_untrusted", "missing_trusted_evidence");
    else if (v.status === "passed" && !v.executed) add(vid, "blocked", "validation_inconsistent", "missing_trusted_evidence");
    else if (v.status === "passed") passedValidations.add(v.name);
    else if (v.status === "failed") add(vid, "needs_repair", "validation_failed", "validation_failure", v.summary);
    else add(vid, "needs_repair", "validation_missing", "validation_failure", v.summary);
  }

  // CI (exact trusted head SHA)
  const passedChecks = new Set<string>();
  if (ciRequired) {
    const ci = e.ci;
    if (ci === null) add("ci", "blocked", "ci_missing", "missing_trusted_evidence");
    else if (!ci.trusted) add("ci", "blocked", "ci_untrusted", "missing_trusted_evidence");
    else if (ci.headSha !== b.verifiedHeadSha) add("ci", "blocked", "ci_stale_sha", "missing_trusted_evidence");
    else if (ci.requiredChecks.length === 0) add("ci", "blocked", "ci_required_checks_undefined", "missing_trusted_evidence");
    else {
      for (const name of ci.requiredChecks) {
        const observed = ci.checks.filter((c) => c.name === name).map((c) => c.outcome);
        const outcome = observed.reduce<CheckOutcome>((worst, o) => (CI_OUTCOME_RANK[o] > CI_OUTCOME_RANK[worst] ? o : worst), observed.length ? "success" : "missing");
        const cid = `ci:${name}`;
        if (outcome === "success") passedChecks.add(name);
        else if (outcome === "failed") add(cid, "needs_repair", "ci_failed", "ci_failure");
        else if (outcome === "missing") add(cid, "blocked", "ci_check_missing", "missing_trusted_evidence");
        else if (outcome === "blocked") add(cid, "blocked", "ci_blocked", "missing_trusted_evidence");
        else add(cid, "blocked", "ci_incomplete", "missing_trusted_evidence");
      }
    }
  }

  // Acceptance criteria (backed by trusted evidence, never by prose)
  const contractIds = new Set(e.acceptanceCriteriaIds);
  if (contractIds.size === 0) add("acceptance", "blocked", "acceptance_criteria_undefined", "missing_trusted_evidence");
  const seen = new Set<string>();
  for (const a of e.acceptance) {
    if (!contractIds.has(a.criterionId)) add(`acceptance:${a.criterionId}`, "blocked", "acceptance_unknown_criterion", "missing_trusted_evidence");
    else if (seen.has(a.criterionId)) add(`acceptance:${a.criterionId}`, "blocked", "acceptance_duplicate", "missing_trusted_evidence");
    seen.add(a.criterionId);
  }
  for (const cid of e.acceptanceCriteriaIds) {
    const a = e.acceptance.find((x) => x.criterionId === cid);
    const aid = `acceptance:${cid}`;
    if (!a || a.status === "unknown") {
      add(aid, "needs_repair", "acceptance_unverified", "acceptance_failure", a?.summary);
      continue;
    }
    if (a.status === "failed") {
      add(aid, "needs_repair", "acceptance_failed", "acceptance_failure", a.summary);
      continue;
    }
    const backed =
      (a.evidenceType === "validation" && a.reference !== null && passedValidations.has(a.reference)) ||
      (a.evidenceType === "ci_check" && a.reference !== null && passedChecks.has(a.reference)) ||
      (a.evidenceType === "scope" && a.reference === "scope" && e.scope.allowedScope.length > 0 && violations.length === 0) ||
      (a.evidenceType === "human" && a.reference !== null);
    if (!backed) add(aid, "needs_repair", "acceptance_unverified", "acceptance_failure", a.summary);
  }

  // Risk / approval (escalation only)
  if (RANK[e.risk.observed] > RANK[e.risk.stored]) triggers.push("observed_risk_escalation");
  if (approvalRequired) {
    if (e.risk.approval === "rejected") add("risk:approval", "blocked", "approval_rejected", "approval_rejected");
    else if (e.risk.approval !== "approved") add("risk:approval", "needs_human_approval", `approval_${e.risk.approval === "expired" ? "expired" : "required"}`, "approval_required");
  }

  return { findings, triggers };
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort();
}

/** Stop vs. replan is decided only by the triggers of *blocking* findings, not by repair-level ones. */
function intentsFor(decision: ManagerDecision, triggers: readonly EscalationTrigger[], blockingTriggers: readonly EscalationTrigger[], allowDeep: boolean): EscalationIntent[] {
  const out = new Set<EscalationIntent>();
  if (decision === "needs_repair") out.add("return_to_worker");
  if (decision === "needs_human_approval") out.add("request_human_approval");
  if (decision === "needs_human_decision") out.add("request_human_decision");
  if (decision === "blocked") {
    if (blockingTriggers.some((t) => REPLAN_TRIGGERS.includes(t))) out.add("replan_branch");
    if (blockingTriggers.some((t) => !REPLAN_TRIGGERS.includes(t))) out.add("stop_task");
  }
  if (allowDeep && triggers.includes("repeated_repair_failure")) out.add("future_deep_review_candidate");
  return Array.from(out);
}

/** Validates already-normalized (or untrusted) evidence. Never throws; fails closed. */
export function validateEvidence(input: ManagerEvidence): ManagerValidation {
  // Re-normalize: a caller casting arbitrary data (e.g. file contents) into
  // ManagerEvidence is rejected here rather than trusted.
  const normalized = normalizeManagerEvidence(input);
  if (!normalized.ok) {
    const raw = (input ?? {}) as { taskId?: unknown };
    const budget = managerBudget("red");
    return {
      taskId: isEvidenceId(raw.taskId) ? raw.taskId : "unknown",
      decision: "blocked",
      budget,
      riskLevel: "red",
      findings: [{ evidenceId: "evidence", severity: "blocked", code: "evidence_rejected", trigger: "missing_trusted_evidence", summary: sanitizeSummary(normalized.reason) }],
      failedEvidenceIds: ["evidence"],
      reasonCodes: ["evidence_rejected"],
      triggers: ["missing_trusted_evidence"],
      intents: ["stop_task"],
    };
  }
  const e = normalized.evidence;
  const riskLevel: RiskLevel = RANK[e.risk.observed] > RANK[e.risk.stored] ? e.risk.observed : e.risk.stored;
  const budget = managerBudget(riskLevel);
  const { findings, triggers } = collectFindings(e, budget.approvalRequired);

  // Repair history must be a gap-free, monotonic sequence of prior needs_repair outcomes.
  const { attempt, prior } = e.repair;
  const historyOk = prior.length === attempt && prior.every((p, i) => p.attempt === i && p.decision === "needs_repair");
  if (attempt > budget.maxRepairAttempts) {
    findings.push({ evidenceId: "repair:attempt", severity: "blocked", code: "repair_attempt_out_of_range", trigger: "repeated_repair_failure" });
  } else if (!historyOk) {
    findings.push({ evidenceId: "repair:attempt", severity: "blocked", code: "repair_history_inconsistent", trigger: "missing_trusted_evidence" });
  }

  let decision: ManagerDecision = findings.reduce<ManagerDecision>((d, f) => (SEVERITY[f.severity] > SEVERITY[d] ? f.severity : d), "accepted");

  const failedNow = new Set(findings.map((f) => f.evidenceId));
  if (attempt > 0 && prior.some((p) => p.failedEvidenceIds.some((id) => failedNow.has(id)))) {
    triggers.push("repeated_repair_failure");
  }
  if (decision === "needs_repair" && attempt >= budget.maxRepairAttempts) {
    // Every Manager-guided cycle was used and the failure persists: escalate
    // to a human with the diagnoses instead of failing the task silently.
    decision = "needs_human_decision";
    findings.push({ evidenceId: "repair:cycles", severity: "needs_human_decision", code: "manager_repair_cycles_exhausted", trigger: "repeated_repair_failure" });
  } else if (decision === "needs_repair" && !REPAIRABLE_STATES.includes(e.taskState)) {
    decision = "blocked";
    findings.push({ evidenceId: "task:state", severity: "blocked", code: "repair_state_unavailable", trigger: "task_state_blocked" });
  }

  const allTriggers = sortedUnique([...triggers, ...findings.map((f) => f.trigger)]);
  return {
    taskId: e.taskId,
    decision,
    budget,
    riskLevel,
    findings,
    failedEvidenceIds: sortedUnique(findings.map((f) => f.evidenceId)),
    reasonCodes: sortedUnique(findings.map((f) => f.code)),
    triggers: allTriggers,
    intents: intentsFor(decision, allTriggers, findings.filter((f) => f.severity === "blocked").map((f) => f.trigger), budget.allowDeepEscalation),
  };
}
