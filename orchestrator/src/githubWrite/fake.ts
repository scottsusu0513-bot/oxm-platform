import type {
  GitHubWriteTransport,
  GitPushTransport,
  NewPullRequestInput,
  PullRequestTextInput,
  RawRef,
  RawWritePullRequest,
  RepoRef,
} from "./types";

/**
 * In-memory write transports for tests and dry runs. No network, no git.
 * Behaves like GitHub for the narrow operations exposed: ref creation never
 * moves an existing ref, and pushes are fast-forward only (the fake tracks
 * commit parents so a non-descendant push is rejected like a real remote).
 */

export interface FakeRemoteSeed {
  refs: Record<string, string>;
  /** child SHA -> parent SHA, used to decide fast-forward pushes. */
  parents?: Record<string, string>;
}

export interface FakeRemote extends GitHubWriteTransport, GitPushTransport {
  calls: string[];
  refs: Map<string, string>;
  prs: Map<number, RawWritePullRequest>;
  /** Hooks for simulating concurrent remote changes or misbehaving responses. */
  hooks: {
    beforeGetBranchHead?: (branch: string, readCount: number) => void;
    mutatePrResponse?: (raw: RawWritePullRequest) => RawWritePullRequest;
    failOn?: string;
  };
}

export function createFakeRemote(seed: FakeRemoteSeed): FakeRemote {
  const refs = new Map(Object.entries(seed.refs));
  const parents = new Map(Object.entries(seed.parents ?? {}));
  const prs = new Map<number, RawWritePullRequest>();
  const calls: string[] = [];
  const reads: Record<string, number> = {};
  let nextPr = 100;
  const hooks: FakeRemote["hooks"] = {};
  const key = (r: RepoRef) => `${r.owner}/${r.repo}`;
  const guard = (op: string) => {
    if (hooks.failOn === op) throw new Error("simulated transport failure: Authorization: Bearer ghp_simulatedsecret123");
  };
  const isAncestor = (anc: string, sha: string) => {
    for (let cur: string | undefined = sha; cur; cur = parents.get(cur)) if (cur === anc) return true;
    return false;
  };
  const out = (raw: RawWritePullRequest) => structuredClone(hooks.mutatePrResponse ? hooks.mutatePrResponse(raw) : raw);

  return {
    calls,
    refs,
    prs,
    hooks,
    async getBranchHead(repo, branch) {
      calls.push(`GET ref ${key(repo)} ${branch}`);
      guard("getBranchHead");
      reads[branch] = (reads[branch] ?? 0) + 1;
      hooks.beforeGetBranchHead?.(branch, reads[branch]);
      return refs.get(branch) ?? null;
    },
    async createBranchRef(repo, branch, sha): Promise<RawRef> {
      calls.push(`CREATE ref ${key(repo)} ${branch}@${sha}`);
      guard("createBranchRef");
      if (refs.has(branch)) throw new Error("Reference already exists");
      refs.set(branch, sha);
      return { ref: `refs/heads/${branch}`, object: { sha } };
    },
    async pushBranch(branch, localSha) {
      calls.push(`PUSH ${localSha}:refs/heads/${branch}`);
      guard("pushBranch");
      const current = refs.get(branch);
      if (current && !isAncestor(current, localSha)) throw new Error("non-fast-forward rejected");
      refs.set(branch, localSha);
    },
    async createPullRequest(repo, input: NewPullRequestInput) {
      calls.push(`CREATE pr ${key(repo)} ${input.head}->${input.base} draft=${input.draft}`);
      guard("createPullRequest");
      const raw: RawWritePullRequest = {
        number: nextPr++,
        state: "open",
        draft: input.draft,
        merged: false,
        head: { ref: input.head, sha: refs.get(input.head) ?? "" },
        base: { ref: input.base },
      };
      prs.set(raw.number, { ...raw, ...{ title: input.title, body: input.body } } as RawWritePullRequest);
      return out(raw);
    },
    async getPullRequest(repo, number) {
      calls.push(`GET pr ${key(repo)}#${number}`);
      const pr = prs.get(number);
      if (!pr) throw new Error("Not Found");
      return out(pr);
    },
    async updatePullRequestText(repo, number, input: PullRequestTextInput) {
      calls.push(`UPDATE pr-text ${key(repo)}#${number}`);
      const pr = prs.get(number);
      if (!pr) throw new Error("Not Found");
      const next = { ...pr, title: input.title, body: input.body } as RawWritePullRequest;
      prs.set(number, next);
      return out(next);
    },
  };
}
