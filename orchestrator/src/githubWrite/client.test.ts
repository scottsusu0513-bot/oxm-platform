import { describe, expect, it } from "vitest";
import { planBranch } from "../branches/planner";
import type { BranchPlanRequest, NewBranchPlan, ReuseBranchPlan } from "../branches/types";
import { createGitHubWriteClient, isTrustedPullRequest, isVerifiedPushReceipt } from "./client";
import { createFakeRemote } from "./fake";
import type { PushReceipt } from "./types";

const BASE = "a".repeat(40);
const C1 = "c".repeat(40);
const C2 = "d".repeat(40);
const MOVED = "e".repeat(40);
const REPO = { owner: "scott", repo: "oxm-platform" };
const meta = { title: "Fix search", summary: "Fixes filter", acceptanceCriteria: ["filter works"] };

const req = (over: Partial<BranchPlanRequest> = {}): BranchPlanRequest => ({
  taskId: "t1",
  category: "bug_fix",
  title: "Fix search",
  expectedPaths: ["client/src/pages/Search.tsx"],
  baseBranch: "main",
  baseSha: BASE,
  ...over,
});

function setup() {
  const remote = createFakeRemote({ refs: { main: BASE }, parents: { [C1]: BASE, [C2]: C1, [MOVED]: BASE } });
  const client = createGitHubWriteClient(REPO, { transport: remote, push: remote });
  const plan = planBranch(req(), { active: [] }) as NewBranchPlan;
  return { remote, client, plan };
}

async function pushed() {
  const s = setup();
  const created = await s.client.createTaskBranch(s.plan);
  expect(created.ok).toBe(true);
  const res = await s.client.pushTaskBranch(s.plan, { localHeadSha: C1, expectedRemoteSha: BASE });
  if (!res.ok) throw new Error(res.reason);
  return { ...s, receipt: res.receipt };
}

describe("interface surface", () => {
  it("exposes only the narrow write operations (no merge/close/approve/delete/force/admin)", () => {
    const { client, remote } = setup();
    expect(Object.keys(client).sort()).toEqual(["createTaskBranch", "openPullRequest", "pushTaskBranch", "updatePullRequestText"]);
    expect(Object.isFrozen(client)).toBe(true);
    const transportOps = Object.keys(remote).filter((k) => typeof (remote as unknown as Record<string, unknown>)[k] === "function");
    expect(transportOps.sort()).toEqual(["createBranchRef", "createPullRequest", "getBranchHead", "getPullRequest", "pushBranch", "updatePullRequestText"]);
    for (const k of [...Object.keys(client), ...transportOps]) {
      expect(k).not.toMatch(/merge|close|approve|delete|force|protect|admin|dismiss|bypass/i);
    }
  });

  it("rejects invalid repo refs", () => {
    const remote = createFakeRemote({ refs: {} });
    expect(() => createGitHubWriteClient({ owner: "a/b", repo: "x" }, { transport: remote, push: remote })).toThrow();
  });
});

describe("createTaskBranch", () => {
  it("creates the branch at exactly the planned base SHA", async () => {
    const { client, plan, remote } = setup();
    const res = await client.createTaskBranch(plan);
    expect(res).toEqual({ ok: true, creation: { taskId: "t1", branch: plan.branch, baseSha: BASE, alreadyExisted: false } });
    expect(remote.refs.get(plan.branch)).toBe(BASE);
    expect(remote.calls).toContain(`CREATE ref scott/oxm-platform ${plan.branch}@${BASE}`);
  });

  it("stale base SHA → replan_required, nothing created", async () => {
    const { client, plan, remote } = setup();
    remote.refs.set("main", MOVED);
    const res = await client.createTaskBranch(plan);
    expect(res).toMatchObject({ ok: false, error: "replan_required" });
    expect(remote.refs.has(plan.branch)).toBe(false);
  });

  it("refuses plans not issued by the planner (forged / copied / queue / reject / reuse)", async () => {
    const { client, plan } = setup();
    const forged = { ...plan, branch: "main" };
    for (const p of [forged, { ...plan }, planBranch(req({ requestedBranch: "main" }), { active: [] }), null, "agent/task-t1-x"]) {
      expect(await client.createTaskBranch(p)).toMatchObject({ ok: false, error: "policy_violation" });
    }
  });

  it("never moves an existing branch at a different SHA", async () => {
    const { client, plan, remote } = setup();
    remote.refs.set(plan.branch, C1);
    expect(await client.createTaskBranch(plan)).toMatchObject({ ok: false, error: "branch_exists" });
    expect(remote.refs.get(plan.branch)).toBe(C1);
  });

  it("is idempotent when the branch already exists at the planned SHA", async () => {
    const { client, plan, remote } = setup();
    remote.refs.set(plan.branch, BASE);
    expect(await client.createTaskBranch(plan)).toMatchObject({ ok: true, creation: { alreadyExisted: true } });
  });

  it("transport errors fail closed without leaking messages", async () => {
    const { client, plan, remote } = setup();
    remote.hooks.failOn = "createBranchRef";
    const res = await client.createTaskBranch(plan);
    expect(res).toMatchObject({ ok: false, error: "transport_error" });
    expect(JSON.stringify(res)).not.toMatch(/ghp_|Bearer/);
  });
});

