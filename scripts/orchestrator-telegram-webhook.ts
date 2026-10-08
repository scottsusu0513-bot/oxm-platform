/**
 * Operator tool for the Telegram update mode (Wake Gateway cutover / rollback).
 * Telegram delivers updates EITHER to a webhook OR to getUpdates, never both.
 *
 *   pnpm orchestrator:telegram:webhook info                       show the current mode (no secrets printed)
 *   pnpm orchestrator:telegram:webhook set --confirm-cutover      webhook -> Wake Gateway
 *       needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and OXM_WAKE_GATEWAY_WEBHOOK_URL
 *       (https://<gateway>/tg/<opaque path>) in the environment of this one command only;
 *       then set OXM_AGENT_TELEGRAM_SOURCE=gateway for the Agent.
 *   pnpm orchestrator:telegram:webhook delete --confirm-rollback  back to direct getUpdates polling
 *       then unset OXM_AGENT_TELEGRAM_SOURCE (or set it to telegram) and restart the Agent.
 *
 * Pending updates are never dropped in either direction.
 */
const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest);
const say = (line: string) => process.stdout.write(`[oxm-telegram-webhook] ${line}\n`);
const fail = (line: string): never => {
  say(`FAILED: ${line}`);
  process.exit(1);
};

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
if (!/^[0-9]{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token)) fail("TELEGRAM_BOT_TOKEN is missing or malformed");

async function call(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let body: { ok?: unknown; result?: unknown };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    body = (await res.json()) as typeof body;
  } catch {
    return fail(`${method} failed (network error or non-JSON response)`); // the error may embed the token-bearing URL
  }
  if (body.ok !== true) return fail(`${method} was refused by Telegram`);
  return (body.result ?? {}) as Record<string, unknown>;
}

if (command === "info") {
  const info = await call("getWebhookInfo", {});
  const url = typeof info.url === "string" && info.url ? new URL(info.url) : null;
  say(url ? `mode: webhook (host ${url.host}; path not shown)` : "mode: getUpdates (no webhook set)");
  say(`pending updates at Telegram: ${Number(info.pending_update_count ?? 0)}`);
  if (info.last_error_date) say("Telegram reports a recent webhook delivery error (see getWebhookInfo.last_error_message)");
} else if (command === "set") {
  if (!flags.has("--confirm-cutover")) fail("refusing without --confirm-cutover");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET is missing or malformed");
  let url: URL;
  try {
    url = new URL(process.env.OXM_WAKE_GATEWAY_WEBHOOK_URL?.trim() ?? "");
  } catch {
    fail("OXM_WAKE_GATEWAY_WEBHOOK_URL is not a URL");
  }
  if (url!.protocol !== "https:" || !/^\/tg\/[A-Za-z0-9_-]{24,128}$/.test(url!.pathname) || url!.search || url!.hash)
    fail("OXM_WAKE_GATEWAY_WEBHOOK_URL must be https://<gateway>/tg/<opaque path>");
  await call("setWebhook", { url: url!.toString(), secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false, max_connections: 1 });
  say(`webhook set to host ${url!.host}; set OXM_AGENT_TELEGRAM_SOURCE=gateway for the Agent`);
} else if (command === "delete") {
  if (!flags.has("--confirm-rollback")) fail("refusing without --confirm-rollback");
  await call("deleteWebhook", { drop_pending_updates: false });
  say("webhook deleted; Telegram serves getUpdates again. Unset OXM_AGENT_TELEGRAM_SOURCE and restart the Agent.");
} else {
  fail("usage: info | set --confirm-cutover | delete --confirm-rollback");
}
