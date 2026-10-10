/**
 * Manager notification policy — the single place that decides whether an internal lifecycle event
 * becomes an Owner-visible message.
 *
 * Internal components (scheduler, workers, validation, repair, quota/availability supervision) only
 * produce structured state; the human-interaction service reads it and asks this policy what, if
 * anything, the Owner should hear. The decision is semantic (event kind → Owner relevance), never a
 * comparison of message text. Every event that is not sent is still written to the audit stream as
 * suppressed/merged, so audit stays complete while the Owner only hears about things that need them
 * or that are a real result.
 */
import type { Milestone } from "./types";

/** Lifecycle events that never carry Owner-actionable information on their own. */
export const SILENT_LIFECYCLE_EVENTS = [
  "queued",
  "dispatched",
  "worker_started",
  "worker_completed",
  "validation_started",
  "validation_passed",
  "scheduler_tick",
  "internal_repair_started",
  "processing",
] as const;
export type LifecycleEvent = (typeof SILENT_LIFECYCLE_EVENTS)[number];
export type InternalEventKind = Milestone | LifecycleEvent;

export type OwnerRelevance =
  /** The Owner must act (decide, approve, unblock auth/quota/runtime). */
  | "action_required"
  /** A real result the Owner asked for (final outcome, answer, PR, guidance outcome). */
  | "result"
  /** Silent: audit only. */
  | "none";

/**
 * Why each milestone is (not) Owner-relevant. A worker selection/dispatch/start or an automatic,
 * recoverable repair adds nothing to the task acknowledgement the Owner already received.
 */
const RELEVANCE: Record<InternalEventKind, OwnerRelevance> = {
  // Silent: ordinary processing. The acknowledgement already said who works on it.
  queued: "none",
  dispatched: "none",
  worker_started: "none",
  worker_assigned: "none",
  worker_completed: "none",
  validation_started: "none",
  validation_passed: "none",
  scheduler_tick: "none",
  processing: "none",
  internal_repair_started: "none",
  repairing: "none",
  combined_repairing: "none",
  quota_handback: "none",
  part_completed: "none",
  // Owner action / attention required.
  awaiting_other_approval: "action_required",
  quota_takeover: "action_required",
  quota_paused: "action_required",
  availability_paused: "action_required",
  infrastructure_waiting: "action_required",
  combined_review_waiting: "action_required",
  combined_not_accepted: "action_required",
  deploy_waiting: "action_required",
  blocked: "action_required",
  guidance_rejected: "action_required",
  // Results.
  guidance_accepted: "result",
  pr_opened: "result",
  completed: "result",
  answered: "result",
  cancelled: "result",
  closed_without_deploy: "result",
  combined_accepted: "result",
};

export function ownerRelevance(kind: InternalEventKind): OwnerRelevance {
  return RELEVANCE[kind] ?? "none";
}

/** Higher first: when several events of one task are merged, the most important one leads. */
const PRIORITY: Partial<Record<Milestone, number>> = {
  blocked: 100,
  completed: 95,
  answered: 95,
  cancelled: 95,
  closed_without_deploy: 95,
  combined_accepted: 95,
  deploy_waiting: 80,
  combined_not_accepted: 90,
  awaiting_other_approval: 85,
  quota_paused: 80,
  availability_paused: 80,
  infrastructure_waiting: 75,
  combined_review_waiting: 75,
  // The outcome of the Owner's own guidance is the direct answer to what they just did.
  guidance_rejected: 88,
  guidance_accepted: 87,
  quota_takeover: 60,
  pr_opened: 50,
};

/**
 * Events whose news is already out of date when a later state is seen in the same observation
 * (e.g. "Codex temporarily takes over" when both Workers are already out of quota): not sent at all.
 */
const SUPERSEDED_BY: Partial<Record<InternalEventKind, readonly InternalEventKind[]>> = {
  quota_takeover: ["quota_paused", "availability_paused", "completed", "blocked", "cancelled"],
  pr_opened: ["blocked", "cancelled", "closed_without_deploy"],
};

export interface EventCandidate {
  /** Stable per-event identity (replay of the same internal event yields the same key). */
  key: string;
  kind: InternalEventKind;
  /** Owner-language text for this event alone. */
  detail: string;
}

export type SuppressionReason = `no_owner_value:${string}` | `superseded_by:${string}` | `merged_into:${string}`;

export interface NotificationDecision<C extends EventCandidate> {
  /** At most one Owner message per task per observation: the lead event plus merged details. */
  deliver: { lead: C; merged: C[]; detail: string } | null;
  /** Everything not sent separately, with the reason (audit only). */
  suppressed: { candidate: C; reason: SuppressionReason }[];
}

/**
 * Decides, for the new (not yet communicated) internal events of ONE task, what the Owner hears:
 * silent events are suppressed, and the remaining relevant events become ONE natural update led by
 * the most important event. Decision, approval and cancel notices (which carry buttons and authority
 * bindings) are never merged here; they stay their own messages.
 */
export function decideTaskNotification<C extends EventCandidate>(candidates: readonly C[]): NotificationDecision<C> {
  const suppressed: NotificationDecision<C>["suppressed"] = [];
  const relevant: C[] = [];
  for (const c of candidates) {
    const newer = candidates.find((o) => SUPERSEDED_BY[c.kind]?.includes(o.kind));
    if (ownerRelevance(c.kind) === "none") suppressed.push({ candidate: c, reason: `no_owner_value:${c.kind}` });
    else if (newer) suppressed.push({ candidate: c, reason: `superseded_by:${newer.key}` });
    else relevant.push(c);
  }
  if (relevant.length === 0) return { deliver: null, suppressed };
  const ordered = relevant
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (PRIORITY[b.c.kind as Milestone] ?? 0) - (PRIORITY[a.c.kind as Milestone] ?? 0) || a.i - b.i)
    .map((x) => x.c);
  const [lead, ...rest] = ordered;
  // Most important first: the update opens with what matters most to the Owner.
  const detail = ordered.map((c) => c.detail).filter((d, i, all) => d && all.indexOf(d) === i).join("\n");
  for (const c of rest) suppressed.push({ candidate: c, reason: `merged_into:${lead.key}` });
  return { deliver: { lead, merged: rest, detail }, suppressed };
}
