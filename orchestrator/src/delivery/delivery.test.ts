import { describe, expect, it } from "vitest";
import { judgeDeployment } from "../domain/delivery";
import type { Approval } from "../store/types";
import type { ProcessRunner, ProcessSpec } from "../workers/types";
import { deployApprovalBinding, normalizeDeployEvidence } from "./approval";
import { createGhMergeTransport, mergeApprovedPullRequest, type PrMergeTransport } from "./merge";
import { readDeliveryConfig } from "./port";
import { createProductionVerifier } from "./production";
import { createRenderDeploymentObserver } from "./render";
import { DEPLOY_ACTION, DEPLOY_AUTHORIZATION, type DeployApprovalEvidence, type TrustedPrState } from "./types";

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const NOW = "2026-10-10T00:00:00.000Z";
const evidence: DeployApprovalEvidence = {
  taskId: "t26",
  lineageId: "t26",
  prNumber: 26,
  headSha: HEAD,
  baseBranch: "main",
  ci: { status: "passed", checks: [{ name: "verify", outcome: "success" }] },
  risk: "green",
  unverified: [],
  action: DEPLOY_ACTION,
  authorization: { ...DEPLOY_AUTHORIZATION },
};
const binding = deployApprovalBinding(evidence);
const approval = (over: Partial<Approval> = {}): Approval => ({
  id: "ap-1",
  taskId: "t26",
  kind: "deploy",
  requestedAction: DEPLOY_ACTION,
  status: "approved",
  decidedBy: "owner",
  decidedAt: NOW,
  channel: "telegram",
  expiresAt: "2026-10-11T00:00:00.000Z",
  bindingShaOrActionId: binding,
  createdAt: NOW,
  ...over,
});

function transport(pr: Partial<TrustedPrState> | null, mergeResult: { merged: boolean; sha: string | null } = { merged: true, sha: MERGE }) {
  const calls: string[] = [];
  let merged = false;
  const t: PrMergeTransport = {
    async getPr() {
      calls.push("get");
      return pr ? { number: 26, state: merged ? "closed" : "open", merged, headSha: HEAD, baseRef: "main", mergeSha: merged ? MERGE : null, ...pr } : null;
    },
    async mergeExact(n, sha) {
      calls.push(`merge ${n} ${sha}`);
      merged = mergeResult.merged;
      return mergeResult;
    },
  };
  return { t, calls };
}

describe("deploy approval binding", () => {
  it("binds task, lineage, PR, exact head, CI and the fixed scope; any drift changes it", () => {
    expect(binding).toMatch(/^deploy:[0-9a-f]{64}$/);
    expect(deployApprovalBinding({ ...evidence, headSha: "c".repeat(40) })).not.toBe(binding);
    expect(deployApprovalBinding({ ...evidence, prNumber: 27 })).not.toBe(binding);
    expect(deployApprovalBinding({ ...evidence, lineageId: "other" })).not.toBe(binding);
    expect(deployApprovalBinding({ ...evidence, ci: { status: "passed", checks: [{ name: "verify", outcome: "neutral" }] } })).not.toBe(binding);
  });

  it("refuses evidence outside the fixed merge + deploy scope", () => {
    expect(() => normalizeDeployEvidence({ ...evidence, authorization: { ...DEPLOY_AUTHORIZATION, push: true } as never })).toThrow(/authorization/);
    expect(() => normalizeDeployEvidence({ ...evidence, authorization: { ...DEPLOY_AUTHORIZATION, productionDatabase: true } as never })).toThrow(/authorization/);
    expect(() => normalizeDeployEvidence({ ...evidence, baseBranch: "release" as never })).toThrow(/main/);
    expect(() => normalizeDeployEvidence({ ...evidence, ci: { status: "failed" as never, checks: [] } })).toThrow(/CI/);
  });
});

