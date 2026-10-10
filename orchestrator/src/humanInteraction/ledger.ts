import type { AuditRepository } from "../store/repositories";
import type { HumanInteractionLedger, InboundOutcome, NoticeKind, NoticeRecord } from "./types";

export const HUMAN_NOTICE_INTENT_EVENT = "human_notice_intent";
export const HUMAN_NOTICE_DELIVERED_EVENT = "human_notice_delivered";
export const HUMAN_TRANSPORT_CURSOR_EVENT = "human_transport_cursor";
export const HUMAN_INBOUND_HANDLED_EVENT = "human_inbound_handled";
export const HUMAN_TASK_TRACKED_EVENT = "human_task_tracked";
export const HUMAN_CONVERSATION_FOCUS_EVENT = "human_conversation_focus";
export const HUMAN_RESPONSE_INTENT_EVENT = "human_response_intent";
export const HUMAN_RESPONSE_DELIVERED_EVENT = "human_response_delivered";
export const HUMAN_RESPONSE_FAILED_EVENT = "human_response_failed";
export const HUMAN_RESPONSE_ABANDONED_EVENT = "human_response_abandoned";
export const HUMAN_NOTICE_SUPPRESSED_EVENT = "human_notice_suppressed";
/** Transport statuses the owner already received for one inbound message (durable Manager context; voice=system_status). */
export const HUMAN_TRANSPORT_CONTEXT_EVENT = "human_transport_context";
/** The Manager's own owner-facing text for one notice (durable, so a retry / restart never re-asks or degrades). */
export const HUMAN_MANAGER_TEXT_EVENT = "human_manager_text";
export const HUMAN_INTERACTION_STREAM = "human-interaction";

/** An internal event the notification policy decided NOT to send on its own (audit only; never a delivery). */
export interface SuppressedNotice {
  noticeId: string;
  taskId: string;
  /** Internal event kind (e.g. worker_assigned). */
  event: string;
  /** `no_owner_value:<kind>` or `merged_into:<key>`. */
  reason: string;
  createdAt: string;
}

/**
 * One logical human-facing response to one inbound transport event (e.g. the answer to one
 * Telegram message). Its identity is the inbound event + response kind — never the text — so two
 * different messages that happen to produce the same words are two responses, and one message is
 * answered at most once even when the update is re-handled (restart, re-claim, redelivery).
 */
export interface ResponseRecord {
  responseId: string;
  /** The exact text to (re)send while delivery is unconfirmed; "" when the response needs no message. */
  text: string;
  chatId: number;
  replyTo: number | null;
  deliveryRef: string | null;
  failures: number;
  abandoned: boolean;
  createdAt: string;
}

export interface HandledInbound {
  idempotencyKey: string;
  outcome: InboundOutcome;
}

export interface TrackedTask {
  taskId: string;
  /** Short sanitized label derived from the owner's own goal text. */
  label: string;
}

export interface AuditHumanInteractionLedger extends HumanInteractionLedger {
  /** Final outcome of an inbound message/action already handled (duplicate delivery guard). */
  handled(idempotencyKey: string): HandledInbound | null;
  recordHandled(entry: HandledInbound): void;
  /** Tasks whose milestones are reported to the human. */
  tracked(): TrackedTask[];
  track(task: TrackedTask): void;
  /** Task most recently discussed with the owner (conversation context for the Manager); null when none. */
  focus(): string | null;
  setFocus(taskId: string): void;
  response(responseId: string): ResponseRecord | null;
  /** Written BEFORE the send: the logical response exists once, whatever happens to the transport. */
  recordResponseIntent(record: { responseId: string; text: string; chatId: number; replyTo: number | null; createdAt: string }): void;
  recordResponseDelivered(responseId: string, deliveryRef: string): void;
  recordResponseFailed(responseId: string): void;
  recordResponseAbandoned(responseId: string): void;
  /** Responses whose delivery is not confirmed and not abandoned (oldest first). */
  pendingResponses(): ResponseRecord[];
  /** Policy decision that an internal event is not sent separately (null when never decided). */
  suppressed(noticeId: string): SuppressedNotice | null;
  recordSuppressed(entry: SuppressedNotice): void;
  /** What the transport already told the owner about one inbound message (empty when nothing). */
  transportContext(idempotencyKey: string): string[];
  recordTransportContext(entry: { idempotencyKey: string; statuses: string[] }): void;
  managerText(noticeId: string): { text: string; status: string } | null;
  recordManagerText(entry: { noticeId: string; text: string; status: string }): void;
}

