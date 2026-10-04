import type {
  CheckObservation,
  CheckOutcome,
  PullRequestInfo,
  QaDecision,
  QaStatus,
  RequiredCheck,
  RequiredCheckResult,
} from "./types";

/**
 * Deterministic QA evaluation and pure polling helpers. No I/O, timers,
 * env, clock, or randomness: the same inputs always yield the same decision.
 */

const SHA_RE = /^[0-9a-f]{40}$/;

const CHECK_RUN_PENDING = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const CONCLUSION_FAILED = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);
/** Completed without success and without a code failure: needs a human, polling will not fix it. */
const CONCLUSION_BLOCKED = new Set(["action_required", "stale", "skipped", "neutral"]);

/** Higher = more severe. Duplicates and the overall decision both take the most severe. */
const OUTCOME_SEVERITY: Record<CheckOutcome, number> = {
  success: 0,
  pending: 1,
  missing: 1,
  unknown: 2,
  blocked: 3,
  failed: 4,
};

export function classifyObservation(obs: CheckObservation): CheckOutcome {
  if (obs.source === "status") {
    if (obs.status === "success") return "success";
    if (obs.status === "pending") return "pending";
    if (obs.status === "failure" || obs.status === "error") return "failed";
    return "unknown";
  }
  if (CHECK_RUN_PENDING.has(obs.status)) return "pending";
  if (obs.status !== "completed") return "unknown";
  if (obs.conclusion === "success") return "success";
  if (obs.conclusion !== null && CONCLUSION_FAILED.has(obs.conclusion)) return "failed";
  if (obs.conclusion !== null && CONCLUSION_BLOCKED.has(obs.conclusion)) return "blocked";
  return "unknown";
}

function matchesRequirement(obs: CheckObservation, req: RequiredCheck): boolean {
  if (obs.name !== req.name) return false;
  if (req.source && obs.source !== req.source) return false;
  if (req.appSlug && obs.appSlug !== req.appSlug) return false;
  return true;
}

function worst(outcomes: readonly CheckOutcome[]): CheckOutcome {
  return outcomes.reduce((a, b) => (OUTCOME_SEVERITY[b] > OUTCOME_SEVERITY[a] ? b : a));
}

function requirementKey(req: RequiredCheck): string {
  return `${req.name}\u0000${req.source ?? ""}\u0000${req.appSlug ?? ""}`;
}

export interface QaInput {
  pr: PullRequestInfo;
  required: readonly RequiredCheck[];
  checks: readonly CheckObservation[];
}

export function evaluateQa(input: QaInput): QaDecision {
  const { pr } = input;
  const base = { prNumber: pr.number, headSha: pr.headSha };

  if (pr.state === "merged") {
    return { ...base, status: "blocked", checks: [], reasons: ["PR is already merged; QA cannot authorize it"] };
  }
  if (pr.state === "closed") {
    return { ...base, status: "blocked", checks: [], reasons: ["PR is closed; QA cannot authorize it"] };
  }
  if (pr.draft) {
    return { ...base, status: "blocked", checks: [], reasons: ["PR is still a draft; not ready for QA authorization"] };
  }
  if (!SHA_RE.test(pr.headSha)) {
    return { ...base, status: "unknown", checks: [], reasons: ["PR head SHA is not a 40-char hex SHA"] };
  }

  const seen = new Set<string>();
  const required = input.required.filter((r) => {
    const k = requirementKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (required.length === 0) {
    return { ...base, status: "blocked", checks: [], reasons: ["no required checks configured; refusing to pass vacuously"] };
  }

  const reasons: string[] = [];
  const results: RequiredCheckResult[] = required.map((req) => {
    const named = input.checks.filter((c) => matchesRequirement(c, req));
    const current = named.filter((c) => c.headSha === pr.headSha);
    const staleShaIgnored = named.length - current.length;
    if (staleShaIgnored > 0) {
      reasons.push(`${req.name}: ignored ${staleShaIgnored} result(s) from a SHA other than ${pr.headSha}`);
    }
    if (current.length === 0) {
      reasons.push(`${req.name}: not reported on head ${pr.headSha} yet`);
      return { name: req.name, outcome: "missing", observed: 0, staleShaIgnored };
    }
    const outcome = worst(current.map(classifyObservation));
    if (current.length > 1) {
      reasons.push(`${req.name}: ${current.length} results on the head SHA; using the most severe (${outcome})`);
    }
    if (outcome !== "success") {
      const detail = current.map((c) => `${c.status}/${c.conclusion ?? "-"}`).sort().join(", ");
      reasons.push(`${req.name}: ${outcome} (${detail})`);
    }
    return { name: req.name, outcome, observed: current.length, staleShaIgnored };
  });

  const overall = worst(results.map((r) => r.outcome));
  const status: QaStatus = overall === "success" ? "passed" : overall === "missing" ? "pending" : overall;
  if (status === "passed") reasons.push(`all ${results.length} required check(s) succeeded on ${pr.headSha}`);
  return { ...base, status, reasons, checks: results };
}

// ---- Polling (pure: callers own timers and loops) ----

export interface PollPolicy {
  /** Total inspections allowed before a still-pending decision is given up as blocked. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_POLL_POLICY: PollPolicy = { maxAttempts: 60, baseDelayMs: 30_000, maxDelayMs: 120_000 };

export type PollStep =
  | { action: "poll"; delayMs: number; reason: string }
  | { action: "stop"; finalStatus: QaStatus; reason: string };

/**
 * Decides whether to inspect again. `attempt` is the 1-based number of
 * inspections already performed. Only "pending" polls; "unknown" fails closed
 * and stops; an exhausted pending budget stops as "blocked".
 */
export function nextPollStep(decision: QaDecision, attempt: number, policy: PollPolicy = DEFAULT_POLL_POLICY): PollStep {
  if (decision.status !== "pending") {
    return { action: "stop", finalStatus: decision.status, reason: `QA ${decision.status}` };
  }
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= policy.maxAttempts) {
    return { action: "stop", finalStatus: "blocked", reason: `QA still pending after ${attempt} attempt(s); giving up` };
  }
  const delayMs = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return { action: "poll", delayMs, reason: "QA pending" };
}
