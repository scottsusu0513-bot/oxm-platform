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
}

export interface IntentPlannerInput {
  /** The owner's message (already screened for credentials). */
  message: string;
  /** Task the message replied to, resolved from the trusted correlation ledger. */
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
  | { kind: "status_query" | "task_follow_up" | "cancel_or_pause" | "human_decision"; intent: Exclude<AgentIntent, TaskCreatingIntent>; taskId: string | null }
  | { kind: "clarify"; question: string };

export type ReviewStatus = "satisfied" | "not_satisfied" | "unsupported";

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