describe("trusted exact-SHA merge", () => {
  const run = (pr: Partial<TrustedPrState> | null, a: Approval, opts: { enabled?: boolean; result?: { merged: boolean; sha: string | null } } = {}) => {
    const { t, calls } = transport(pr, opts.result);
    return mergeApprovedPullRequest({ transport: t, enabled: opts.enabled ?? true, now: () => NOW }, { evidence, approval: a, binding }).then((r) => ({ r, calls }));
  };

  it("merges exactly the approved head and verifies the merge from GitHub", async () => {
    const { r, calls } = await run({}, approval());
    expect(r).toEqual({ ok: true, mergeSha: MERGE });
    expect(calls).toEqual(["get", `merge 26 ${HEAD}`, "get"]);
  });

  it("never merges without an enabled capability, a deploy-kind approval, the exact binding, or before expiry", async () => {
    for (const [a, enabled] of [
      [approval(), false],
      [approval({ kind: "commit_publish" }), true],
      [approval({ bindingShaOrActionId: `deploy:${"0".repeat(64)}` }), true],
      [approval({ status: "pending" }), true],
      [approval({ taskId: "other" }), true],
      [approval({ expiresAt: "2026-10-09T00:00:00.000Z" }), true],
    ] as const) {
      const { r, calls } = await run({}, a, { enabled });
      expect(r.ok).toBe(false);
      expect(calls.filter((c) => c.startsWith("merge"))).toEqual([]);
    }
  });

  it("refuses a moved head, a closed / merged PR, or a non-main base before any write", async () => {
    expect((await run({ headSha: "c".repeat(40) }, approval())).r).toEqual({ ok: false, error: "pr_head_moved" });
    expect((await run({ state: "closed" }, approval())).r).toEqual({ ok: false, error: "pr_not_open" });
    expect((await run({ baseRef: "release" }, approval())).r).toEqual({ ok: false, error: "pr_base_not_main" });
    expect((await run(null, approval())).r).toEqual({ ok: false, error: "pr_not_open" });
  });

  it("a GitHub refusal (required check, conflict) is reported, never retried or forced", async () => {
    const { r, calls } = await run({}, approval(), { result: { merged: false, sha: null } });
    expect(r).toEqual({ ok: false, error: "pr_not_mergeable" });
    expect(calls.filter((c) => c.startsWith("merge"))).toHaveLength(1);
  });

  it("gh transport: fixed argv, PUT pulls/<n>/merge with the exact sha and merge method only", async () => {
    const specs: ProcessSpec[] = [];
    const runner: ProcessRunner = {
      spawn(spec) {
        specs.push(spec);
        const isMerge = spec.args.includes("PUT");
        const stdout = isMerge ? JSON.stringify({ merged: true, sha: MERGE }) : JSON.stringify({ number: 26, state: "open", merged: false, head: { sha: HEAD }, base: { ref: "main" }, merge_commit_sha: null });
        return { exit: Promise.resolve({ exitCode: 0, signal: null, stdout, stderr: "", truncated: false }), kill() {} };
      },
    };
    const t = createGhMergeTransport(runner, "/w", { owner: "o", repo: "r" });
    await t.getPr(26);
    await t.mergeExact(26, HEAD);
    expect(specs.map((s) => [s.command, ...s.args])).toEqual([
      ["gh", "api", "repos/o/r/pulls/26"],
      ["gh", "api", "--method", "PUT", "repos/o/r/pulls/26/merge", "-f", `sha=${HEAD}`, "-f", "merge_method=merge"],
    ]);
    await expect(t.mergeExact(26, "not-a-sha")).rejects.toThrow(/invalid head SHA/);
    expect(specs.some((s) => s.args.some((a) => /force|admin|delete/i.test(a)))).toBe(false);
  });
});

describe("Render deployment observer (trusted, read-only)", () => {
  const list = (deploys: { id: string; status: string; commit: string; createdAt: string }[]) => deploys.map((d) => ({ deploy: { id: d.id, status: d.status, commit: { id: d.commit }, createdAt: d.createdAt }, cursor: "c" }));
  const fetchOf = (status: number, body: unknown, seen: { url: string; auth: string }[] = []) => async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, auth: init.headers.Authorization });
    return { ok: status === 200, status, json: async () => body };
  };

  it("without credentials it is unconfigured — never pretends to see Render", async () => {
    const o = createRenderDeploymentObserver(null, { fetch: fetchOf(200, []), isAncestor: async () => true });
    expect(await o.observe(MERGE)).toEqual({ observer: "unconfigured", deploy: null });
  });

  it("finds the newest deployment of exactly the merged commit; the key only goes to api.render.com", async () => {
    const seen: { url: string; auth: string }[] = [];
    const o = createRenderDeploymentObserver(
      { apiKey: "rnd_secret_key_value", serviceId: "srv-abc12345" },
      {
        fetch: fetchOf(200, list([{ id: "dep-new", status: "build_in_progress", commit: MERGE, createdAt: "2026-10-10T01:00:00Z" }, { id: "dep-old", status: "live", commit: HEAD, createdAt: "2026-10-09T01:00:00Z" }]), seen),
        isAncestor: async () => false,
      },
    );
    expect(await o.observe(MERGE)).toEqual({ observer: "configured", deploy: { id: "dep-new", status: "build_in_progress", commitSha: MERGE } });
    expect(seen).toEqual([{ url: "https://api.render.com/v1/services/srv-abc12345/deploys?limit=20", auth: "Bearer rnd_secret_key_value" }]);
  });

  it("no deployment of the merged commit yet → configured, deploy null; API errors → unavailable (no detail leak)", async () => {
    const ok = createRenderDeploymentObserver({ apiKey: "rnd_secret_key_value", serviceId: "srv-abc12345" }, { fetch: fetchOf(200, list([{ id: "d", status: "live", commit: HEAD, createdAt: "x" }])), isAncestor: async () => false });
    expect(await ok.observe(MERGE)).toEqual({ observer: "configured", deploy: null });
    const bad = createRenderDeploymentObserver({ apiKey: "rnd_secret_key_value", serviceId: "srv-abc12345" }, { fetch: fetchOf(401, { message: "invalid key rnd_secret_key_value" }), isAncestor: async () => false });
    const r = await bad.observe(MERGE);
    expect(r).toEqual({ observer: "unavailable", deploy: null });
    expect(JSON.stringify(r)).not.toContain("rnd_");
  });

  it("a superseded deployment counts only if the live one provably contains the merged commit", async () => {
    const deploys = list([{ id: "dep-live", status: "live", commit: "c".repeat(40), createdAt: "2026-10-10T02:00:00Z" }, { id: "dep-own", status: "deactivated", commit: MERGE, createdAt: "2026-10-10T01:00:00Z" }]);
    const yes = createRenderDeploymentObserver({ apiKey: "rnd_secret_key_value", serviceId: "srv-abc12345" }, { fetch: fetchOf(200, deploys), isAncestor: async () => true });
    expect(await yes.observe(MERGE)).toMatchObject({ deploy: { status: "deactivated" }, live: { containsMerged: true } });
    const no = createRenderDeploymentObserver({ apiKey: "rnd_secret_key_value", serviceId: "srv-abc12345" }, { fetch: fetchOf(200, deploys), isAncestor: async () => false });
    const obs = await no.observe(MERGE);
    expect(judgeDeployment({ mergeSha: MERGE, observation: obs, priorCheckFailures: 0, maxCheckFailures: 3, elapsedMs: 0, receiveWindowMs: 1, rolloutWindowMs: 1 })).toMatchObject({ kind: "blocked", code: "deployed_revision_unproven" });
  });
});

