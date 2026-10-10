import { TelegramApiError, type TelegramBotClient, type TelegramUpdate } from "./client";

export type GatewayFetch = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
const defaultFetch: GatewayFetch = (url, init) => fetch(url, init);

/**
 * Telegram update source backed by the Wake Gateway queue. It replaces only
 * getUpdates: the Gateway answers with the same `{ ok, result: Update[] }` shape
 * and the same offset semantics (offset = the existing ledger cursor, which
 * acknowledges every update below it), so parseUpdate, the control plane and the
 * ledger work unchanged. Every other method goes straight to the Bot API.
 * In this mode Telegram's getUpdates is never called. The pull token is never
 * placed in an error, log line or return value.
 */
const MAX_RESPONSE_BYTES = 2_000_000;

export function createGatewayUpdatesClient(input: {
  telegram: TelegramBotClient;
  gatewayUrl: string;
  agentToken: string;
  fetch?: GatewayFetch;
  /**
   * Liveness ping interval once polling has started (0 disables). The control plane does not pull
   * while it handles an update (a GPT Manager call can take minutes); without this the Gateway would
   * take a busy Agent for an offline one and start a needless wake cycle.
   */
  heartbeatMs?: number;
}): TelegramBotClient {
  const doFetch = input.fetch ?? defaultFetch;
  const heartbeatMs = input.heartbeatMs ?? 30_000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const startHeartbeat = () => {
    if (heartbeat || heartbeatMs <= 0) return;
    heartbeat = setInterval(() => {
      gatewayGet(doFetch, `${input.gatewayUrl}/agent/ping`, input.agentToken, 15_000).catch(() => undefined);
    }, heartbeatMs);
    (heartbeat as { unref?: () => void }).unref?.();
  };
  return {
    getMe: (signal) => input.telegram.getMe(signal),
    sendMessage: (args, signal) => input.telegram.sendMessage(args, signal),
    answerCallbackQuery: (args, signal) => input.telegram.answerCallbackQuery(args, signal),
    removeButtons: (args, signal) => input.telegram.removeButtons(args, signal),
    async getUpdates({ offset, timeoutSeconds }, signal) {
      startHeartbeat();
      const timeout = Math.max(0, Math.min(25, Math.floor(timeoutSeconds)));
      const query = new URLSearchParams({ timeout: String(timeout), ...(offset !== null ? { offset: String(offset) } : {}) });
      const body = await gatewayGet(doFetch, `${input.gatewayUrl}/agent/updates?${query}`, input.agentToken, (timeout + 15) * 1000, signal);
      const result = (body as { result?: unknown }).result;
      if ((body as { ok?: unknown }).ok !== true || !Array.isArray(result) || result.some((u) => !u || typeof u !== "object" || !Number.isSafeInteger((u as TelegramUpdate).update_id)))
        throw new TelegramApiError("malformed", "getUpdates", "gateway returned malformed updates");
      return result as TelegramUpdate[];
    },
  };
}

/** Startup preflight: the Gateway is reachable and accepts this Agent's pull token. */
export async function checkGateway(input: { gatewayUrl: string; agentToken: string; fetch?: GatewayFetch }): Promise<void> {
  const doFetch = input.fetch ?? defaultFetch;
  const body = await gatewayGet(doFetch, `${input.gatewayUrl}/agent/ping`, input.agentToken, 15_000);
  if ((body as { ok?: unknown }).ok !== true) throw new TelegramApiError("malformed", "gatewayPing", "gateway ping returned a malformed body");
}

async function gatewayGet(doFetch: GatewayFetch, url: string, token: string, timeoutMs: number, outer?: AbortSignal): Promise<unknown> {
  const method = url.includes("/agent/ping") ? "gatewayPing" : "getUpdates";
  if (outer?.aborted) throw new TelegramApiError("aborted", method, `${method} aborted`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  let status: number;
  let text: string;
  try {
    const res = await doFetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    status = res.status;
    text = await res.text();
  } catch {
    if (outer?.aborted) throw new TelegramApiError("aborted", method, `${method} aborted`);
    throw new TelegramApiError("transient", method, "gateway network error or timeout");
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
  if (status === 401 || status === 403) throw new TelegramApiError("unauthorized", method, `gateway rejected the agent pull token (${status})`);
  if (status === 429 || status >= 500) throw new TelegramApiError("transient", method, `gateway unavailable (${status})`);
  if (status !== 200) throw new TelegramApiError("rejected", method, `gateway refused the request (${status})`);
  if (text.length > MAX_RESPONSE_BYTES) throw new TelegramApiError("malformed", method, "gateway response too large");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error();
    return parsed;
  } catch {
    throw new TelegramApiError("malformed", method, "gateway returned non-JSON");
  }
}
