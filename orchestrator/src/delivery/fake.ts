import type { DeploymentObservation, ProductionChecks, RenderDeployStatus } from "../domain/delivery";
import type { FakeRemote } from "../githubWrite/fake";
import type { PreviewPort, PreviewResult } from "./types";
import { mergeApprovedPullRequest, type PrMergeTransport } from "./merge";
import type { DeliveryPort, TrustedPrState } from "./types";

/**
 * Test doubles for the trusted delivery / preview ports. The merge goes through the REAL
 * mergeApprovedPullRequest (approval kind, binding, expiry, PR re-read) over a simulated GitHub.
 */
export interface FakeDelivery extends DeliveryPort {
  calls: string[];
  /** Scripted deployment observations per poll (the last repeats); receives the merged SHA. */
  observations: ((mergeSha: string) => DeploymentObservation)[];
  /** Scripted production checks per verification (the last repeats). */
  checks: ProductionChecks[];
  observeCount: number;
  verifyCount: number;
  /** Merge commit the simulated GitHub creates. */
  mergeSha: string;
}

/** Scripted Render observation: a deployment of the merged commit (or of `commitSha`) in `status`. */
export const deployed =
  (status: RenderDeployStatus, commitSha?: string) =>
  (mergeSha: string): DeploymentObservation => ({ observer: "configured", deploy: { id: "dep-1", status, commitSha: commitSha ?? mergeSha } });
export const PASSING_CHECKS: ProductionChecks = { health: { ok: true, detail: "liveness and readiness OK" }, smoke: { ok: true, detail: "home page served" } };

export function createFakeDelivery(opts: { remote: FakeRemote; enabled?: boolean; now: () => string; mergeSha?: string }): FakeDelivery {
  const calls: string[] = [];
  const merged = new Map<number, string>();
  const mergeSha = opts.mergeSha ?? "f".repeat(40);
  const transport: PrMergeTransport = {
    async getPr(n): Promise<TrustedPrState | null> {
      calls.push(`GET pr ${n}`);
      const raw = opts.remote.prs.get(n);
      if (!raw) return null;
      const headSha = opts.remote.refs.get(raw.head.ref) ?? raw.head.sha;
      const m = merged.get(n) ?? null;
      return { number: n, state: m || raw.state !== "open" ? "closed" : "open", merged: m !== null, headSha, baseRef: raw.base.ref, mergeSha: m };
    },
    async mergeExact(n, sha) {
      calls.push(`MERGE pr ${n} ${sha}`);
      const raw = opts.remote.prs.get(n);
      const headSha = raw ? (opts.remote.refs.get(raw.head.ref) ?? raw.head.sha) : null;
      if (!raw || merged.has(n) || headSha !== sha) return { merged: false, sha: null };
      merged.set(n, mergeSha);
      opts.remote.refs.set("main", mergeSha);
      return { merged: true, sha: mergeSha };
    },
  };
  const fake: FakeDelivery = {
    calls,
    observations: [deployed("live")],
    checks: [PASSING_CHECKS],
    observeCount: 0,
    verifyCount: 0,
    mergeSha,
    enabled: opts.enabled ?? true,
    productionHost: "www.oxmmatch.com",
    prState: (n) => transport.getPr(n),
    mergeApproved: (input) => mergeApprovedPullRequest({ transport, enabled: fake.enabled, now: opts.now }, input),
    async observeDeployment(sha) {
      calls.push(`OBSERVE ${sha}`);
      const f = fake.observations[Math.min(fake.observeCount++, fake.observations.length - 1)];
      return f(sha);
    },
    async verifyProduction() {
      calls.push("VERIFY");
      return structuredClone(fake.checks[Math.min(fake.verifyCount++, fake.checks.length - 1)]);
    },
  };
  return fake;
}

export interface FakePreview extends PreviewPort {
  calls: string[];
  result: PreviewResult;
  /** Number of dev servers actually started (a reuse does not start one). */
  started: number;
}

export function createFakePreview(result?: Partial<PreviewResult>): FakePreview {
  let running = false;
  const fake: FakePreview = {
    calls: [],
    started: 0,
    result: { status: "ready", url: "https://cs-name-3000.app.github.dev/", port: 3000, visibility: "private", access: "github_sign_in", reason: null, reused: false, ...result },
    async ensure({ taskId }) {
      fake.calls.push(`ENSURE ${taskId}`);
      if (fake.result.status === "ready" && !running) {
        running = true;
        fake.started++;
        return { ...fake.result, reused: false };
      }
      return { ...fake.result, reused: fake.result.status === "ready" };
    },
    async release(taskId) {
      fake.calls.push(`RELEASE ${taskId}`);
      running = false;
    },
  };
  return fake;
}
