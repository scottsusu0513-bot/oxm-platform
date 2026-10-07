import type { InboundAction, InboundCancelRequest, InboundGoal, InboundReply } from "../humanInteraction/types";
import type { TelegramUpdate } from "./client";
import { parseCallbackData, REF_LINE } from "./format";

/**
 * Converts one untrusted Telegram update into at most one inbound human
 * event. Only private messages / button presses whose chat AND sender are the
 * configured owner are accepted; everything else is ignored with no effect.
 * Nothing in the update can name a task id, branch, HEAD, worker, risk,
 * approval binding or authority: goals carry instruction text (plus an
 * optional requested priority), replies carry text + the replied-to message,
 * buttons carry an opaque notice reference, and the server resolves the rest.
 */
export type ParsedUpdate =
  | { kind: "ignored"; reason: string }
  | { kind: "help"; chatId: number; messageId: number | null }
  | { kind: "usage"; chatId: number; messageId: number; command: "goal" | "status" }
  | { kind: "goal"; chatId: number; messageId: number; inbound: InboundGoal }
  | { kind: "tasks"; chatId: number; messageId: number }
  | { kind: "status"; chatId: number; messageId: number; reference: string }
  | { kind: "cancel"; chatId: number; messageId: number; inbound: InboundCancelRequest }
  | { kind: "reply"; chatId: number; messageId: number; inbound: InboundReply }
  | { kind: "action"; chatId: number; messageId: number; callbackQueryId: string; inbound: InboundAction };

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const PRIORITY = /^priority:(critical|high|normal|low)(?:\s+|$)/i;

export function parseUpdate(update: TelegramUpdate, ownerChatId: number, botId: number | null = null): ParsedUpdate {
  if (obj(update.callback_query)) {
    const q = update.callback_query;
    const from = obj(q.from) ? q.from : null;
    const message = obj(q.message) ? q.message : null;
    const chat = message && obj(message.chat) ? message.chat : null;
    if (typeof q.id !== "string" || !q.id || !from || from.id !== ownerChatId || from.is_bot === true) return { kind: "ignored", reason: "callback_not_from_owner" };
    if (!chat || chat.id !== ownerChatId || chat.type !== "private" || !int(message!.message_id)) return { kind: "ignored", reason: "callback_not_in_owner_chat" };
    const parsed = parseCallbackData(q.data);
    if (!parsed) return { kind: "ignored", reason: "callback_malformed" };
    return {
      kind: "action",
      chatId: ownerChatId,
      messageId: message!.message_id as number,
      callbackQueryId: q.id,
      inbound: {
        kind: "action",
        // Decisions dedupe per notice + action (a repeated tap never applies twice); a cancel
        // request is a harmless new confirmation each time, so it dedupes per tap.
        idempotencyKey: parsed.action === "cancel_request" ? `tg.cbq.${q.id.slice(0, 64)}` : `tg.cb.${parsed.ref}.${parsed.action}`,
        ref: parsed.ref,
        action: parsed.action,
      },
    };
  }
  if (!obj(update.message)) return { kind: "ignored", reason: "unsupported_update" };
  const m = update.message;
  const chat = obj(m.chat) ? m.chat : null;
  const from = obj(m.from) ? m.from : null;
  if (!chat || chat.type !== "private" || chat.id !== ownerChatId) return { kind: "ignored", reason: "not_owner_private_chat" };
  if (!from || from.id !== ownerChatId || from.is_bot === true) return { kind: "ignored", reason: "not_from_owner" };
  if (!int(m.message_id)) return { kind: "ignored", reason: "message_malformed" };
  if (typeof m.text !== "string") return { kind: "ignored", reason: "non_text_message" };
  const messageId = m.message_id;
  const base = { chatId: ownerChatId, messageId };

  const replied = obj(m.reply_to_message) ? m.reply_to_message : null;
  const replyTo = replied && int(replied.message_id) && (!obj(replied.chat) || replied.chat.id === ownerChatId) ? (replied.message_id as number) : null;
  // Fallback correlation only for messages provably sent by this bot; the ref is resolved through the ledger.
  const repliedFromBot = replied && obj(replied.from) && replied.from.is_bot === true && botId !== null && replied.from.id === botId;
  const replyRef = repliedFromBot && typeof replied!.text === "string" ? (REF_LINE.exec(replied!.text)?.[1] ?? null) : null;

  const text = m.text.trim();
  const command = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (command) {
    const name = command[1].toLowerCase();
    const arg = (command[2] ?? "").trim();
    if (name === "start" || name === "help") return { kind: "help", ...base };
    if (name === "goal") {
      if (!arg) return { kind: "usage", ...base, command: "goal" };
      const p = PRIORITY.exec(arg);
      const goalText = p ? arg.slice(p[0].length).trim() : arg;
      if (!goalText) return { kind: "usage", ...base, command: "goal" };
      return {
        kind: "goal",
        ...base,
        inbound: { kind: "goal", idempotencyKey: `tg.goal.${messageId}`, text: goalText, ...(p ? { priority: p[1].toLowerCase() as InboundGoal["priority"] } : {}) },
      };
    }
    if (name === "tasks") return { kind: "tasks", ...base };
    if (name === "status") return arg ? { kind: "status", ...base, reference: arg.slice(0, 80) } : { kind: "usage", ...base, command: "status" };
    if (name === "cancel") {
      const target = arg
        ? { taskReference: arg.slice(0, 80) }
        : replyTo !== null
          ? replyRef
            ? { noticeRef: replyRef }
            : { deliveryRef: String(replyTo) }
          : null;
      if (!target) return { kind: "help", ...base };
      return { kind: "cancel", ...base, inbound: { kind: "cancel_request", idempotencyKey: `tg.msg.${messageId}`, target } };
    }
    return { kind: "help", ...base };
  }
  return {
    kind: "reply",
    ...base,
    inbound: { kind: "reply", idempotencyKey: `tg.msg.${messageId}`, replyToDeliveryRef: replyTo === null ? null : String(replyTo), replyToNoticeRef: replyRef, text: m.text },
  };
}
