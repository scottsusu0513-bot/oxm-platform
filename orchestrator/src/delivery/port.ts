import type { RepoRef } from "../githubWrite/types";
import type { ProcessRunner } from "../workers/types";
import { createGhMergeTransport, mergeApprovedPullRequest, type PrMergeTransport } from "./merge";
import { createProductionVerifier, normalizeProductionUrl, type HttpGet } from "./production";
import { createRenderDeploymentObserver, isValidRenderServiceId, type AncestryCheck, type FetchLike } from "./render";
import type { DeliveryPort } from "./types";

/** Explicit opt-in: without it the runtime never merges or deploys, even with an Owner approval. */
export const OWNER_APPROVED_DEPLOY_OPT_IN = "enabled" as const;
export const DEFAULT_PRODUCTION_URL = "https://www.oxmmatch.com";

export interface DeliveryConfig {
  /** OXM_AGENT_OWNER_APPROVED_DEPLOY=enabled */
  enabled: boolean;
  /** RENDER_API_KEY + RENDER_SERVICE_ID (trusted control plane only). Null: observer unconfigured. */
  render: { apiKey: string; serviceId: string } | null;
  productionUrl: string;
  /** Names (never values) of settings still missing for verified production delivery. */
  missing: string[];
}

/** Reads delivery settings. Reasons and `missing` name variables, never values. */
export function readDeliveryConfig(env: Readonly<Record<string, string | undefined>>): { ok: true; config: DeliveryConfig } | { ok: false; reason: string } {
  const flag = env.OXM_AGENT_OWNER_APPROVED_DEPLOY;
  if (flag !== undefined && flag !== "" && flag !== OWNER_APPROVED_DEPLOY_OPT_IN && flag !== "disabled")
    return { ok: false, reason: "OXM_AGENT_OWNER_APPROVED_DEPLOY must be 'enabled' or 'disabled'" };
  const apiKey = env.RENDER_API_KEY ?? "";
  const serviceId = env.RENDER_SERVICE_ID ?? "";
  if (serviceId && !isValidRenderServiceId(serviceId)) return { ok: false, reason: "RENDER_SERVICE_ID must look like srv-…" };
  if (apiKey && (apiKey.length < 8 || /\s/.test(apiKey))) return { ok: false, reason: "RENDER_API_KEY is malformed" };
  const productionUrl = normalizeProductionUrl(env.OXM_AGENT_PRODUCTION_URL || DEFAULT_PRODUCTION_URL);
  if (!productionUrl) return { ok: false, reason: "OXM_AGENT_PRODUCTION_URL must be an https origin" };
  const enabled = flag === OWNER_APPROVED_DEPLOY_OPT_IN;
  const missing = [...(enabled ? [] : ["OXM_AGENT_OWNER_APPROVED_DEPLOY"]), ...(apiKey ? [] : ["RENDER_API_KEY"]), ...(serviceId ? [] : ["RENDER_SERVICE_ID"])];
  return { ok: true, config: { enabled, render: apiKey && serviceId ? { apiKey, serviceId } : null, productionUrl, missing } };
}

export function createDeliveryPort(deps: {
  config: DeliveryConfig;
  repo: RepoRef;
  runner?: ProcessRunner;
  repoRoot?: string;
  /** Injected for tests; production uses gh CLI. */
  mergeTransport?: PrMergeTransport;
  fetch: FetchLike;
  httpGet: HttpGet;
  isAncestor: AncestryCheck;
  now: () => string;
}): DeliveryPort {
  const transport = deps.mergeTransport ?? createGhMergeTransport(deps.runner!, deps.repoRoot!, deps.repo);
  const observer = createRenderDeploymentObserver(deps.config.render, { fetch: deps.fetch, isAncestor: deps.isAncestor });
  const verifier = createProductionVerifier(deps.config.productionUrl, { get: deps.httpGet });
  return {
    enabled: deps.config.enabled,
    productionHost: verifier.host,
    prState: (n) => transport.getPr(n),
    mergeApproved: (input) => mergeApprovedPullRequest({ transport, enabled: deps.config.enabled, now: deps.now }, input),
    observeDeployment: (sha) => observer.observe(sha),
    verifyProduction: () => verifier.verify(),
  };
}
