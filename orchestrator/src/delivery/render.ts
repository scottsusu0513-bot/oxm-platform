import { RENDER_DEPLOY_STATUSES, type DeploymentObservation, type RenderDeployStatus } from "../domain/delivery";

/**
 * Trusted Render deployment observer (read-only Render REST API).
 *
 * The API key is used only inside this module, only as an Authorization header to api.render.com, and
 * never appears in a return value, error, log line or Manager input. Errors are reduced to
 * `observer: "unavailable"`; a missing key or service id is `observer: "unconfigured"` — the Agent
 * never pretends it can see Render.
 */
export interface RenderObserverConfig {
  apiKey: string;
  serviceId: string;
  /** Default https://api.render.com/v1 */
  baseUrl?: string;
  timeoutMs?: number;
}

export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Whether `merged` is an ancestor of (or equal to) `live` — trusted GitHub compare. */
export type AncestryCheck = (merged: string, live: string) => Promise<boolean>;

const SHA = /^[0-9a-f]{40}$/;
const SERVICE_ID = /^srv-[a-z0-9]{8,64}$/;

export function isValidRenderServiceId(id: string): boolean {
  return SERVICE_ID.test(id);
}

interface RenderDeploy {
  id: string;
  status: RenderDeployStatus;
  commitSha: string | null;
  createdAt: string;
}

function parseDeploys(json: unknown): RenderDeploy[] {
  if (!Array.isArray(json)) throw new Error("render: malformed deploy list");
  const out: RenderDeploy[] = [];
  for (const item of json) {
    const d = (item as { deploy?: Record<string, unknown> })?.deploy;
    if (!d || typeof d.id !== "string") continue;
    const raw = String(d.status ?? "");
    const status = ((RENDER_DEPLOY_STATUSES as readonly string[]).includes(raw) ? raw : "unknown") as RenderDeployStatus;
    const commit = String((d.commit as { id?: unknown } | undefined)?.id ?? "").toLowerCase();
    out.push({ id: d.id.slice(0, 64), status, commitSha: SHA.test(commit) ? commit : null, createdAt: String(d.createdAt ?? "") });
  }
  return out;
}

export function createRenderDeploymentObserver(config: RenderObserverConfig | null, deps: { fetch: FetchLike; isAncestor: AncestryCheck }) {
  return {
    configured: config !== null,
    async observe(mergeSha: string): Promise<DeploymentObservation> {
      if (!config) return { observer: "unconfigured", deploy: null };
      if (!SHA.test(mergeSha) || !isValidRenderServiceId(config.serviceId)) return { observer: "unavailable", deploy: null };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000);
      let deploys: RenderDeploy[];
      try {
        const res = await deps.fetch(`${config.baseUrl ?? "https://api.render.com/v1"}/services/${config.serviceId}/deploys?limit=20`, {
          method: "GET",
          headers: { Accept: "application/json", Authorization: `Bearer ${config.apiKey}` },
          signal: controller.signal,
        });
        if (!res.ok) return { observer: "unavailable", deploy: null };
        deploys = parseDeploys(await res.json());
      } catch {
        return { observer: "unavailable", deploy: null };
      } finally {
        clearTimeout(timer);
      }
      // Newest deployment of exactly the merged commit.
      const own = deploys.filter((d) => d.commitSha === mergeSha).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
      if (!own || !own.commitSha) return { observer: "configured", deploy: null };
      const deploy = { id: own.id, status: own.status, commitSha: own.commitSha };
      if (own.status !== "deactivated") return { observer: "configured", deploy };
      const live = deploys.find((d) => d.status === "live" && d.commitSha);
      if (!live || !live.commitSha) return { observer: "configured", deploy, live: null };
      const containsMerged = await deps.isAncestor(mergeSha, live.commitSha).catch(() => false);
      return { observer: "configured", deploy, live: { id: live.id, commitSha: live.commitSha, containsMerged } };
    },
  };
}
