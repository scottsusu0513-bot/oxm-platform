/**
 * Trusted planning layer (Manager side) — ports and validated decisions.
 *
 * Two model-backed components live behind these ports:
 *  - IntentPlanner: turns one owner message into an internal intent / goal.
 *  - GoalReviewer: judges each semantic goal criterion against trusted
 *    evidence (Git diff, the read-only answer, cited repository files).
 * Their raw outputs are untrusted structured data: deterministic validators
 * in ./normalize decide what is accepted. Neither port can run tools, touch
 * Git, choose a Worker, scope, branch or risk.
 */
import type { AgentIntent, TaskCreatingIntent, TaskMode } from "../domain/types";

export interface PlannerTaskContext {
  taskId: string;
  title: string;
  status: string;
  mode: TaskMode;
  /** Trusted lineage: this task re-runs that earlier task's original goal. */
  retryOf?: string | null;
}

/**
 * What a follow-up about a known task asks (semantic, from the GPT Manager).
 * The answer itself is composed from trusted task state only.
 */
export const FOLLOW_UP_TOPICS = ["status", "result", "reason", "remediation", "retry_eligibility"] as const;
export type FollowUpTopic = (typeof FOLLOW_UP_TOPICS)[number];

/**
 * Trusted facts about one known task, given to the Manager in its interpretation turn so its reply to a
 * follow-up is grounded (no second call). Every field comes from the orchestrator, never from a Worker.
 */
export interface TrustedTaskState {
  taskId: string;
  title: string;
  /** Internal status (e.g. running, needs_human_decision, accepted, blocked). */
  status: string;
  mode: TaskMode;
  outcome: "completed" | "failed" | "cancelled" | "active";
  /** Trusted stop-reason class of a failed/cancelled task (null: unknown or not stopped). */
  stopReason: string | null;
  /** Plain English description of the stop reason (fixed text per class). */
  stopReasonFact: string | null;
  /** Deterministic description of the classified Git metadata delta (which component, which class); null: none. */
  gitMetadataFact?: string | null;
  /** Deterministic re-run verdict (null when it could not be assessed). */
  retry: { kind: string; detail: string } | null;
  worker: string | null;
  prNumber: number | null;
  /** The Manager's own earlier result summary / answer for the owner, when one exists. */
  managerResult: string | null;
  retryOf: string | null;
  /** Open owner decision (escalation after unresolved repair): what still fails and the Manager's own diagnosis. */
  openDecision?: { failingCheck: string; rootCause: string; recommendation: string; attempts: number; stagnated: boolean } | null;
}

/** Transport statuses the owner already received for this message while the Agent was offline. */
export const TRANSPORT_STATUS_CONTEXT = ["waking", "wake_failed", "agent_offline", "queue_full"] as const;
export type TransportStatusContext = (typeof TRANSPORT_STATUS_CONTEXT)[number];

export interface IntentPlannerInput {
  /** The owner's message (already screened for credentials). */
  message: string;
  /**
   * Task the message replied to (trusted correlation ledger), else the one open decision, else the
   * task most recently discussed in this conversation.
   */
  contextTaskId: string | null;
  /** Known tasks (trusted runtime state), newest first, bounded. */
  tasks: readonly PlannerTaskContext[];
  /** Explicit /goal: only task-creating intents are acceptable. */
  requireTask: boolean;
  /** Trusted state of the context task and the newest tasks (bounded): the facts a follow-up reply may use. */
  taskStates?: readonly TrustedTaskState[];
  /** Automatic transport statuses the owner already received for this message (never a Manager reply). */
  transportContext?: readonly TransportStatusContext[];
}

/** The Manager's proactive message for a terminal task state; returns raw, untrusted { ownerReply }. */
export interface OwnerNoticeComposer {
  compose(input: { lang: "zh" | "en"; label: string; state: TrustedTaskState }): Promise<unknown>;
}

export interface IntentPlanner {
  /** Returns raw, untrusted structured output; see normalizeIntentDecision. */
  interpret(input: IntentPlannerInput): Promise<unknown>;
}

