import { isValidRepo } from "../githubWrite/policy";
import type { RepoRef } from "../githubWrite/types";
import { approvalAuthorizes } from "../store/repositories";
import type { Approval } from "../store/types";
import type { ProcessRunner } from "../workers/types";
import { deployApprovalBinding } from "./approval";
import type { DeployApprovalEvidence, MergeError, TrustedPrState } from "./types";

const SHA = /^[0-9a-f]{40}$/;

/**
 * Trusted Git layer for the Owner-approved merge. Fixed argv templates over `gh api` (gh's own stored
 * auth; no token passes through this code), exec-file style. The only write is
 * `PUT pulls/<n>/merge` with `sha=<approved head>` — GitHub itself refuses the merge when the head moved.
 * There is no force, no admin override, no branch deletion, no direct push to main.
 */
export interface PrMergeTransport {
  getPr(prNumber: number): Promise<TrustedPrState | null>;
  mergeExact(prNumber: number, headSha: string): Promise<{ merged: boolean; sha: string | null }>;
}

export function createGhMergeTransport(runner: ProcessRunner, repoRoot: string, repo: RepoRef): PrMergeTransport {
  if (!isValidRepo(repo)) throw new Error("[delivery] invalid repository reference");
  const base = `repos/${repo.owner}/${repo.repo}/pulls`;
  const pr = (n: number) => {
    if (!Number.isInteger(n) || n <= 0) throw new Error("[delivery] invalid PR number");
    return String(n);
  };
  const gh = async (args: string[]) => {
    const res = await runner.spawn({ command: "gh", args: ["api", ...args], cwd: repoRoot }).exit;
    if (res.truncated) throw new Error("gh api output truncated");
    if (res.exitCode !== 0) return { ok: false as const, notFound: /HTTP 404/.test(res.stderr), conflict: /HTTP 40[59]/.test(res.stderr), json: null };
    try {
      return { ok: true as const, notFound: false, conflict: false, json: JSON.parse(res.stdout) as Record<string, unknown> };
    } catch {
      throw new Error("gh api returned malformed JSON");
    }
  };
  return {
    async getPr(n) {
      const r = await gh([`${base}/${pr(n)}`]);
      if (!r.ok) {
        if (r.notFound) return null;
        throw new Error("gh api get PR failed");
      }
      const j = r.json as { number?: unknown; state?: unknown; merged?: unknown; head?: { sha?: unknown }; base?: { ref?: unknown }; merge_commit_sha?: unknown };
      const headSha = String(j.head?.sha ?? "").toLowerCase();
      const mergeSha = typeof j.merge_commit_sha === "string" ? j.merge_commit_sha.toLowerCase() : null;
      if (j.number !== n || !SHA.test(headSha)) throw new Error("gh api returned a malformed PR");
      return { number: n, state: j.state === "open" ? "open" : "closed", merged: j.merged === true, headSha, baseRef: String(j.base?.ref ?? ""), mergeSha: mergeSha && SHA.test(mergeSha) ? mergeSha : null };
    },
    async mergeExact(n, headSha) {
      if (!SHA.test(headSha)) throw new Error("[delivery] refusing merge: invalid head SHA");
      const r = await gh(["--method", "PUT", `${base}/${pr(n)}/merge`, "-f", `sha=${headSha}`, "-f", "merge_method=merge"]);
      if (!r.ok) return { merged: false, sha: null };
      const sha = String(r.json?.sha ?? "").toLowerCase();
      return { merged: r.json?.merged === true, sha: SHA.test(sha) ? sha : null };
    },
  };
}

/**
 * Exact, Owner-approved merge. Every precondition is re-read from trusted sources right before the
 * write: approval kind/binding/expiry, deploy capability enabled, PR open + unmerged + base main +
 * head == the approved SHA. After the write the merge is re-read from GitHub (never assumed).
 */
export async function mergeApprovedPullRequest(
  deps: { transport: PrMergeTransport; enabled: boolean; now: () => string },
  input: { evidence: DeployApprovalEvidence; approval: Approval; binding: string },
): Promise<{ ok: true; mergeSha: string } | { ok: false; error: MergeError }> {
  if (!deps.enabled) return { ok: false, error: "deploy_capability_disabled" };
  let binding: string;
  try {
    binding = deployApprovalBinding(input.evidence);
  } catch {
    return { ok: false, error: "merge_rejected" };
  }
  if (binding !== input.binding) return { ok: false, error: "merge_rejected" };
  const authorized = approvalAuthorizes(input.approval, { taskId: input.evidence.taskId, kind: "deploy", bindingShaOrActionId: binding, at: deps.now() });
  if (!authorized.ok) return { ok: false, error: "merge_rejected" };
  let before: TrustedPrState | null;
  try {
    before = await deps.transport.getPr(input.evidence.prNumber);
  } catch {
    return { ok: false, error: "transport_failed" };
  }
  if (!before || before.state !== "open" || before.merged) return { ok: false, error: "pr_not_open" };
  if (before.baseRef !== "main") return { ok: false, error: "pr_base_not_main" };
  if (before.headSha !== input.evidence.headSha) return { ok: false, error: "pr_head_moved" };
  let merged: { merged: boolean; sha: string | null };
  try {
    merged = await deps.transport.mergeExact(input.evidence.prNumber, input.evidence.headSha);
  } catch {
    return { ok: false, error: "transport_failed" };
  }
  if (!merged.merged || !merged.sha) {
    // GitHub refused (moved head, failing required check, conflict): re-read to tell which.
    const after = await deps.transport.getPr(input.evidence.prNumber).catch(() => null);
    if (after && after.headSha !== input.evidence.headSha) return { ok: false, error: "pr_head_moved" };
    return { ok: false, error: "pr_not_mergeable" };
  }
  const after = await deps.transport.getPr(input.evidence.prNumber).catch(() => null);
  if (!after || !after.merged || after.headSha !== input.evidence.headSha || after.mergeSha !== merged.sha) return { ok: false, error: "merge_unverified" };
  return { ok: true, mergeSha: merged.sha };
}
