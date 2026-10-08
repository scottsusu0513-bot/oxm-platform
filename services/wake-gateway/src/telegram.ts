import type { FetchFn, GatewayLog, ProjectedKind, ProjectedMessageUpdate, ProjectedUpdate } from "./types";

/**
 * Untrusted Telegram update -> owner-only projection. Accepts exactly what the
 * Agent's parseUpdate would accept from the owner (private chat, owner sender,
 * not a bot) and keeps only the fields parseUpdate reads, so the Agent sees the
 * same semantics as a direct getUpdates. The Gateway never interprets the text.
 */
export type Projection =
  | { kind: "accepted"; updateId: number; updateKind: ProjectedKind; update: ProjectedUpdate }
  | { kind: "ignored"; updateId: number | null; reason: string };

export const MAX_TEXT_LENGTH = 8192;
const MAX_CALLBACK_ID = 128;
const MAX_CALLBACK_DATA = 256;

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);

export function projectUpdate(raw: unknown, ownerChatId: number): Projection {
  if (!obj(raw) || !int(raw.update_id) || raw.update_id < 0) return { kind: "ignored", updateId: null, reason: "malformed" };
  const updateId = raw.update_id;
  const ignored = (reason: string): Projection => ({ kind: "ignored", updateId, reason });

  if (obj(raw.callback_query)) {
    const q = raw.callback_query;
    const from = obj(q.from) ? q.from : null;
    const message = obj(q.message) ? q.message : null;
    const chat = message && obj(message.chat) ? message.chat : null;
    if (typeof q.id !== "string" || !q.id || q.id.length > MAX_CALLBACK_ID || !from || from.id !== ownerChatId || from.is_bot === true) return ignored("callback_not_from_owner");
    if (!chat || chat.id !== ownerChatId || chat.type !== "private" || !int(message!.message_id)) return ignored("callback_not_in_owner_chat");
    if (typeof q.data !== "string" || q.data.length > MAX_CALLBACK_DATA) return ignored("callback_malformed");
    return {
      kind: "accepted",
      updateId,
      updateKind: "callback_query",
      update: {
        update_id: updateId,
        callback_query: { id: q.id, from: { id: ownerChatId, is_bot: false }, data: q.data, message: { message_id: message!.message_id as number, chat: { id: ownerChatId, type: "private" } } },
      },
    };
  }

  if (!obj(raw.message)) return ignored("unsupported_update");
  const m = raw.message;
  const chat = obj(m.chat) ? m.chat : null;
  const from = obj(m.from) ? m.from : null;
  if (!chat || chat.type !== "private" || chat.id !== ownerChatId) return ignored("not_owner_private_chat");
  if (!from || from.id !== ownerChatId || from.is_bot === true) return ignored("not_from_owner");
  if (!int(m.message_id)) return ignored("message_malformed");
  if (typeof m.text !== "string") return ignored("non_text_message");
  if (m.text.length > MAX_TEXT_LENGTH) return ignored("oversized");

  const message: ProjectedMessageUpdate = {
    update_id: updateId,
    message: { message_id: m.message_id, chat: { id: ownerChatId, type: "private" }, from: { id: ownerChatId, is_bot: false }, text: m.text },
  };
  if (obj(m.reply_to_message)) {
    const r = m.reply_to_message;
    const reply: NonNullable<ProjectedMessageUpdate["message"]["reply_to_message"]> = {};
    if (int(r.message_id)) reply.message_id = r.message_id;
    if (obj(r.chat)) reply.chat = { ...(int(r.chat.id) ? { id: r.chat.id } : {}), ...(typeof r.chat.type === "string" ? { type: r.chat.type.slice(0, 32) } : {}) };
    if (obj(r.from)) reply.from = { ...(int(r.from.id) ? { id: r.from.id } : {}), ...(typeof r.from.is_bot === "boolean" ? { is_bot: r.from.is_bot } : {}) };
    if (typeof r.text === "string" && r.text.length <= MAX_TEXT_LENGTH) reply.text = r.text;
    message.message.reply_to_message = reply;
  }
  return { kind: "accepted", updateId, updateKind: "message", update: message };
}

/** Fixed operational notices; none carries owner content or any Manager answer. */
export type NoticeKind = "waking" | "wake_failed" | "agent_offline" | "queue_full" | "expired";
export type WakeFailureReason =
  | "credential"
  | "billing"
  | "not_found"
  | "repo_mismatch"
  | "terminal_state"
  | "rejected"
  | "malformed"
  | "github_unavailable"
  | "start_timeout"
  | "start_exhausted"
  | "daily_cap";

const FAILURE_TEXT: Record<WakeFailureReason, string> = {
  credential: "GitHub 喚醒權限無效或已過期",
  billing: "GitHub Codespaces 額度或帳單問題",
  not_found: "找不到指定的 Codespace（可能已被刪除）",
  repo_mismatch: "Codespace 綁定的 repo 與設定不符",
  terminal_state: "Codespace 目前的狀態無法啟動",
  rejected: "GitHub 拒絕了啟動請求",
  malformed: "GitHub 回應格式異常",
  github_unavailable: "GitHub 暫時無法連線",
  start_timeout: "Codespace 啟動逾時",
  start_exhausted: "Codespace 多次啟動後仍未就緒",
  daily_cap: "今天的自動喚醒次數已達上限",
};

export function noticeText(kind: NoticeKind, detail: { pending?: number; reason?: WakeFailureReason; blocked?: boolean; minutes?: number } = {}): string {
  switch (kind) {
    case "waking":
      return `🔄 OXM Agent 目前離線，正在喚醒 Codespace（排隊中 ${detail.pending ?? 0} 則訊息）。上線後會依序處理，請稍候。`;
    case "wake_failed":
      return [
        `⚠️ 無法喚醒 OXM Agent：${FAILURE_TEXT[detail.reason ?? "rejected"]}。`,
        "你的訊息仍保留在佇列中。",
        detail.blocked ? "需要人工檢查設定；在此之前不會再自動嘗試喚醒。" : "稍後再傳一則訊息即可重新嘗試喚醒。",
      ].join("\n");
    case "agent_offline":
      return `⚠️ Codespace 已啟動，但 OXM Agent 在 ${detail.minutes ?? 0} 分鐘內沒有上線。你的訊息仍保留在佇列中；請檢查 Agent 狀態（pnpm orchestrator:telegram:status）。`;
    case "queue_full":
      return "⚠️ 待處理佇列已滿，最近的訊息沒有收件。請等 OXM Agent 上線處理後再傳。";
    case "expired":
      return `⚠️ 有 ${detail.pending ?? 0} 則訊息排隊超過 7 天仍未被 OXM Agent 處理，已丟棄。`;
  }
}

export interface OwnerNotifier {
  send(text: string): Promise<boolean>;
}

/** Plain-text sendMessage to the owner only. Errors never carry the token (it is part of the URL). */
export function createOwnerNotifier(input: { botToken: string; ownerChatId: number; fetch: FetchFn; log: GatewayLog; timeoutMs?: number }): OwnerNotifier {
  return {
    async send(text) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
      try {
        const res = await input.fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: input.ownerChatId, text, link_preview_options: { is_disabled: true } }),
          signal: controller.signal,
        });
        input.log("notice_sent", { status: res.status });
        return res.status >= 200 && res.status < 300;
      } catch {
        input.log("notice_failed");
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