describe("production verifier (read-only GET)", () => {
  const site = (routes: Record<string, { status: number; type?: string; body: string }>) => async (url: string) => {
    const r = routes[new URL(url).pathname] ?? { status: 404, body: "" };
    return { status: r.status, headers: { get: () => r.type ?? "application/json" }, text: async () => r.body };
  };
  const healthy = { "/api/health": { status: 200, body: '{"status":"ok"}' }, "/api/health/ready": { status: 200, body: "{}" }, "/": { status: 200, type: "text/html", body: '<div id="root"></div>' } };

  it("passes only with liveness ok, readiness 200 and the home page served", async () => {
    expect(await createProductionVerifier("https://www.oxmmatch.com", { get: site(healthy) }).verify()).toEqual({ health: { ok: true, detail: "liveness and readiness OK" }, smoke: { ok: true, detail: "home page served" } });
    const down = await createProductionVerifier("https://www.oxmmatch.com", { get: site({ ...healthy, "/api/health/ready": { status: 503, body: "{}" } }) }).verify();
    expect(down.health.ok).toBe(false);
    const broken = await createProductionVerifier("https://www.oxmmatch.com", { get: site({ ...healthy, "/": { status: 200, type: "text/html", body: "maintenance" } }) }).verify();
    expect(broken.smoke.ok).toBe(false);
  });

  it("refuses a non-https or credentialed production URL", () => {
    expect(() => createProductionVerifier("http://www.oxmmatch.com", { get: site(healthy) })).toThrow(/https/);
    expect(() => createProductionVerifier("https://user:pw@www.oxmmatch.com", { get: site(healthy) })).toThrow(/https/);
  });
});

describe("delivery configuration (names, never values)", () => {
  it("reports exactly what is missing for verified production delivery", () => {
    expect(readDeliveryConfig({})).toEqual({ ok: true, config: { enabled: false, render: null, productionUrl: "https://www.oxmmatch.com", missing: ["OXM_AGENT_OWNER_APPROVED_DEPLOY", "RENDER_API_KEY", "RENDER_SERVICE_ID"] } });
    const full = readDeliveryConfig({ OXM_AGENT_OWNER_APPROVED_DEPLOY: "enabled", RENDER_API_KEY: "rnd_secret_key_value", RENDER_SERVICE_ID: "srv-abc12345" });
    expect(full).toMatchObject({ ok: true, config: { enabled: true, missing: [], render: { serviceId: "srv-abc12345" } } });
  });

  it("malformed settings fail closed without echoing values", () => {
    const r = readDeliveryConfig({ RENDER_SERVICE_ID: "my-secret-service" });
    expect(r).toEqual({ ok: false, reason: "RENDER_SERVICE_ID must look like srv-…" });
    expect(readDeliveryConfig({ OXM_AGENT_OWNER_APPROVED_DEPLOY: "yes" }).ok).toBe(false);
    expect(readDeliveryConfig({ OXM_AGENT_PRODUCTION_URL: "http://x" }).ok).toBe(false);
  });
});
