import { describe, expect, it } from "vitest";
import { createGitHubReadClient, inspectPullRequestQa, normalizePullRequest } from "./client";
import { createFakeGitHubTransport } from "./fake";
import { DEFAULT_REQUIRED_CHECKS, type GitHubReadTransport, type RawPullRequest } from "./types";

const repo = { owner: "o", repo: "r" };
const HEAD = "a".repeat(40);
const NEW = "c".repeat(40);
const rawPr = (over: Partial<RawPullRequest> = {}): RawPullRequest => ({
  number: 5,
  state: "open",
  merged: false,
  draft: false,
  head: { sha: HEAD, ref: "agent/x" },
  base: { ref: "main" },
  ...over,
});
const greenRuns = (sha: string) => [
  { name: "verify", head_sha: sha, status: "completed", conclusion: "success", app: { slug: "github-actions" } },
  { name: "full-test", head_sha: sha, status: "completed", conclusion: "success", app: { slug: "github-actions" } },
];

describe("GitHub read client", () => {
  it("exposes only read operations", () => {
    const client = createGitHubReadClient(createFakeGitHubTransport({ pullRequests: {} }));
    expect(Object.keys(client).sort()).toEqual(["getHeadSha", "getPullRequest", "listChecksForSha"]);
    const transport = createFakeGitHubTransport({ pullRequests: {} });
    expect(Object.keys(transport).sort()).toEqual(["calls", "getPullRequest", "listCheckRuns", "listCommitStatuses"]);
  });

  it("normalizes PR state and drops extra response fields", () => {
    const extra = { ...rawPr(), user: { login: "x" }, _links: {}, body: "token ghp_xxx" } as RawPullRequest;
    expect(normalizePullRequest(extra)).toEqual({ number: 5, state: "open", draft: false, headSha: HEAD, headRef: "agent/x", baseRef: "main" });
    expect(normalizePullRequest(rawPr({ state: "closed", merged: true })).state).toBe("merged");
    expect(normalizePullRequest(rawPr({ state: "closed", merged: null, merged_at: "2026-01-01T00:00:00Z" })).state).toBe("merged");
    expect(normalizePullRequest(rawPr({ state: "closed" })).state).toBe("closed");
    expect(normalizePullRequest(rawPr({ state: "???" })).state).toBe("closed");
  });

  it("merges check runs and commit statuses, binding statuses to the queried SHA", async () => {
    const client = createGitHubReadClient(
      createFakeGitHubTransport({
        pullRequests: { 5: rawPr() },
        checkRuns: { [HEAD]: [{ name: "verify", head_sha: HEAD, status: "QUEUED", conclusion: null, app: null }] },
        statuses: { [HEAD]: [{ context: "ext", state: "success" }] },
      }),
    );
    expect(await client.getHeadSha(repo, 5)).toBe(HEAD);
    expect(await client.listChecksForSha(repo, HEAD)).toEqual([
      { source: "check_run", name: "verify", headSha: HEAD, appSlug: null, status: "queued", conclusion: null },
      { source: "status", name: "ext", headSha: HEAD, appSlug: null, status: "success", conclusion: null },
    ]);
  });
});

describe("inspectPullRequestQa", () => {
  it("passes with all required checks green on the head SHA (GET-only calls)", async () => {
    const t = createFakeGitHubTransport({ pullRequests: { 5: rawPr() }, checkRuns: { [HEAD]: greenRuns(HEAD) } });
    const r = await inspectPullRequestQa(createGitHubReadClient(t), repo, 5, DEFAULT_REQUIRED_CHECKS);
    expect(r.decision.status).toBe("passed");
    expect(t.calls.every((c) => c.startsWith("GET "))).toBe(true);
  });

  it("re-evaluates against a head that moved mid-inspection; old checks do not count", async () => {
    const t = createFakeGitHubTransport({
      pullRequests: { 5: [rawPr(), rawPr({ head: { sha: NEW, ref: "agent/x" } })] },
      checkRuns: { [HEAD]: greenRuns(HEAD) },
    });
    const r = await inspectPullRequestQa(createGitHubReadClient(t), repo, 5, DEFAULT_REQUIRED_CHECKS);
    expect(r.decision.status).toBe("pending");
    expect(r.decision.headSha).toBe(NEW);
    expect(r.decision.reasons[0]).toMatch(/head moved/);
  });

  it("does not fetch checks for merged/closed PRs", async () => {
    const t = createFakeGitHubTransport({ pullRequests: { 5: rawPr({ state: "closed", merged: true }) }, checkRuns: { [HEAD]: greenRuns(HEAD) } });
    const r = await inspectPullRequestQa(createGitHubReadClient(t), repo, 5, DEFAULT_REQUIRED_CHECKS);
    expect(r.decision.status).toBe("blocked");
    expect(t.calls).toEqual(["GET pr o/r#5"]);
  });

  it("fails closed on transport errors without echoing the error message", async () => {
    const t: GitHubReadTransport = {
      getPullRequest: async () => {
        throw new Error("401 Bearer ghp_secretsecretsecret");
      },
      listCheckRuns: async () => [],
      listCommitStatuses: async () => [],
    };
    const r = await inspectPullRequestQa(createGitHubReadClient(t), repo, 5, DEFAULT_REQUIRED_CHECKS);
    expect(r.decision.status).toBe("unknown");
    expect(JSON.stringify(r)).not.toMatch(/ghp_|Bearer|401/);
  });
});
