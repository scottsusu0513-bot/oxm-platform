import type { FetchLike, TelegramUpdate } from "./client";

export const FAKE_TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop";

export interface FakeBotApi {
  fetch: FetchLike;
  calls: { method: string; payload: Record<string, unknown>; url: string }[];
  sent: { chatId: number; text: string; messageId: number; buttons: unknown; replyTo: number | null }[];
  answered: { id: string; text: string }[];
  updates: TelegramUpdate[];
  /** Scripted responses for the next calls of a method (consumed in order). */
  script: Record<string, ({ status: number; body: string } | "network")[]>;
  username: string;
}

/** In-memory Telegram Bot API. getUpdates honours offset like the real API. */
export function createFakeBotApi(input: { token?: string; username?: string; firstMessageId?: number } = {}): FakeBotApi {
  const token = input.token ?? FAKE_TOKEN;
  let nextMessageId = input.firstMessageId ?? 1000;
  const api: FakeBotApi = {
    calls: [],
    sent: [],
    answered: [],
    updates: [],
    script: {},
    username: input.username ?? "OXM_Agent_bot",
    async fetch(url, init) {
      const m = /\/bot([^/]+)\/(\w+)$/.exec(url);
      const method = m?.[2] ?? "unknown";
      const payload = JSON.parse(init.body) as Record<string, unknown>;
      api.calls.push({ method, payload, url });
      const respond = (status: number, body: unknown) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
      const scripted = api.script[method]?.shift();
      if (scripted === "network") throw new Error(`connect ECONNREFUSED ${url}`);
      if (scripted) return respond(scripted.status, scripted.body);
      if (m?.[1] !== token) return respond(401, { ok: false, error_code: 401, description: "Unauthorized" });
      switch (method) {
        case "getMe":
          return respond(200, { ok: true, result: { id: 42, is_bot: true, username: api.username } });
        case "getUpdates": {
          const offset = typeof payload.offset === "number" ? payload.offset : 0;
          api.updates = api.updates.filter((u) => u.update_id >= offset);
          return respond(200, { ok: true, result: api.updates.slice(0, 100) });
        }
        case "sendMessage": {
          const messageId = nextMessageId++;
          const replyParams = payload.reply_parameters as { message_id?: number } | undefined;
          api.sent.push({
            chatId: payload.chat_id as number,
            text: payload.text as string,
            messageId,
            buttons: (payload.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard ?? null,
            replyTo: replyParams?.message_id ?? null,
          });
          return respond(200, { ok: true, result: { message_id: messageId, chat: { id: payload.chat_id, type: "private" } } });
        }
        case "answerCallbackQuery":
          api.answered.push({ id: payload.callback_query_id as string, text: payload.text as string });
          return respond(200, { ok: true, result: true });
        case "editMessageReplyMarkup":
          return respond(200, { ok: true, result: true });
        default:
          return respond(404, { ok: false, error_code: 404, description: "Not Found" });
      }
    },
  };
  return api;
}

let updateId = 5000;
export function textUpdate(input: { chatId: number; fromId?: number; text: string; messageId: number; replyTo?: number; chatType?: string; updateId?: number }): TelegramUpdate {
  return {
    update_id: input.updateId ?? ++updateId,
    message: {
      message_id: input.messageId,
      chat: { id: input.chatId, type: input.chatType ?? "private" },
      from: { id: input.fromId ?? input.chatId, is_bot: false },
      text: input.text,
      ...(input.replyTo !== undefined ? { reply_to_message: { message_id: input.replyTo, chat: { id: input.chatId, type: "private" } } } : {}),
    },
  };
}

export function callbackUpdate(input: { chatId: number; fromId?: number; data: string; messageId: number; id?: string; updateId?: number }): TelegramUpdate {
  return {
    update_id: input.updateId ?? ++updateId,
    callback_query: {
      id: input.id ?? `cb-${updateId}`,
      from: { id: input.fromId ?? input.chatId, is_bot: false },
      data: input.data,
      message: { message_id: input.messageId, chat: { id: input.chatId, type: "private" } },
    },
  };
}
