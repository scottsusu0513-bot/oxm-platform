import { normalizeRepoPath } from "../branches/overlap";
import { isValidSha } from "../branches/naming";
import { BRANCH_DECISIONS } from "../branches/types";
import { RISK_LEVELS, TASK_STATES, WORKER_KINDS } from "../domain/types";
import { PR_STATES } from "../github/types";
import { isDangerousValue, REDACTED } from "../store/sanitize";
import { WORKER_ERROR_TYPES, WORKER_RESULT_STATUSES } from "../workers/types";
import {
  ACCEPTANCE_EVIDENCE_TYPES,
  ACCEPTANCE_STATUSES,
  APPROVAL_EVIDENCE_STATES,
  BASE_FRESHNESS,
  MANAGER_DECISIONS,
  MAX_ID_LENGTH,
  MAX_LIST_LENGTH,
  MAX_SUMMARY_LENGTH,
  VALIDATION_STATUSES,
  WORKSPACE_PROOF_STATES,
  type ManagerEvidence,
} from "./types";

/**
 * Strict, deterministic normalization of untrusted evidence input.
 *
 * Every object is checked against an explicit key whitelist: any unknown key
 * (e.g. "content", "diff", "stdout", "fileContents") rejects the whole record,
 * so source code, file contents, raw logs, or prompts can never enter the
 * Manager. Strings are bounded: IDs match a fixed pattern, SHAs are 40-hex,
 * paths are normalized repo-relative paths, and summaries are collapsed to a
 * single sanitized line of at most MAX_SUMMARY_LENGTH characters.
 */

export type NormalizeResult = { ok: true; evidence: ManagerEvidence } | { ok: false; reason: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CHECK_OUTCOMES = ["success", "pending", "failed", "blocked", "unknown", "missing"] as const;

/** Whitelisted keys per evidence object; the single source of truth for the evidence shape. */
export const EVIDENCE_KEYS = {
  root: ["taskId", "lineageId", "taskState", "worker", "scope", "validations", "ci", "acceptanceCriteriaIds", "acceptance", "risk", "branch", "pr", "repair"],
  worker: ["kind", "status", "errorType"],
  scope: ["allowedScope", "changedPaths"],
  validation: ["name", "requested", "executed", "status", "trusted", "summary"],
  ci: ["requiredChecks", "headSha", "trusted", "checks"],
  ciCheck: ["name", "outcome"],
  acceptance: ["criterionId", "status", "evidenceType", "reference", "summary", "confirmedFailureOnly"],
  risk: ["stored", "observed", "approval"],
  branch: ["assignedBranch", "plannedBaseSha", "verifiedHeadSha", "workerBranch", "workerHeadSha", "workspaceProof", "branchPlanDecision", "baseFreshness", "conflict"],
  pr: ["number", "state"],
  repair: ["attempt", "prior"],
  prior: ["attempt", "decision", "failedEvidenceIds"],
} as const satisfies Record<string, readonly string[]>;

/** Collapses to one line, redacts credential-looking values, and bounds length. */
export function sanitizeSummary(value: string): string {
  const line = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (isDangerousValue(line)) return REDACTED;
  return line.length > MAX_SUMMARY_LENGTH ? `${line.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : line;
}

export function isEvidenceId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && ID_RE.test(value);
}

class Reject extends Error {}

function fail(reason: string): never {
  throw new Reject(reason);
}

function obj(value: unknown, keys: readonly string[], at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${at} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${at} must be a plain object`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) fail(`${at} has unsupported field "${k.slice(0, 40)}"`);
  return value as Record<string, unknown>;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(`${at} must be an array`);
  if (value.length > MAX_LIST_LENGTH) fail(`${at} has too many entries`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(`${at} is not a known value`);
  return value as T;
}

function bool(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") fail(`${at} must be a boolean`);
  return value;
}

function id(value: unknown, at: string): string {
  if (!isEvidenceId(value)) fail(`${at} must be a short identifier`);
  return value;
}

function sha(value: unknown, at: string): string {
  if (!isValidSha(value)) fail(`${at} must be a 40-hex SHA`);
  return value;
}

function nullableSha(value: unknown, at: string): string | null {
  return value === null ? null : sha(value, at);
}

function branchName(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(value)) fail(`${at} is not a branch name`);
  return value;
}

function nonNegInt(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`${at} must be a non-negative integer`);
  return value;
}

function paths(value: unknown, at: string): string[] {
  const out = new Set<string>();
  for (const p of list(value, at)) {
    const r = normalizeRepoPath(p);
    if (!r.ok) fail(`${at}: ${r.reason}`);
    out.add(r.value.path);
  }
  return Array.from(out).sort();
}

function ids(value: unknown, at: string): string[] {
  return Array.from(new Set(list(value, at).map((v) => id(v, at)))).sort();
}

function summary(value: unknown, at: string): { summary?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") fail(`${at} must be a string`);
  return { summary: sanitizeSummary(value) };
}

