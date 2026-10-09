/**
 * Phase 2C.5 GitHub write layer — types.
 *
 * Deliberately narrow and separate from the read-only QA client. The ONLY
 * write capabilities are:
 *   - create a task branch at an exact planned base SHA
 *   - fast-forward push of an assigned task branch to an explicit local SHA
 *   - open a PR from the assigned task branch into main
 *   - update an open task PR's title/body
 * There is no operation for merging, closing, approving, deleting refs,
 * force pushing, pushing main/master, bypassing checks, or changing branch
 * protection / admin settings — neither on the client nor on the transports.
 */
import type { CommitRelation } from "../branches/taskBase";
import type { RepoRef } from "../github/types";

export type { RepoRef };

export const PR_BASE_BRANCH = "main" as const;

// ---- Transport boundary (raw, minimal subsets of GitHub REST shapes) ----

export interface RawRef {
  ref: string;
  object: { sha: string };
}

export interface RawWritePullRequest {
  number: number;
  state: string;
  draft?: boolean | null;
  merged?: boolean | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}

export interface NewPullRequestInput {
  base: typeof PR_BASE_BRANCH;
  head: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface PullRequestTextInput {
  title: string;
  body: string;
}

/** Read-only GitHub compare of two exact commits (null: either commit is unknown to the remote). */
export interface CommitComparer {
  compareCommits(repo: RepoRef, baseSha: string, headSha: string): Promise<CommitRelation | null>;
}

/**
 * Raw GitHub operations. Each method maps to exactly one fixed request; no
 * method accepts a free-form endpoint, HTTP method, or extra fields.
 */
export interface GitHubWriteTransport {
  /** Head SHA of refs/heads/<branch>; null when the branch does not exist. */
  getBranchHead(repo: RepoRef, branch: string): Promise<string | null>;
  /** Creates refs/heads/<branch> at sha. Fails if the ref already exists (never moves a ref). */
  createBranchRef(repo: RepoRef, branch: string, sha: string): Promise<RawRef>;
  createPullRequest(repo: RepoRef, input: NewPullRequestInput): Promise<RawWritePullRequest>;
  getPullRequest(repo: RepoRef, number: number): Promise<RawWritePullRequest>;
  updatePullRequestText(repo: RepoRef, number: number, input: PullRequestTextInput): Promise<RawWritePullRequest>;
}

/** Non-force push of an explicit local commit to refs/heads/<branch> on the fixed remote. */
export interface GitPushTransport {
  pushBranch(branch: string, localSha: string): Promise<void>;
}

// ---- Client results ----

export const WRITE_ERRORS = [
  "policy_violation",
  "replan_required",
  "branch_exists",
  "branch_missing",
  "remote_moved",
  "verification_failed",
  "transport_error",
] as const;
export type WriteErrorType = (typeof WRITE_ERRORS)[number];

export type WriteResult<T> = ({ ok: true } & T) | { ok: false; error: WriteErrorType; reason: string };

export interface BranchCreation {
  taskId: string;
  branch: string;
  baseSha: string;
  /** True when the branch already existed at exactly the planned base SHA. */
  alreadyExisted: boolean;
}

/** Proof that the assigned branch was pushed and the remote head verified. Issued only by the client. */
export interface PushReceipt {
  readonly taskId: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly previousRemoteSha: string;
}

/** A PR as reported by GitHub and verified by the client. The only trusted PR number source. */
export interface TrustedPullRequest {
  readonly taskId: string;
  readonly number: number;
  readonly branch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly draft: boolean;
}

/** Explicit orchestrator policy; there is no default draft/ready choice. */
export interface PrOpenPolicy {
  draft: boolean;
}

/** Sanitized task metadata for PR text. Never a raw prompt. */
export interface PrTaskMetadata {
  title: string;
  summary: string;
  acceptanceCriteria: readonly string[];
}

export interface GitHubWriteClient {
  createTaskBranch(plan: unknown): Promise<WriteResult<{ creation: BranchCreation }>>;
  pushTaskBranch(
    plan: unknown,
    input: { localHeadSha: string; expectedRemoteSha: string },
  ): Promise<WriteResult<{ receipt: PushReceipt }>>;
  openPullRequest(
    plan: unknown,
    receipt: unknown,
    meta: PrTaskMetadata,
    policy: PrOpenPolicy,
  ): Promise<WriteResult<{ pr: TrustedPullRequest }>>;
  updatePullRequestText(plan: unknown, pr: unknown, meta: PrTaskMetadata): Promise<WriteResult<{ pr: TrustedPullRequest }>>;
}
