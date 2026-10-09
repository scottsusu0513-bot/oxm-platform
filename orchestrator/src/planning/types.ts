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
    }
  | { kind: "status_query" | "cancel_or_pause" | "human_decision"; intent: Exclude<AgentIntent, TaskCreatingIntent>; taskId: string | null }
  /** Question about a known task. topics: what is asked (absent in interpretations stored before topics existed). */
  | { kind: "task_follow_up"; intent: "task_follow_up"; taskId: string | null; topics?: FollowUpTopic[] }
  /** Explicit request to run a finished task's original goal again. Eligibility is decided deterministically. */
  | { kind: "retry_task"; intent: "retry_task"; taskId: string | null }
  | { kind: "clarify"; question: string };

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
