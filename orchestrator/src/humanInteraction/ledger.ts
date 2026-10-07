import type { AuditRepository } from "../store/repositories";
import type { HumanInteractionLedger, InboundOutcome, NoticeKind, NoticeRecord } from "./types";

export const HUMAN_NOTICE_INTENT_EVENT = "human_notice_intent";
export const HUMAN_NOTICE_DELIVERED_EVENT = "human_notice_delivered";
export const HUMAN_TRANSPORT_CURSOR_EVENT = "human_transport_cursor";
export const HUMAN_INBOUND_HANDLED_EVENT = "human_inbound_handled";
export const HUMAN_TASK_TRACKED_EVENT = "human_task_tracked";
export const HUMAN_INTERACTION_STREAM = "human-interaction";

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
    } else if (e.event === HUMAN_TASK_TRACKED_EVENT) {
      if (!str(m.taskId) || typeof m.label !== "string") throw new Error("[human-interaction] malformed tracked-task record; refusing to load");
      tracked.set(m.taskId as string, { taskId: m.taskId as string, label: m.label });
    }
  }

  const append = (event: string, metadata: Record<string, string | number>) =>
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
    tracked: () => Array.from(tracked.values(), (t) => ({ ...t })),
    track(task) {
      if (tracked.has(task.taskId)) return;
      append(HUMAN_TASK_TRACKED_EVENT, { taskId: task.taskId, label: task.label });
      tracked.set(task.taskId, { ...task });
    },
  };
}
