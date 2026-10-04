import { isValidSha } from "../branches/naming";
import { checkAssignedPlan, buildPrText, isValidRepo } from "./policy";
import {
  PR_BASE_BRANCH,
  type GitHubWriteClient,
  type GitHubWriteTransport,
  type GitPushTransport,
  type PushReceipt,
  type RawWritePullRequest,
  type RepoRef,
  type TrustedPullRequest,
  type WriteErrorType,
  type WriteResult,
} from "./types";

/**
 * Narrow GitHub write client. Every operation re-checks the planner-issued
 * plan, reads remote state before acting, and verifies remote state after.
 * Receipts and trusted PRs are frozen and registered here, so a fabricated
 * object (e.g. a worker-reported PR number) is never accepted downstream.
 * Transport errors fail closed without echoing messages (which could carry
 * request details or tokens).
 */

const receipts = new WeakSet<object>();
const trustedPrs = new WeakSet<object>();

export function isVerifiedPushReceipt(value: unknown): value is PushReceipt {
  return typeof value === "object" && value !== null && receipts.has(value);
}

export function isTrustedPullRequest(value: unknown): value is TrustedPullRequest {
  return typeof value === "object" && value !== null && trustedPrs.has(value);
}

const fail = (error: WriteErrorType, reason: string) => ({ ok: false as const, error, reason });

function transportFailure(op: string, err: unknown) {
  const kind = err instanceof Error ? err.name : "non-Error";
  return fail("transport_error", `${op} failed (${kind}); failing closed`);
}

/** Validates a GitHub PR response against what we asked for; returns a reason when untrusted. */
function verifyPr(raw: RawWritePullRequest, branch: string, headSha: string): string | null {
  if (!raw || typeof raw !== "object") return "malformed PR response";
  if (!Number.isInteger(raw.number) || raw.number <= 0) return "PR response has no valid number";
  if (raw.merged === true || String(raw.state).toLowerCase() !== "open") return "PR is not open";
  if (raw.base?.ref !== PR_BASE_BRANCH) return "PR base is not main";
  if (raw.head?.ref !== branch) return "PR head is not the assigned branch";
  if (String(raw.head?.sha).toLowerCase() !== headSha) return "PR head SHA does not match the pushed SHA";
  return null;
}