function normalize(raw: unknown): ManagerEvidence {
  const r = obj(raw, EVIDENCE_KEYS.root, "evidence");
  const w = obj(r.worker, EVIDENCE_KEYS.worker, "worker");
  const s = obj(r.scope, EVIDENCE_KEYS.scope, "scope");
  const rk = obj(r.risk, EVIDENCE_KEYS.risk, "risk");
  const b = obj(r.branch, EVIDENCE_KEYS.branch, "branch");
  const rp = obj(r.repair, EVIDENCE_KEYS.repair, "repair");

  const validations = list(r.validations, "validations").map((v, i) => {
    const at = `validations[${i}]`;
    const o = obj(v, EVIDENCE_KEYS.validation, at);
    return {
      name: id(o.name, `${at}.name`),
      requested: bool(o.requested, `${at}.requested`),
      executed: bool(o.executed, `${at}.executed`),
      status: oneOf(o.status, VALIDATION_STATUSES, `${at}.status`),
      trusted: bool(o.trusted, `${at}.trusted`),
      ...summary(o.summary, `${at}.summary`),
    };
  });

  let ci: ManagerEvidence["ci"] = null;
  if (r.ci !== null) {
    const c = obj(r.ci, EVIDENCE_KEYS.ci, "ci");
    ci = {
      requiredChecks: ids(c.requiredChecks, "ci.requiredChecks"),
      headSha: sha(c.headSha, "ci.headSha"),
      trusted: bool(c.trusted, "ci.trusted"),
      checks: list(c.checks, "ci.checks").map((x, i) => {
        const o = obj(x, EVIDENCE_KEYS.ciCheck, `ci.checks[${i}]`);
        return { name: id(o.name, `ci.checks[${i}].name`), outcome: oneOf(o.outcome, CHECK_OUTCOMES, `ci.checks[${i}].outcome`) };
      }),
    };
  }

  const acceptance = list(r.acceptance, "acceptance").map((a, i) => {
    const at = `acceptance[${i}]`;
    const o = obj(a, EVIDENCE_KEYS.acceptance, at);
    return {
      criterionId: id(o.criterionId, `${at}.criterionId`),
      status: oneOf(o.status, ACCEPTANCE_STATUSES, `${at}.status`),
      evidenceType: oneOf(o.evidenceType, ACCEPTANCE_EVIDENCE_TYPES, `${at}.evidenceType`),
      reference: o.reference === null ? null : id(o.reference, `${at}.reference`),
      ...summary(o.summary, `${at}.summary`),
      ...(o.confirmedFailureOnly === undefined ? {} : { confirmedFailureOnly: bool(o.confirmedFailureOnly, `${at}.confirmedFailureOnly`) }),
    };
  });

  let pr: ManagerEvidence["pr"] = null;
  if (r.pr !== null) {
    const p = obj(r.pr, EVIDENCE_KEYS.pr, "pr");
    const number = nonNegInt(p.number, "pr.number");
    if (number === 0) fail("pr.number must be positive");
    pr = { number, state: oneOf(p.state, PR_STATES, "pr.state") };
  }

  return {
    taskId: id(r.taskId, "taskId"),
    lineageId: id(r.lineageId, "lineageId"),
    taskState: oneOf(r.taskState, TASK_STATES, "taskState"),
    worker: {
      kind: oneOf(w.kind, WORKER_KINDS, "worker.kind"),
      status: oneOf(w.status, WORKER_RESULT_STATUSES, "worker.status"),
      errorType: w.errorType === null ? null : oneOf(w.errorType, WORKER_ERROR_TYPES, "worker.errorType"),
    },
    scope: { allowedScope: paths(s.allowedScope, "scope.allowedScope"), changedPaths: paths(s.changedPaths, "scope.changedPaths") },
    validations,
    ci,
    acceptanceCriteriaIds: ids(r.acceptanceCriteriaIds, "acceptanceCriteriaIds"),
    acceptance,
    risk: {
      stored: oneOf(rk.stored, RISK_LEVELS, "risk.stored"),
      observed: oneOf(rk.observed, RISK_LEVELS, "risk.observed"),
      approval: oneOf(rk.approval, APPROVAL_EVIDENCE_STATES, "risk.approval"),
    },
    branch: {
      assignedBranch: branchName(b.assignedBranch, "branch.assignedBranch"),
      plannedBaseSha: sha(b.plannedBaseSha, "branch.plannedBaseSha"),
      verifiedHeadSha: nullableSha(b.verifiedHeadSha, "branch.verifiedHeadSha"),
      workerBranch: branchName(b.workerBranch, "branch.workerBranch"),
      workerHeadSha: nullableSha(b.workerHeadSha, "branch.workerHeadSha"),
      workspaceProof: oneOf(b.workspaceProof, WORKSPACE_PROOF_STATES, "branch.workspaceProof"),
      branchPlanDecision: oneOf(b.branchPlanDecision, BRANCH_DECISIONS, "branch.branchPlanDecision"),
      baseFreshness: oneOf(b.baseFreshness, BASE_FRESHNESS, "branch.baseFreshness"),
      conflict: bool(b.conflict, "branch.conflict"),
    },
    pr,
    repair: {
      attempt: nonNegInt(rp.attempt, "repair.attempt"),
      prior: list(rp.prior, "repair.prior").map((x, i) => {
        const o = obj(x, EVIDENCE_KEYS.prior, `repair.prior[${i}]`);
        return {
          attempt: nonNegInt(o.attempt, `repair.prior[${i}].attempt`),
          decision: oneOf(o.decision, MANAGER_DECISIONS, `repair.prior[${i}].decision`),
          failedEvidenceIds: ids(o.failedEvidenceIds, `repair.prior[${i}].failedEvidenceIds`),
        };
      }),
    },
  };
}

/** Validates and canonicalizes untrusted evidence. Never throws. */
export function normalizeManagerEvidence(raw: unknown): NormalizeResult {
  try {
    return { ok: true, evidence: normalize(raw) };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.message };
    return { ok: false, reason: "evidence could not be normalized" };
  }
}