const NOTICE_KINDS = new Set<NoticeKind>(["human_decision", "commit_publish_approval", "start_approval", "milestone", "cancel_confirmation"]);
const str = (v: unknown) => typeof v === "string" && v !== "";

/**
 * Human-interaction dedupe/correlation state stored as events in the existing
 * append-only audit repository (its own stream). With a durable audit
 * repository this survives restart: delivered notices are not re-sent,
 * reply/button correlation keeps working, the transport cursor is resumed,
 * and already-handled inbound messages are not re-applied. A send intent is
 * recorded before every transport call, so a crash between "sent" and
 * "recorded" is detected and the re-send is marked as a possible duplicate.
 */
export function createAuditHumanInteractionLedger(input: {
  audit: AuditRepository;
  nextId: () => string;
  now?: () => string;
  streamTaskId?: string;
}): AuditHumanInteractionLedger {
  const stream = input.streamTaskId ?? HUMAN_INTERACTION_STREAM;
  const now = input.now ?? (() => new Date().toISOString());
  const notices = new Map<string, NoticeRecord>();
  const byDelivery = new Map<string, string>();
  const byRef = new Map<string, string>();
  const cursors = new Map<string, number>();
  const handled = new Map<string, HandledInbound>();
  const tracked = new Map<string, TrackedTask>();
  const responses = new Map<string, ResponseRecord>();
  const suppressed = new Map<string, SuppressedNotice>();
  const transport = new Map<string, string[]>();
  const managerTexts = new Map<string, { text: string; status: string }>();
  let focus: string | null = null;

  for (const e of input.audit.list({ taskId: stream })) {
    const m = e.metadata as Record<string, unknown>;
    if (e.event === HUMAN_NOTICE_INTENT_EVENT) {
      if (!["noticeId", "ref", "taskId", "targetId", "createdAt"].every((k) => str(m[k])) || !NOTICE_KINDS.has(m.kind as NoticeKind))
        throw new Error("[human-interaction] malformed notice-intent record; refusing to load");
      if (!notices.has(m.noticeId as string)) {
        notices.set(m.noticeId as string, { noticeId: m.noticeId as string, kind: m.kind as NoticeKind, ref: m.ref as string, taskId: m.taskId as string, targetId: m.targetId as string, deliveryRef: null, createdAt: m.createdAt as string });
        byRef.set(m.ref as string, m.noticeId as string);
      }
    } else if (e.event === HUMAN_NOTICE_DELIVERED_EVENT) {
      const n = notices.get(m.noticeId as string);
      if (!n || !str(m.deliveryRef)) throw new Error("[human-interaction] malformed delivered-notice record; refusing to load");
      n.deliveryRef = m.deliveryRef as string;
      byDelivery.set(n.deliveryRef, n.noticeId);
    } else if (e.event === HUMAN_TRANSPORT_CURSOR_EVENT) {
      if (typeof m.transport !== "string" || !Number.isSafeInteger(m.value)) throw new Error("[human-interaction] malformed cursor record; refusing to load");
      cursors.set(m.transport, m.value as number);
    } else if (e.event === HUMAN_INBOUND_HANDLED_EVENT) {
      if (!str(m.idempotencyKey) || !str(m.outcome)) throw new Error("[human-interaction] malformed inbound record; refusing to load");
      handled.set(m.idempotencyKey as string, { idempotencyKey: m.idempotencyKey as string, outcome: m.outcome as InboundOutcome });
    } else if (e.event === HUMAN_CONVERSATION_FOCUS_EVENT) {
      if (!str(m.taskId)) throw new Error("[human-interaction] malformed focus record; refusing to load");
      focus = m.taskId as string;
    } else if (e.event === HUMAN_RESPONSE_INTENT_EVENT) {
      if (!str(m.responseId) || typeof m.text !== "string" || !Number.isSafeInteger(m.chatId) || !str(m.createdAt)) throw new Error("[human-interaction] malformed response-intent record; refusing to load");
      if (!responses.has(m.responseId as string))
        responses.set(m.responseId as string, { responseId: m.responseId as string, text: m.text, chatId: m.chatId as number, replyTo: Number.isSafeInteger(m.replyTo) ? (m.replyTo as number) : null, deliveryRef: null, failures: 0, abandoned: false, createdAt: m.createdAt as string });
    } else if (e.event === HUMAN_RESPONSE_DELIVERED_EVENT || e.event === HUMAN_RESPONSE_FAILED_EVENT || e.event === HUMAN_RESPONSE_ABANDONED_EVENT) {
      const r = responses.get(m.responseId as string);
      if (!r) throw new Error("[human-interaction] response outcome without intent; refusing to load");
      if (e.event === HUMAN_RESPONSE_DELIVERED_EVENT) {
        if (!str(m.deliveryRef)) throw new Error("[human-interaction] malformed delivered-response record; refusing to load");
        r.deliveryRef = m.deliveryRef as string;
      } else if (e.event === HUMAN_RESPONSE_FAILED_EVENT) r.failures++;
      else r.abandoned = true;
    } else if (e.event === HUMAN_NOTICE_SUPPRESSED_EVENT) {
      if (!["noticeId", "taskId", "event", "reason", "createdAt"].every((k) => str(m[k]))) throw new Error("[human-interaction] malformed suppressed-notice record; refusing to load");
      if (!suppressed.has(m.noticeId as string))
        suppressed.set(m.noticeId as string, { noticeId: m.noticeId as string, taskId: m.taskId as string, event: m.event as string, reason: m.reason as string, createdAt: m.createdAt as string });
    } else if (e.event === HUMAN_TRANSPORT_CONTEXT_EVENT) {
      if (!str(m.idempotencyKey) || !str(m.statuses)) throw new Error("[human-interaction] malformed transport-context record; refusing to load");
      if (!transport.has(m.idempotencyKey as string)) transport.set(m.idempotencyKey as string, (m.statuses as string).split(","));
    } else if (e.event === HUMAN_MANAGER_TEXT_EVENT) {
      if (!str(m.noticeId) || !str(m.text) || !str(m.status)) throw new Error("[human-interaction] malformed manager-text record; refusing to load");
      if (!managerTexts.has(m.noticeId as string)) managerTexts.set(m.noticeId as string, { text: m.text as string, status: m.status as string });
    } else if (e.event === HUMAN_TASK_TRACKED_EVENT) {
      if (!str(m.taskId) || typeof m.label !== "string") throw new Error("[human-interaction] malformed tracked-task record; refusing to load");
      tracked.set(m.taskId as string, { taskId: m.taskId as string, label: m.label });
    }
  }

  const append = (event: string, metadata: Record<string, string | number | null>) =>
    input.audit.append({ id: input.nextId(), taskId: stream, actor: "system", event, metadata });
  const get = (id: string | undefined) => (id && notices.has(id) ? { ...notices.get(id)! } : null);

  return {
    byNotice: (noticeId) => get(noticeId),
    byDeliveryRef: (ref) => get(byDelivery.get(ref)),
    byRef: (ref) => get(byRef.get(ref)),
    recordIntent(notice) {
      if (notices.has(notice.noticeId)) return;
      const sameRef = byRef.get(notice.ref);
      if (sameRef && sameRef !== notice.noticeId) throw new Error("[human-interaction] notice reference collision");
      append(HUMAN_NOTICE_INTENT_EVENT, { ...notice });
      notices.set(notice.noticeId, { ...notice, deliveryRef: null });
      byRef.set(notice.ref, notice.noticeId);
    },
    recordDelivered(noticeId, deliveryRef) {
      const n = notices.get(noticeId);
      if (!n) throw new Error("[human-interaction] delivery without intent");
      if (n.deliveryRef !== null) return;
      append(HUMAN_NOTICE_DELIVERED_EVENT, { noticeId, deliveryRef, deliveredAt: now() });
      n.deliveryRef = deliveryRef;
      byDelivery.set(deliveryRef, noticeId);
    },
    cursor: (transport) => cursors.get(transport) ?? null,
    setCursor(transport, value) {
      if (!Number.isSafeInteger(value) || value < (cursors.get(transport) ?? 0)) throw new Error("[human-interaction] cursor must advance");
      if (cursors.get(transport) === value) return;
      append(HUMAN_TRANSPORT_CURSOR_EVENT, { transport, value });
      cursors.set(transport, value);
    },
    handled: (key) => (handled.has(key) ? { ...handled.get(key)! } : null),
    recordHandled(entry) {
      if (handled.has(entry.idempotencyKey)) return;
      append(HUMAN_INBOUND_HANDLED_EVENT, { idempotencyKey: entry.idempotencyKey, outcome: entry.outcome });
      handled.set(entry.idempotencyKey, { ...entry });
    },
    focus: () => focus,
    setFocus(taskId) {
      if (focus === taskId) return;
      append(HUMAN_CONVERSATION_FOCUS_EVENT, { taskId });
      focus = taskId;
    },
    response: (id) => (responses.has(id) ? { ...responses.get(id)! } : null),
    recordResponseIntent(record) {
      if (responses.has(record.responseId)) return;
      append(HUMAN_RESPONSE_INTENT_EVENT, { responseId: record.responseId, text: record.text, chatId: record.chatId, replyTo: record.replyTo, createdAt: record.createdAt });
      responses.set(record.responseId, { ...record, deliveryRef: null, failures: 0, abandoned: false });
    },
    recordResponseDelivered(id, deliveryRef) {
      const r = responses.get(id);
      if (!r) throw new Error("[human-interaction] response delivery without intent");
      if (r.deliveryRef !== null) return;
      append(HUMAN_RESPONSE_DELIVERED_EVENT, { responseId: id, deliveryRef, deliveredAt: now() });
      r.deliveryRef = deliveryRef;
    },
    recordResponseFailed(id) {
      const r = responses.get(id);
      if (!r || r.deliveryRef !== null) return;
      append(HUMAN_RESPONSE_FAILED_EVENT, { responseId: id, failedAt: now() });
      r.failures++;
    },
    recordResponseAbandoned(id) {
      const r = responses.get(id);
      if (!r || r.deliveryRef !== null || r.abandoned) return;
      append(HUMAN_RESPONSE_ABANDONED_EVENT, { responseId: id, abandonedAt: now() });
      r.abandoned = true;
    },
    pendingResponses: () => Array.from(responses.values(), (r) => ({ ...r })).filter((r) => r.deliveryRef === null && !r.abandoned),
    suppressed: (id) => (suppressed.has(id) ? { ...suppressed.get(id)! } : null),
    recordSuppressed(entry) {
      if (suppressed.has(entry.noticeId) || notices.has(entry.noticeId)) return;
      append(HUMAN_NOTICE_SUPPRESSED_EVENT, { ...entry });
      suppressed.set(entry.noticeId, { ...entry });
    },
    transportContext: (key) => [...(transport.get(key) ?? [])],
    recordTransportContext({ idempotencyKey, statuses }) {
      if (transport.has(idempotencyKey) || statuses.length === 0) return;
      append(HUMAN_TRANSPORT_CONTEXT_EVENT, { idempotencyKey, statuses: statuses.join(","), voice: "system_status" });
      transport.set(idempotencyKey, [...statuses]);
    },
    managerText: (id) => (managerTexts.has(id) ? { ...managerTexts.get(id)! } : null),
    recordManagerText({ noticeId, text, status }) {
      if (managerTexts.has(noticeId)) return;
      append(HUMAN_MANAGER_TEXT_EVENT, { noticeId, text, status, voice: "manager" });
      managerTexts.set(noticeId, { text, status });
    },
    tracked: () => Array.from(tracked.values(), (t) => ({ ...t })),
    track(task) {
      if (tracked.has(task.taskId)) return;
      append(HUMAN_TASK_TRACKED_EVENT, { taskId: task.taskId, label: task.label });
      tracked.set(task.taskId, { ...task });
    },
  };
}
