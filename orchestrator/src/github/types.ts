/**
 * Phase 2C.3 GitHub read-only QA — types.
 *
 * Read-only by construction: nothing in orchestrator/src/github/ may merge,
 * push, write branches, mutate PRs, re-run checks, or call any GitHub write
 * API. HTTP/auth details live behind GitHubReadTransport and never reach the
 * QA domain logic. Normalized records carry only the minimal check metadata
 * QA needs — never tokens, headers, or full API response bodies.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

export const PR_STATES = ["open", "closed", "merged"] as const;
export type PullRequestState = (typeof PR_STATES)[number];

export interface PullRequestInfo {
  number: number;
  state: PullRequestState;
  draft: boolean;
  headSha: string;
  headRef: string;
  baseRef: string;
}

export type CheckSource = "check_run" | "status";

/** Normalized check-run or commit-status observation, bound to the SHA it ran on. */
export interface CheckObservation {
  source: CheckSource;
  name: string;
  headSha: string;
  /** GitHub App slug for check runs (e.g. "github-actions"); null for commit statuses. */
  appSlug: string | null;
  /** Lowercased raw status (check runs) or state (commit statuses). */
  status: string;
  /** Lowercased raw conclusion; null while not completed or for commit statuses. */
  conclusion: string | null;
}

/** A check that must succeed on the exact PR head SHA before QA passes. */
export interface RequiredCheck {
  name: string;
  /** When set, only observations from this source satisfy the requirement. */
  source?: CheckSource;
  /** When set, only check runs reported by this GitHub App satisfy the requirement. */
  appSlug?: string;
}

/**
 * Required checks for OXM CI (.github/workflows/ci.yml, workflow "CI",
 * on: pull_request). The GitHub UI labels them "CI / verify (pull_request)"
 * and "CI / full-test (pull_request)", but the check-runs API reports the
 * job `name:` — "verify" / "full-test" — from the github-actions app.
 */
export const DEFAULT_REQUIRED_CHECKS: readonly RequiredCheck[] = [
  { name: "verify", source: "check_run", appSlug: "github-actions" },
  { name: "full-test", source: "check_run", appSlug: "github-actions" },
];

export const QA_STATUSES = ["pending", "passed", "failed", "blocked", "unknown"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

/** Per-required-check outcome. "missing" = no matching observation on the head SHA. */
export type CheckOutcome = "success" | "pending" | "failed" | "blocked" | "unknown" | "missing";

export interface RequiredCheckResult {
  name: string;
  outcome: CheckOutcome;
  /** Matching observations on the exact head SHA (duplicates > 1). */
  observed: number;
  /** Observations with this name ignored because they ran on another SHA. */
  staleShaIgnored: number;
}

export interface QaDecision {
  status: QaStatus;
  prNumber: number;
  headSha: string;
  /** Deterministically ordered, human-readable reasons. */
  reasons: string[];
  checks: RequiredCheckResult[];
}

// ---- Transport boundary (raw, minimal subsets of GitHub REST shapes) ----

export interface RawPullRequest {
  number: number;
  state: string;
  merged?: boolean | null;
  merged_at?: string | null;
  draft?: boolean | null;
  head: { sha: string; ref: string };
  base: { ref: string };
}

export interface RawCheckRun {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  app?: { slug?: string | null } | null;
}

export interface RawCommitStatus {
  context: string;
  state: string;
}

/**
 * Read-only transport. A future implementation may be backed by GitHub REST
 * or `gh api` (GET only). listCheckRuns must request `filter=latest` so that
 * re-runs of the same job do not appear as duplicates, and listCommitStatuses
 * must use the combined-status endpoint (latest state per context). Any
 * duplicates that still reach QA are resolved to the most severe result.
 */
export interface GitHubReadTransport {
  getPullRequest(repo: RepoRef, number: number): Promise<RawPullRequest>;
  listCheckRuns(repo: RepoRef, sha: string): Promise<RawCheckRun[]>;
  listCommitStatuses(repo: RepoRef, sha: string): Promise<RawCommitStatus[]>;
}

/** The only operations the orchestrator may perform against GitHub. */
export interface GitHubReadClient {
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestInfo>;
  getHeadSha(repo: RepoRef, number: number): Promise<string>;
  listChecksForSha(repo: RepoRef, sha: string): Promise<CheckObservation[]>;
}
