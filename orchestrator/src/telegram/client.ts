/**
 * Minimal Telegram Bot API client. The token lives only inside this closure
 * and the request URL; neither is ever placed in an error, log line, or
 * return value. Every call is bounded by an AbortController timeout, and
 * every response is validated before use (fail closed on malformed data).
 */

export type TelegramErrorKind = "transient" | "unauthorized" | "rejected" | "malformed" | "aborted";

export class TelegramApiError extends Error {
  constructor(
    readonly kind: TelegramErrorKind,
    readonly method: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  reply_to_message?: { message_id: number; chat?: TelegramChat; from?: TelegramUser };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: { message_id: number; chat: TelegramChat };
}

/** Raw update; parsed defensively by updates.ts. */
export interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramBotClient {
  getMe(signal?: AbortSignal): Promise<TelegramUser>;
  getUpdates(input: { offset: number | null; timeoutSeconds: number }, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  sendMessage(input: { chatId: number; text: string; replyToMessageId?: number; buttons?: InlineButton[][] }, signal?: AbortSignal): Promise<{ messageId: number }>;
  answerCallbackQuery(input: { callbackQueryId: string; text: string }, signal?: AbortSignal): Promise<void>;
  removeButtons(input: { chatId: number; messageId: number }, signal?: AbortSignal): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const MAX_RESPONSE_BYTES = 1_000_000;

export function createTelegramBotClient(input: {
  token: string;
  fetch?: FetchLike;
  /** Per-request bound for non-polling calls. */
  requestTimeoutMs?: number;
  apiBase?: string;
}): TelegramBotClient {
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const base = input.apiBase ?? "https://api.telegram.org";
  const requestTimeoutMs = input.requestTimeoutMs ?? 15_000;

  async function call<T>(method: string, payload: Record<string, unknown>, timeoutMs: number, outer?: AbortSignal): Promise<T> {
    if (outer?.aborted) throw new TelegramApiError("aborted", method, `${method} aborted`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    let status: number;
    let body: string;
    try {
      const response = await doFetch(`${base}/bot${input.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      status = response.status;
      body = await response.text();
    } catch {
      // Never forward the underlying error: it may embed the request URL (and so the token).
      if (outer?.aborted) throw new TelegramApiError("aborted", method, `${method} aborted`);
      throw new TelegramApiError("transient", method, `${method} network error or timeout`);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
    if (body.length > MAX_RESPONSE_BYTES) throw new TelegramApiError("malformed", method, `${method} response too large`);
    let parsed: { ok?: unknown; result?: unknown; error_code?: unknown; parameters?: { retry_after?: unknown } };
    try {
      parsed = JSON.parse(body);
    } catch {
      if (status >= 500) throw new TelegramApiError("transient", method, `${method} server error ${status}`);
      throw new TelegramApiError("malformed", method, `${method} returned non-JSON`);
    }
    if (!parsed || typeof parsed !== "object") throw new TelegramApiError("malformed", method, `${method} returned a malformed body`);
    if (parsed.ok === true && status >= 200 && status < 300 && "result" in parsed) return parsed.result as T;
    if (parsed.ok === true) throw new TelegramApiError("malformed", method, `${method} returned a malformed body`);
    const code = typeof parsed.error_code === "number" ? parsed.error_code : status;
    if (code === 401 || code === 404) throw new TelegramApiError("unauthorized", method, `${method} rejected the bot token (${code})`);
    if (code === 429) {
      const retry = Number(parsed.parameters?.retry_after);
      throw new TelegramApiError("transient", method, `${method} rate limited`, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) * 1000 : undefined);
    }
    if (code >= 500) throw new TelegramApiError("transient", method, `${method} server error ${code}`);
    // 400/403 etc.: the request itself was refused; Telegram's description is not relayed.
    throw new TelegramApiError("rejected", method, `${method} refused (${code})`);
  }

  const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

  return {
    async getMe(signal) {
      const me = await call<TelegramUser>("getMe", {}, requestTimeoutMs, signal);
      if (!me || typeof me !== "object" || !isInt(me.id) || me.is_bot !== true) throw new TelegramApiError("malformed", "getMe", "getMe returned a malformed identity");
      return { id: me.id, is_bot: true, username: typeof me.username === "string" ? me.username : undefined };
    },
    async getUpdates({ offset, timeoutSeconds }, signal) {
      const timeout = Math.max(0, Math.min(50, Math.floor(timeoutSeconds)));
      const result = await call<unknown>(
        "getUpdates",
        { ...(offset !== null ? { offset } : {}), timeout, allowed_updates: ["message", "callback_query"] },
        (timeout + 10) * 1000,
        signal,
      );
      if (!Array.isArray(result) || result.some((u) => !u || typeof u !== "object" || !isInt((u as TelegramUpdate).update_id)))
        throw new TelegramApiError("malformed", "getUpdates", "getUpdates returned malformed updates");
      return result as TelegramUpdate[];
    },
    async sendMessage({ chatId, text, replyToMessageId, buttons }, signal) {
      const result = await call<{ message_id?: unknown }>(
        "sendMessage",
        {
          chat_id: chatId,
          text,
          // Plain text only: no parse_mode, so task data can never inject markup or links.
          link_preview_options: { is_disabled: true },
          ...(replyToMessageId !== undefined ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } } : {}),
          ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
        },
        requestTimeoutMs,
        signal,
      );
      if (!result || !isInt(result.message_id)) throw new TelegramApiError("malformed", "sendMessage", "sendMessage returned a malformed message");
      return { messageId: result.message_id };
    },
    async answerCallbackQuery({ callbackQueryId, text }, signal) {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 190) }, requestTimeoutMs, signal);
    },
    async removeButtons({ chatId, messageId }, signal) {
      await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }, requestTimeoutMs, signal);
    },
  };
}
