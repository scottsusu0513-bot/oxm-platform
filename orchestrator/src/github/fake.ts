import type { GitHubReadTransport, RawCheckRun, RawCommitStatus, RawPullRequest, RepoRef } from "./types";

/**
 * In-memory, read-only transport for tests and local dry runs. No network.
 * Seed data is copied on read so callers cannot mutate the fixture.
 */
export interface FakeGitHubData {
  pullRequests: Record<number, RawPullRequest | RawPullRequest[]>;
  checkRuns?: Record<string, RawCheckRun[]>;
  statuses?: Record<string, RawCommitStatus[]>;
}

export function createFakeGitHubTransport(data: FakeGitHubData): GitHubReadTransport & { calls: string[] } {
  const calls: string[] = [];
  const prReads: Record<number, number> = {};
  const key = (r: RepoRef) => `${r.owner}/${r.repo}`;
  return {
    calls,
    async getPullRequest(repo, number) {
      calls.push(`GET pr ${key(repo)}#${number}`);
      const entry = data.pullRequests[number];
      if (!entry) throw new Error("Not Found");
      // An array seeds successive reads (e.g. a head that moves mid-inspection).
      const seq = Array.isArray(entry) ? entry : [entry];
      const i = Math.min(prReads[number] ?? 0, seq.length - 1);
      prReads[number] = (prReads[number] ?? 0) + 1;
      return structuredClone(seq[i]);
    },
    async listCheckRuns(repo, sha) {
      calls.push(`GET check-runs ${key(repo)}@${sha}`);
      return structuredClone(data.checkRuns?.[sha] ?? []);
    },
    async listCommitStatuses(repo, sha) {
      calls.push(`GET statuses ${key(repo)}@${sha}`);
      return structuredClone(data.statuses?.[sha] ?? []);
    },
  };
}