export type IntentDecision =
  | {
      kind: "task";
      intent: TaskCreatingIntent;
      mode: TaskMode;
      title: string;
      interpretedObjective: string;
      /** Semantic goal criteria (observable outcomes), 1-8. */
      criteria: string[];
      /** Typed risk observations (RiskSignalKind). They can only raise intake risk. */
      riskObservations: string[];
      /** Work areas the Manager declared; the fixed assignment policy may add (never drop) areas. */
      workAreas?: { programming: boolean; visual: boolean };
      programmingObjective?: string | null;
      visualObjective?: string | null;
      /** The Manager's own acknowledgement to the owner (semantic content only; trusted facts are added by the system). */
      ownerReply?: string | null;
      /** Explicit PR-only goal ("只要 PR，不要部署"); absent = production delivery. */
      deliveryTarget?: "pull_request";
    }
  | { kind: "status_query" | "cancel_or_pause" | "human_decision"; intent: Exclude<AgentIntent, TaskCreatingIntent>; taskId: string | null }
  /**
   * Question about a known task. topics: what is asked (absent in interpretations stored before topics existed).
   * ownerReply: the Manager's own answer, grounded in the TrustedTaskState it was given (replyBasis).
   */
  | { kind: "task_follow_up"; intent: "task_follow_up"; taskId: string | null; topics?: FollowUpTopic[]; ownerReply?: string | null; replyBasis?: ReplyBasis | null }
  /** Explicit request to run a finished task's original goal again. Eligibility is decided deterministically. */
  | { kind: "retry_task"; intent: "retry_task"; taskId: string | null; ownerReply?: string | null; replyBasis?: ReplyBasis | null }
  | { kind: "clarify"; question: string };

/** Trusted facts a Manager reply was based on (set by the Gateway, never by the model). */
export interface ReplyBasis {
  taskId: string;
  status: string;
  retryKind: string | null;
}

export type ReviewStatus = "satisfied" | "not_satisfied" | "unsupported";

/**
 * Orchestrator-owned workspace verdict for read-only work. Built only after the
 * trusted evidence layer itself re-verified branch, HEAD, Git metadata digest,
 * changed paths and content identities (before and after validation) — never
 * from anything the Worker reports. Absent means not verified (fail closed).
 */
export interface TrustedWorkspaceEvidence {
  branch: string;
  /** Verified HEAD; equal to the Worker start SHA (no commit was made). */
  headSha: string;
  /** Working-tree paths changed since the start SHA (bounded list). */
  changedPaths: readonly string[];
  changedPathCount: number;
  /** True only when HEAD did not move and no path changed. */
  workspaceUnchanged: boolean;
}

export interface GoalReviewInput {
  mode: TaskMode;
  intent: TaskCreatingIntent | null;
  title: string;
  originalRequest: string;
  interpretedObjective: string;
  criteria: readonly { id: string; text: string }[];
  validations: readonly { name: string; status: string }[];
  /** Trusted unified diff of the Worker's changes (bounded). Empty for read_only. */
  diff: string;
  diffTruncated: boolean;
  /** Worker's answer (read_only) — untrusted claim to be verified. */
  answer: string | null;
  /** Trusted contents of repository files the answer cites (bounded). */
  citedFiles: readonly { path: string; excerpt: string }[];
  /** Trusted repository excerpts the Manager gathered itself from its evidence plan (read-only work). */
  sourceEvidence?: readonly { path: string; excerpt: string }[];
  /** What evidence answers the goal (Manager evidence plan); internal wording. */
  evidenceRequirements?: readonly string[];
  /** Durable owner constraints the reviewer must verify against the actual evidence (semantic checks). */
  ownerConstraints?: readonly { id: string; text: string }[];
  /** Read-only work: the orchestrator's own Git workspace verdict (absent = not verified). */
  workspace?: TrustedWorkspaceEvidence;
}

export interface GoalReviewer {
  /** Returns raw, untrusted structured output; see normalizeGoalReview. */
  review(input: GoalReviewInput): Promise<unknown>;
}

export interface CriterionReview {
  id: string;
  status: ReviewStatus;
  evidence: string;
  reason: string;
}
