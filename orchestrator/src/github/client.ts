import { evaluateQa } from "./qa";
import type {
  CheckObservation,
  GitHubReadClient,
  GitHubReadTransport,
  PullRequestInfo,
  PullRequestState,
  QaDecision,
  RawCheckRun,
  RawCommitStatus,
  RawPullRequest,
  RepoRef,
  RequiredCheck,
} from "./types";

/**
 * Read-only GitHub client over an injected transport. Normalizes raw
 * responses down to the fields QA needs; everything else is dropped.
 */

export function normalizePullRequest(raw: RawPullRequest): PullRequestInfo {
  const merged = raw.merged === true || (typeof raw.merged_at === "string" && raw.merged_at !== "");
  const rawState = String(raw.state).toLowerCase();
  // Anything other than a clean "open" that is not merged is treated as closed.
  const state: PullRequestState = merged ? "merged" : rawState === "open" ? "open" : "closed";
  return {
    number: raw.number,
    state,
    draft: raw.draft === true,
    headSha: String(raw.head.sha).toLowerCase(),
    headRef: String(raw.head.ref),
    baseRef: String(raw.base.ref),
  };
}

export function normalizeCheckRun(raw: RawCheckRun): CheckObservation {
  return {
    source: "check_run",
    name: String(raw.name),
    headSha: String(raw.head_sha).toLowerCase(),
    appSlug: raw.app?.slug ? String(raw.app.slug) : null,
    status: String(raw.status).toLowerCase(),
    conclusion: raw.conclusion == null ? null : String(raw.conclusion).toLowerCase(),
  };
}

/** Commit statuses carry no SHA of their own; bind them to the SHA that was queried. */
export function normalizeCommitStatus(raw: RawCommitStatus, sha: string): CheckObservation {
  return {
    source: "status",
    name: String(raw.context),
    headSha: sha.toLowerCase(),
    appSlug: null,
    status: String(raw.state).toLowerCase(),
    conclusion: null,
  };
}

export function createGitHubReadClient(transport: GitHubReadTransport): GitHubReadClient {
  const getPullRequest = async (repo: RepoRef, number: number) =>
    normalizePullRequest(await transport.getPullRequest(repo, number));
  return {
    getPullRequest,
    getHeadSha: async (repo, number) => (await getPullRequest(repo, number)).headSha,
    listChecksForSha: async (repo, sha) => {
      const [runs, statuses] = await Promise.all([
        transport.listCheckRuns(repo, sha),
        transport.listCommitStatuses(repo, sha),
      ]);
      return [
        ...runs.map(normalizeCheckRun),
        ...statuses.map((s) => normalizeCommitStatus(s, sha)),
      ];
    },
  };
}

export interface QaInspection {
  decision: QaDecision;
  pr: PullRequestInfo | null;
}

/**
 * One read-only QA inspection: read PR, read checks for its head SHA, then
 * re-read the PR so a head that moved mid-inspection is evaluated against the
 * new SHA (the old SHA's checks are then ignored). Transport errors fail
 * closed as "unknown" without echoing error messages (which could carry
 * request details).
 */
export async function inspectPullRequestQa(
  client: GitHubReadClient,
  repo: RepoRef,
  prNumber: number,
  required: readonly RequiredCheck[],
): Promise<QaInspection> {
  try {
    const before = await client.getPullRequest(repo, prNumber);
    if (before.state !== "open") return { pr: before, decision: evaluateQa({ pr: before, required, checks: [] }) };
    const checks = await client.listChecksForSha(repo, before.headSha);
    const after = await client.getPullRequest(repo, prNumber);
    const decision = evaluateQa({ pr: after, required, checks });
    if (after.headSha !== before.headSha) {
      decision.reasons.unshift(`PR head moved from ${before.headSha} to ${after.headSha} during inspection`);
    }
    return { pr: after, decision };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "non-Error";
    return {
      pr: null,
      decision: {
        status: "unknown",
        prNumber,
        headSha: "",
        reasons: [`GitHub read failed (${kind}); failing closed`],
        checks: [],
      },
    };
  }
}
