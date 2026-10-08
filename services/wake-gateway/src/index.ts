import { consoleLog, digestEquals, loadGatewayConfig, MAX_WEBHOOK_BYTES, secretEquals, sha256Hex } from "./config";
import { projectUpdate } from "./telegram";
import type { GatewayEnv, GatewayLog } from "./types";

export { OwnerQueue } from "./ownerQueue";

/**
 * OXM Wake Gateway Worker: transport / wake / queue only. It authenticates
 * Telegram (webhook secret + owner) and the Agent (bearer, hash-compared),
 * stores owner updates durably, and wakes the one configured Codespace. It never
 * runs the Manager, a Worker, a shell or Git, and never creates engineering tasks.
 *
 *   POST /tg/<opaque path>   Telegram webhook (X-Telegram-Bot-Api-Secret-Token)
 *   GET  /agent/updates      Agent pull (getUpdates semantics; Authorization: Bearer)
 *   GET  /agent/ping         Agent credential check + liveness heartbeat (while it is busy handling an update)
 *   GET  /healthz            liveness, no information
 */
const OWNER_QUEUE_NAME = "owner";
const AGENT_BEARER = /^Bearer ([A-Za-z0-9_-]{16,512})$/;

const empty = (status: number) => new Response(status === 200 ? "ok" : null, { status, headers: { "cache-control": "no-store" } });

export async function handleRequest(request: Request, env: GatewayEnv, log: GatewayLog = consoleLog): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return request.method === "GET" ? empty(200) : empty(405);
  const webhook = /^\/tg\/([A-Za-z0-9_-]{1,256})$/.exec(url.pathname);
  const agentRoute = url.pathname === "/agent/updates" || url.pathname === "/agent/ping";
  if (!webhook && !agentRoute) return empty(404);

  const loaded = await loadGatewayConfig(env);
  if (!loaded.ok) {
    log("config_invalid");
    return empty(503);
  }
  const config = loaded.config;
  const queue = () => env.OWNER_QUEUE.get(env.OWNER_QUEUE.idFromName(OWNER_QUEUE_NAME));

  if (webhook) {
    if (request.method !== "POST") return empty(405);
    if (!(await secretEquals(webhook[1], config.webhookPath))) return empty(404);
    if (!(await secretEquals(request.headers.get("x-telegram-bot-api-secret-token") ?? "", config.webhookSecret))) {
      log("webhook_unauthorized");
      return empty(401);
    }
    if (Number(request.headers.get("content-length") ?? "0") > MAX_WEBHOOK_BYTES) return empty(413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_WEBHOOK_BYTES) return empty(413);
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      log("webhook_malformed");
      return empty(400);
    }
    const projection = projectUpdate(raw, config.ownerChatId);
    if (projection.kind === "ignored") {
      log("webhook_ignored", { reason: projection.reason });
      return empty(200); // never answer strangers; nothing stored, nothing woken
    }
    const stored = await queue().fetch(
      new Request("https://owner-queue/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(projection.update) }),
    );
    // 2xx only once the Durable Object committed the update (or recognised a duplicate); otherwise Telegram retries.
    return empty(stored.status === 200 ? 200 : 500);
  }

  if (request.method !== "GET") return empty(405);
  const bearer = AGENT_BEARER.exec(request.headers.get("authorization") ?? "");
  if (!bearer || !digestEquals(await sha256Hex(bearer[1]), config.agentTokenSha256)) {
    log("agent_unauthorized");
    return empty(401);
  }
  if (url.pathname === "/agent/ping") {
    const beat = await queue().fetch(new Request("https://owner-queue/heartbeat", { method: "POST" }));
    return new Response(JSON.stringify({ ok: beat.status === 200 }), { status: beat.status === 200 ? 200 : 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const forward = new URL("https://owner-queue/pull");
  for (const key of ["offset", "timeout"]) {
    const value = url.searchParams.get(key);
    if (value !== null) forward.searchParams.set(key, value);
  }
  const res = await queue().fetch(new Request(forward.toString(), { method: "GET" }));
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export default {
  fetch: (request: Request, env: GatewayEnv) => handleRequest(request, env),
};