describe("pushTaskBranch", () => {
  it("pushes only the assigned branch and verifies the remote head", async () => {
    const { receipt, remote, plan } = await pushed();
    expect(receipt).toMatchObject({ taskId: "t1", branch: plan.branch, headSha: C1, previousRemoteSha: BASE });
    expect(isVerifiedPushReceipt(receipt)).toBe(true);
    expect(remote.refs.get("main")).toBe(BASE);
    expect(remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([`PUSH ${C1}:refs/heads/${plan.branch}`]);
  });

  it("requires explicit 40-hex SHAs", async () => {
    const { client, plan } = setup();
    await client.createTaskBranch(plan);
    for (const input of [{ localHeadSha: "HEAD", expectedRemoteSha: BASE }, { localHeadSha: C1, expectedRemoteSha: "" }]) {
      expect(await client.pushTaskBranch(plan, input)).toMatchObject({ ok: false, error: "policy_violation" });
    }
  });

  it("refuses when the remote moved (no force / no lease semantics)", async () => {
    const { client, plan, remote } = setup();
    await client.createTaskBranch(plan);
    remote.refs.set(plan.branch, MOVED);
    expect(await client.pushTaskBranch(plan, { localHeadSha: C1, expectedRemoteSha: BASE })).toMatchObject({ ok: false, error: "remote_moved" });
    expect(remote.refs.get(plan.branch)).toBe(MOVED);
  });

  it("a history rewrite (non-fast-forward) is rejected by the remote and never retried with force", async () => {
    const { client, plan, remote } = await pushed();
    const res = await client.pushTaskBranch(plan, { localHeadSha: MOVED, expectedRemoteSha: C1 });
    expect(res).toMatchObject({ ok: false, error: "transport_error" });
    expect(remote.refs.get(plan.branch)).toBe(C1);
    expect(remote.calls.filter((c) => c.startsWith("PUSH")).length).toBe(2);
  });

  it("refuses before branch creation", async () => {
    const { client, plan } = setup();
    expect(await client.pushTaskBranch(plan, { localHeadSha: C1, expectedRemoteSha: BASE })).toMatchObject({ ok: false, error: "branch_missing" });
  });

  it("main/master cannot be pushed: no plan can carry them", async () => {
    const { client, plan } = setup();
    for (const branch of ["main", "master", "refs/heads/main"]) {
      const forged = Object.freeze({ ...plan, branch });
      expect(await client.pushTaskBranch(forged, { localHeadSha: C1, expectedRemoteSha: BASE })).toMatchObject({
        ok: false,
        error: "policy_violation",
      });
    }
  });

  it("reuse plan must push from the planned head", async () => {
    const { remote, plan, client } = await pushed();
    const reuse = planBranch(
      req({
        taskId: "t2",
        lineage: { rootTaskId: "t1", title: "Fix search" },
        allowReuse: true,
        existingBranch: {
          name: plan.branch,
          headSha: C1,
          baseSha: BASE,
          lineageId: "t1",
          prNumber: null,
          prState: null,
          changedPaths: ["client/src/pages/Search.tsx"],
          workerRunning: false,
        },
      }),
      { active: [] },
    ) as ReuseBranchPlan;
    expect(reuse.decision).toBe("reuse_branch");
    expect(await client.pushTaskBranch(reuse, { localHeadSha: C2, expectedRemoteSha: BASE })).toMatchObject({ error: "policy_violation" });
    expect(await client.pushTaskBranch(reuse, { localHeadSha: C2, expectedRemoteSha: C1 })).toMatchObject({ ok: true });
    expect(remote.refs.get(plan.branch)).toBe(C2);
  });

  it("verification failure when the remote does not end at the pushed SHA", async () => {
    const { client, plan, remote } = setup();
    await client.createTaskBranch(plan);
    remote.hooks.beforeGetBranchHead = (b, n) => {
      if (b === plan.branch && n === 4) remote.refs.set(b, MOVED);
    };
    expect(await client.pushTaskBranch(plan, { localHeadSha: C1, expectedRemoteSha: BASE })).toMatchObject({ error: "verification_failed" });
  });
});

describe("openPullRequest", () => {
  it("opens base=main, head=assigned branch and returns the trusted GitHub number", async () => {
    const { client, plan, receipt, remote } = await pushed();
    const res = await client.openPullRequest(plan, receipt, meta, { draft: true });
    expect(res).toMatchObject({ ok: true, pr: { number: 100, branch: plan.branch, headSha: C1, draft: true, taskId: "t1" } });
    if (!res.ok) return;
    expect(isTrustedPullRequest(res.pr)).toBe(true);
    expect(remote.calls).toContain(`CREATE pr scott/oxm-platform ${plan.branch}->main draft=true`);
  });

  it("requires a verified push receipt (fabricated receipts rejected)", async () => {
    const { client, plan, receipt } = await pushed();
    const fake: PushReceipt = { ...receipt };
    expect(await client.openPullRequest(plan, fake, meta, { draft: false })).toMatchObject({ error: "policy_violation" });
  });

  it("requires an explicit draft/ready policy", async () => {
    const { client, plan, receipt } = await pushed();
    expect(await client.openPullRequest(plan, receipt, meta, {} as never)).toMatchObject({ error: "policy_violation" });
  });

  it("rejects a GitHub response with the wrong base/head/sha/number", async () => {
    for (const mutate of [
      (r: any) => ({ ...r, base: { ref: "develop" } }),
      (r: any) => ({ ...r, head: { ...r.head, ref: "main" } }),
      (r: any) => ({ ...r, head: { ...r.head, sha: MOVED } }),
      (r: any) => ({ ...r, number: 0 }),
      (r: any) => ({ ...r, merged: true }),
    ]) {
      const { client, plan, receipt, remote } = await pushed();
      remote.hooks.mutatePrResponse = mutate;
      expect(await client.openPullRequest(plan, receipt, meta, { draft: false })).toMatchObject({ error: "verification_failed" });
    }
  });

  it("refuses when the branch moved after the verified push", async () => {
    const { client, plan, receipt, remote } = await pushed();
    remote.refs.set(plan.branch, C2);
    expect(await client.openPullRequest(plan, receipt, meta, { draft: false })).toMatchObject({ error: "remote_moved" });
  });

  it("PR text is sanitized and never contains raw secrets", async () => {
    const { client, plan, receipt, remote } = await pushed();
    await client.openPullRequest(plan, receipt, { title: "x\u0000 Bearer abcdefghijkl", summary: "key sk-ant-abcdefghijklmnop", acceptanceCriteria: ["$(rm -rf /)"] }, { draft: false });
    const stored = remote.prs.get(100) as unknown as { title: string; body: string };
    expect(stored.title).toBe("x [REDACTED]");
    expect(stored.body).toContain("key [REDACTED]");
    expect(stored.body).toContain("- $(rm -rf /)");
  });

  it("updates PR title/body only for trusted PRs", async () => {
    const { client, plan, receipt } = await pushed();
    const opened = await client.openPullRequest(plan, receipt, meta, { draft: false });
    if (!opened.ok) throw new Error(opened.reason);
    expect(await client.updatePullRequestText(plan, opened.pr, { ...meta, title: "New title" })).toMatchObject({ ok: true, pr: { number: 100 } });
    expect(await client.updatePullRequestText(plan, { ...opened.pr, number: 7 }, meta)).toMatchObject({ error: "policy_violation" });
  });
});
