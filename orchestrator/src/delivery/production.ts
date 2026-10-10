import type { ProductionChecks } from "../domain/delivery";

/**
 * Read-only production verification: liveness, readiness and a smoke request of the public site.
 * GET only, no cookies, no credentials, cache-busting headers; failures are reduced to safe details.
 */
export type HttpGet = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal; redirect: "follow" }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export function normalizeProductionUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function createProductionVerifier(baseUrl: string, deps: { get: HttpGet; timeoutMs?: number }) {
  const base = normalizeProductionUrl(baseUrl);
  if (!base) throw new Error("[delivery] production URL must be an https origin without credentials");
  const fetchText = async (path: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
    try {
      const res = await deps.get(`${base}${path}`, { method: "GET", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }, signal: controller.signal, redirect: "follow" });
      const body = (await res.text()).slice(0, 200_000);
      return { status: res.status, type: res.headers.get("content-type") ?? "", body };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    host: new URL(base).host,
    async verify(): Promise<ProductionChecks> {
      let health: ProductionChecks["health"];
      try {
        const live = await fetchText("/api/health");
        const ready = await fetchText("/api/health/ready");
        let status: unknown = null;
        try {
          status = (JSON.parse(live.body) as { status?: unknown }).status;
        } catch {
          status = null;
        }
        health =
          live.status === 200 && status === "ok" && ready.status === 200
            ? { ok: true, detail: "liveness and readiness OK" }
            : { ok: false, detail: `liveness ${live.status}${status === "ok" ? "" : " (unexpected body)"}, readiness ${ready.status}` };
      } catch {
        health = { ok: false, detail: "health endpoint unreachable" };
      }
      let smoke: ProductionChecks["smoke"];
      try {
        const home = await fetchText("/");
        smoke =
          home.status === 200 && /text\/html/i.test(home.type) && home.body.includes('id="root"')
            ? { ok: true, detail: "home page served" }
            : { ok: false, detail: `home page ${home.status}` };
      } catch {
        smoke = { ok: false, detail: "home page unreachable" };
      }
      return { health, smoke };
    },
  };
}
