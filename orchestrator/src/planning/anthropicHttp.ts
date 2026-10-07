/**
 * Minimal native-HTTP transport for the Anthropic Messages API, used only by
 * the Agent's trusted planning layer (intent planner + goal reviewer).
 *
 * It deliberately avoids the @anthropic-ai/sdk package: the OXM application
 * removed that dependency (see server/searchAiFallbackRouter.test.ts) and the
 * Agent must not bring it back. Behaviour mirrors what the planner relied on
 * from the SDK: per-attempt timeout, bounded retries with exponential backoff
 * (honouring retry-after / x-should-retry), and typed error classification.
 *
 * Secrets: the API key comes only from the caller (ANTHROPIC_API_KEY in the
 * environment at the entrypoint), is sent only in the x-api-key header, and is
 * never placed in an error message, log line or thrown value.
 */

export const ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export type AnthropicTransportErrorKind =
  | "timeout"
  | "network"
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "authentication"
  | "permission"
  | "invalid_request"
  | "not_found"
  | "refusal"
  | "truncated"
  | "malformed_response"
  | "configuration";

const TRANSIENT_KINDS: ReadonlySet<AnthropicTransportErrorKind> = new Set<AnthropicTransportErrorKind>(["timeout", "network", "rate_limited", "overloaded", "server_error"]);

/** Typed failure. The message carries only the kind, HTTP status and API error type — never request headers or bodies. */
export class AnthropicTransportError extends Error {
  readonly kind: AnthropicTransportErrorKind;
  readonly transient: boolean;
  readonly status: number | null;
  readonly apiErrorType: string | null;
  constructor(kind: AnthropicTransportErrorKind, details: { status?: number | null; apiErrorType?: string | null; attempts?: number } = {}) {
    const status = details.status ?? null;
    const apiErrorType = details.apiErrorType && /^[a-z_]{1,64}$/.test(details.apiErrorType) ? details.apiErrorType : null;
    super(`anthropic ${kind}${status !== null ? ` (HTTP ${status}${apiErrorType ? ` ${apiErrorType}` : ""})` : ""}${details.attempts ? ` after ${details.attempts} attempt(s)` : ""}`);
    this.name = "AnthropicTransportError";
    this.kind = kind;
    this.transient = TRANSIENT_KINDS.has(kind);
    this.status = status;
    this.apiErrorType = apiErrorType;
  }
}

export interface AnthropicMessageResponse {
  stopReason: string | null;
  text: string;
}

export interface AnthropicMessagesTransport {
  /** POST /v1/messages. `betas` become the anthropic-beta header; everything else is the JSON body. */
  createMessage(request: { betas?: readonly string[]; body: Record<string, unknown> }): Promise<AnthropicMessageResponse>;
}

export interface AnthropicHttpTransportOptions {
  apiKey: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt, for transient failures only. */
  maxRetries?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

function classifyStatus(status: number): AnthropicTransportErrorKind {
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 409) return "server_error";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server_error";
  return "invalid_request";
}

function retryAfterMs(headers: Headers): number | null {
  const ms = Number(headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS) : null;
}

async function apiErrorType(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { type?: unknown } };
    return typeof body?.error?.type === "string" ? body.error.type : null;
  } catch {
    return null;
  }
}

/** Fail closed: anything that is not a well-formed Messages response is rejected. */
export function parseMessageResponse(payload: unknown): AnthropicMessageResponse {
  if (!payload || typeof payload !== "object") throw new AnthropicTransportError("malformed_response");
  const { content, stop_reason: stopReason } = payload as { content?: unknown; stop_reason?: unknown };
  if (!Array.isArray(content) || (stopReason !== null && stopReason !== undefined && typeof stopReason !== "string")) throw new AnthropicTransportError("malformed_response");
  if (stopReason === "refusal") throw new AnthropicTransportError("refusal");
  if (stopReason === "max_tokens") throw new AnthropicTransportError("truncated");
  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") throw new AnthropicTransportError("malformed_response");
    const b = block as { type?: unknown; text?: unknown };
    if (b.type !== "text") continue;
    if (typeof b.text !== "string") throw new AnthropicTransportError("malformed_response");
    text += b.text;
  }
  return { stopReason: (stopReason as string | null | undefined) ?? null, text };
}

export function createAnthropicHttpTransport(options: AnthropicHttpTransportOptions): AnthropicMessagesTransport {
  const apiKey = options.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "" || /[\r\n]/.test(apiKey)) throw new AnthropicTransportError("configuration");
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 5));
  const url = `${(options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, "")}/v1/messages`;
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  async function attempt(headers: Record<string, string>, body: string): Promise<{ result: AnthropicMessageResponse } | { error: AnthropicTransportError; retry: boolean; delayMs: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await doFetch(url, { method: "POST", headers, body, signal: controller.signal });
      } catch {
        // The underlying error may echo request details; it is never propagated.
        const kind = controller.signal.aborted ? "timeout" : "network";
        return { error: new AnthropicTransportError(kind), retry: true, delayMs: null };
      }
      if (!response.ok) {
        const kind = classifyStatus(response.status);
        const error = new AnthropicTransportError(kind, { status: response.status, apiErrorType: await apiErrorType(response) });
        const header = response.headers.get("x-should-retry");
        const retry = header === "true" ? true : header === "false" ? false : error.transient;
        return { error, retry, delayMs: retryAfterMs(response.headers) };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (controller.signal.aborted) return { error: new AnthropicTransportError("timeout"), retry: true, delayMs: null };
        throw new AnthropicTransportError("malformed_response", { status: response.status });
      }
      return { result: parseMessageResponse(payload) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createMessage(request) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        "anthropic-version": ANTHROPIC_API_VERSION,
        "x-api-key": apiKey,
      };
      if (request.betas && request.betas.length > 0) headers["anthropic-beta"] = request.betas.join(",");
      const body = JSON.stringify(request.body);
      for (let n = 0; ; n++) {
        const outcome = await attempt(headers, body);
        if ("result" in outcome) return outcome.result;
        if (!outcome.retry || n >= maxRetries)
          throw new AnthropicTransportError(outcome.error.kind, { status: outcome.error.status, apiErrorType: outcome.error.apiErrorType, attempts: n + 1 });
        const backoff = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** n, MAX_RETRY_DELAY_MS) * (1 - random() * 0.25);
        await sleep(outcome.delayMs ?? backoff);
      }
    },
  };
}

/** Entry-point helper: the key is read only from ANTHROPIC_API_KEY; absence yields null (planner disabled, fail closed). */
export function createAnthropicHttpTransportFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: Omit<AnthropicHttpTransportOptions, "apiKey"> = {},
): AnthropicMessagesTransport | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  try {
    return createAnthropicHttpTransport({ ...options, apiKey: apiKey.trim() });
  } catch {
    return null;
  }
}