export function createGitHubWriteClient(
  repo: RepoRef,
  deps: { transport: GitHubWriteTransport; push: GitPushTransport },
): GitHubWriteClient {
  if (!isValidRepo(repo)) throw new Error("invalid repository reference");
  const { transport, push } = deps;
  const target: RepoRef = Object.freeze({ owner: repo.owner, repo: repo.repo });

  const client: GitHubWriteClient = {
    async createTaskBranch(plan: unknown) {
      const check = checkAssignedPlan(plan, ["new_branch"]);
      if (!check.ok) return fail("policy_violation", check.reason);
      const p = check.plan;
      try {
        const baseHead = await transport.getBranchHead(target, PR_BASE_BRANCH);
        if (baseHead !== p.baseSha) {
          return fail("replan_required", `${PR_BASE_BRANCH} moved from planned ${p.baseSha} to ${baseHead ?? "(missing)"}`);
        }
        const existing = await transport.getBranchHead(target, p.branch);
        if (existing !== null) {
          if (existing !== p.baseSha) return fail("branch_exists", `${p.branch} already exists at a different SHA`);
          return { ok: true as const, creation: { taskId: p.taskId, branch: p.branch, baseSha: p.baseSha, alreadyExisted: true } };
        }
        const created = await transport.createBranchRef(target, p.branch, p.baseSha);
        if (created?.ref !== `refs/heads/${p.branch}` || String(created?.object?.sha).toLowerCase() !== p.baseSha) {
          return fail("verification_failed", "created ref does not match the planned branch/base SHA");
        }
        const after = await transport.getBranchHead(target, p.branch);
        if (after !== p.baseSha) return fail("verification_failed", "remote branch head is not the planned base SHA");
        return { ok: true as const, creation: { taskId: p.taskId, branch: p.branch, baseSha: p.baseSha, alreadyExisted: false } };
      } catch (err) {
        return transportFailure("branch creation", err);
      }
    },

    async pushTaskBranch(plan: unknown, input: { localHeadSha: string; expectedRemoteSha: string }) {
      const check = checkAssignedPlan(plan, ["new_branch", "reuse_branch"]);
      if (!check.ok) return fail("policy_violation", check.reason);
      const p = check.plan;
      if (!isValidSha(input?.localHeadSha)) return fail("policy_violation", "explicit 40-hex local HEAD SHA is required");
      if (!isValidSha(input?.expectedRemoteSha)) return fail("policy_violation", "explicit expected remote SHA is required");
      if (p.decision === "reuse_branch" && input.expectedRemoteSha !== p.headSha) {
        return fail("policy_violation", "expected remote SHA must be the planned reuse head");
      }
      try {
        const remote = await transport.getBranchHead(target, p.branch);
        if (remote === null) return fail("branch_missing", `${p.branch} does not exist on the remote; create it first`);
        if (remote !== input.expectedRemoteSha) {
          return fail("remote_moved", `${p.branch} is at ${remote}, expected ${input.expectedRemoteSha}; refusing to push`);
        }
        if (remote !== input.localHeadSha) await push.pushBranch(p.branch, input.localHeadSha);
        const after = await transport.getBranchHead(target, p.branch);
        if (after !== input.localHeadSha) return fail("verification_failed", "remote branch head does not match the pushed SHA");
        const receipt: PushReceipt = Object.freeze({
          taskId: p.taskId,
          branch: p.branch,
          baseSha: p.baseSha,
          headSha: input.localHeadSha,
          previousRemoteSha: remote,
        });
        receipts.add(receipt);
        return { ok: true as const, receipt };
      } catch (err) {
        return transportFailure("push", err);
      }
    },

    async openPullRequest(plan: unknown, receipt: unknown, meta, policy) {
      const check = checkAssignedPlan(plan, ["new_branch", "reuse_branch"]);
      if (!check.ok) return fail("policy_violation", check.reason);
      const p = check.plan;
      if (!isVerifiedPushReceipt(receipt)) return fail("policy_violation", "a verified push receipt is required to open a PR");
      if (receipt.branch !== p.branch || receipt.taskId !== p.taskId) {
        return fail("policy_violation", "push receipt does not belong to this plan");
      }
      if (typeof policy?.draft !== "boolean") return fail("policy_violation", "explicit draft/ready policy is required");
      if (p.decision === "reuse_branch" && p.prNumber !== null) {
        return fail("policy_violation", "lineage branch already has an open PR; update it instead");
      }
      try {
        const remote = await transport.getBranchHead(target, p.branch);
        if (remote !== receipt.headSha) return fail("remote_moved", "remote branch moved after the verified push");
        const text = buildPrText(p.taskId, p.branch, meta);
        const raw = await transport.createPullRequest(target, {
          base: PR_BASE_BRANCH,
          head: p.branch,
          title: text.title,
          body: text.body,
          draft: policy.draft,
        });
        const bad = verifyPr(raw, p.branch, receipt.headSha);
        if (bad) return fail("verification_failed", bad);
        const pr: TrustedPullRequest = Object.freeze({
          taskId: p.taskId,
          number: raw.number,
          branch: p.branch,
          baseSha: p.baseSha,
          headSha: receipt.headSha,
          draft: raw.draft === true,
        });
        trustedPrs.add(pr);
        return { ok: true as const, pr };
      } catch (err) {
        return transportFailure("PR creation", err);
      }
    },

    async updatePullRequestText(plan: unknown, pr: unknown, meta) {
      const check = checkAssignedPlan(plan, ["new_branch", "reuse_branch"]);
      if (!check.ok) return fail("policy_violation", check.reason);
      const p = check.plan;
      if (!isTrustedPullRequest(pr)) return fail("policy_violation", "only a trusted PR can be updated");
      if (pr.branch !== p.branch) return fail("policy_violation", "PR does not belong to this plan's branch");
      try {
        const current = await transport.getPullRequest(target, pr.number);
        const headSha = String(current?.head?.sha).toLowerCase();
        const bad = verifyPr(current, p.branch, headSha);
        if (bad) return fail("verification_failed", bad);
        const text = buildPrText(p.taskId, p.branch, meta);
        const raw = await transport.updatePullRequestText(target, pr.number, text);
        const badAfter = verifyPr(raw, p.branch, headSha);
        if (badAfter || raw.number !== pr.number) return fail("verification_failed", badAfter ?? "PR number changed");
        const updated: TrustedPullRequest = Object.freeze({ ...pr, headSha, draft: raw.draft === true });
        trustedPrs.add(updated);
        return { ok: true as const, pr: updated };
      } catch (err) {
        return transportFailure("PR update", err);
      }
    },
  };
  return Object.freeze(client);
}
