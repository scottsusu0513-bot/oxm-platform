import { checkTaskBranchName, isValidSha } from "../branches/naming";
import type { ProcessRunner } from "../workers/types";
import { isValidRepo } from "./policy";
import {
  PR_BASE_BRANCH,
  type GitHubWriteTransport,
  type GitPushTransport,
  type RawRef,
  type RawWritePullRequest,
  type RepoRef,
} from "./types";

/**
 * Real transports over the injected ProcessRunner (exec-file style,
 * shell: false — see workers/processRunner.ts). Every invocation is a fixed
 * argv template; caller data only ever appears as validated branch/SHA/repo
 * values or as a single `-f key=value` argument (sent as a raw string field,
 * never interpreted by a shell or as a file reference). Outputs are parsed
 * down to the minimal fields; errors never echo stdout/stderr.
 *
 * Push uses plain `git push <remote> <sha>:refs/heads/<branch>`: no force,
 * no force-with-lease, no "+" refspec, no other refs, no tags.
 */

export const PUSH_REMOTE = "origin";

/** Argv for the only push this layer can perform. Throws on anything but a task branch + SHA. */
export function buildPushArgs(branch: string, localSha: string): string[] {
  const name = checkTaskBranchName(branch);
  if (!name.ok) throw new Error(`refusing push: ${name.reason}`);
  if (!isValidSha(localSha)) throw new Error("refusing push: invalid local SHA");
  return ["push", "--porcelain", PUSH_REMOTE, `${localSha}:refs/heads/${branch}`];
}

export function createGitPushTransport(runner: ProcessRunner, repoRoot: string): GitPushTransport {
  return {
    async pushBranch(branch, localSha) {
      const args = buildPushArgs(branch, localSha);
      const res = await runner.spawn({ command: "git", args, cwd: repoRoot }).exit;
      if (res.exitCode !== 0 || res.truncated) throw new Error("git push failed");
    },
  };
}

const ghRepoPath = (repo: RepoRef) => {
  if (!isValidRepo(repo)) throw new Error("invalid repository reference");
  return `repos/${repo.owner}/${repo.repo}`;
};

const branchArg = (branch: string) => {
  if (branch === PR_BASE_BRANCH) return branch; // read-only lookup of the base head
  const name = checkTaskBranchName(branch);
  if (!name.ok) throw new Error(`invalid branch: ${name.reason}`);
  return branch;
};

const prNumberArg = (n: number) => {
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid PR number");
  return String(n);
};

function pickPr(json: unknown): RawWritePullRequest {
  const j = json as RawWritePullRequest;
  return {
    number: j?.number,
    state: String(j?.state),
    draft: j?.draft === true,
    merged: j?.merged === true,
    head: { ref: String(j?.head?.ref), sha: String(j?.head?.sha) },
    base: { ref: String(j?.base?.ref) },
  };
}

/** GitHub REST via `gh api` (uses gh's own stored auth; no token passes through this code). */
export function createGhCliWriteTransport(runner: ProcessRunner, repoRoot: string): GitHubWriteTransport {
  const gh = async (args: string[]): Promise<{ ok: boolean; notFound: boolean; json: unknown }> => {
    const res = await runner.spawn({ command: "gh", args: ["api", ...args], cwd: repoRoot }).exit;
    if (res.truncated) throw new Error("gh api output truncated");
    if (res.exitCode !== 0) return { ok: false, notFound: /HTTP 404/.test(res.stderr), json: null };
    try {
      return { ok: true, notFound: false, json: JSON.parse(res.stdout) };
    } catch {
      throw new Error("gh api returned malformed JSON");
    }
  };
  const must = (r: { ok: boolean; json: unknown }, op: string) => {
    if (!r.ok) throw new Error(`gh api ${op} failed`);
    return r.json;
  };

  return {
    async getBranchHead(repo, branch) {
      const r = await gh([`${ghRepoPath(repo)}/git/ref/heads/${branchArg(branch)}`]);
      if (!r.ok && r.notFound) return null;
      const sha = String((must(r, "get ref") as RawRef)?.object?.sha ?? "").toLowerCase();
      if (!isValidSha(sha)) throw new Error("gh api returned an invalid ref SHA");
      return sha;
    },
    async createBranchRef(repo, branch, sha) {
      const name = checkTaskBranchName(branch);
      if (!name.ok || !isValidSha(sha)) throw new Error("refusing ref creation: invalid branch or SHA");
      const json = must(
        await gh(["--method", "POST", `${ghRepoPath(repo)}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]),
        "create ref",
      ) as RawRef;
      return { ref: String(json?.ref), object: { sha: String(json?.object?.sha) } };
    },
    async createPullRequest(repo, input) {
      if (input.base !== PR_BASE_BRANCH) throw new Error("PR base must be main");
      const head = branchArg(input.head);
      if (head === PR_BASE_BRANCH) throw new Error("PR head cannot be main");
      const existing = must(
        await gh([
          `${ghRepoPath(repo)}/pulls?state=open&head=${repo.owner}:${head}&base=${PR_BASE_BRANCH}&per_page=2`,
        ]),
        "find existing PR",
      );
      if (!Array.isArray(existing))
        throw new Error("gh api returned malformed PR list");
      if (existing.length > 1)
        throw new Error("multiple open pull requests exist for the task branch");
      if (existing.length === 1) return pickPr(existing[0]);
      const json = must(
        await gh([
          "--method",
          "POST",
          `${ghRepoPath(repo)}/pulls`,
          "-f",
          `base=${PR_BASE_BRANCH}`,
          "-f",
          `head=${head}`,
          "-f",
          `title=${input.title}`,
          "-f",
          `body=${input.body}`,
          "-F",
          `draft=${input.draft === true ? "true" : "false"}`,
        ]),
        "create PR",
      );
      return pickPr(json);
    },
    async getPullRequest(repo, number) {
      return pickPr(must(await gh([`${ghRepoPath(repo)}/pulls/${prNumberArg(number)}`]), "get PR"));
    },
    async updatePullRequestText(repo, number, input) {
      const json = must(
        await gh([
          "--method",
          "PATCH",
          `${ghRepoPath(repo)}/pulls/${prNumberArg(number)}`,
          "-f",
          `title=${input.title}`,
          "-f",
          `body=${input.body}`,
        ]),
        "update PR text",
      );
      return pickPr(json);
    },
  };
}
