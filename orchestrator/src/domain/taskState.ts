import type { RiskLevel, TaskState } from "./types";

/**
 * Base lifecycle edges. Guards in validateTransition() further restrict
 * edges into/out of awaiting_approval depending on risk and approval phase,
 * and every edge into "complete" depending on what completion means for the task.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  received: ["classified", "failed", "cancelled"],
  classified: ["routed", "failed", "cancelled"],
  // red-risk tasks go routed -> awaiting_approval -> queued before execution
  routed: ["queued", "awaiting_approval", "failed", "cancelled"],
  queued: ["running", "failed", "cancelled"],
  // running -> complete exists only for read_only tasks (no commit/push/PR); see validateTransition.
  running: ["awaiting_approval", "pr_opened", "complete", "failed", "cancelled"],
  pr_opened: ["qa_running", "failed", "cancelled"],
  qa_running: ["awaiting_approval", "qa_passed", "failed", "cancelled"],
  // qa_passed -> complete only for a PR-only goal; production delivery goes through the deploy approval.
  qa_passed: ["awaiting_approval", "complete", "failed", "cancelled"],
  // pre_execution -> queued; commit_publish -> running (or running again for an Owner revision);
  // deploy -> deploying; post_qa -> complete (legacy PR-terminal red tasks only);
  // an Owner decline of publish/deploy -> closed_without_deploy.
  awaiting_approval: ["queued", "running", "qa_running", "deploying", "complete", "failed", "cancelled", "closed_without_deploy"],
  // Owner-approved merge + production deployment + production verification.
  deploying: ["complete", "failed", "cancelled"],
  complete: [],
  failed: [],
  cancelled: [],
  closed_without_deploy: [],
};

export const TERMINAL_STATES: readonly TaskState[] = ["complete", "failed", "cancelled", "closed_without_deploy"];

/**
 * Approval gates. commit_publish (commit + push + PR) and deploy (merge + production deployment) are
 * two different scopes and never stand in for each other.
 */
export type ApprovalPhase = "pre_execution" | "commit_publish" | "post_qa" | "deploy";

/**
 * What a transition into "complete" is backed by.
 * - production_verified: the approved PR was merged, the production deployment of that exact commit is
 *   live and the production health check + smoke test passed.
 * - pull_request: the Owner's goal was a PR only (no deployment) and the PR passed CI.
 */
export type CompletionBasis = "production_verified" | "pull_request";

export interface TransitionContext {
  riskLevel: RiskLevel;
  /** Whether a human approval has been granted for the current phase. */
  approved?: boolean;
  /** Which approval gate the task is in; required when leaving awaiting_approval. */
  approvalPhase?: ApprovalPhase;
  /** True only for a read_only task whose trusted Git state shows no change. */
  readOnly?: boolean;
  /** A red read-only task may complete only after its pre-execution approval was granted. */
  preExecutionApproved?: boolean;
  /** Required for every change-task edge into "complete". */
  completion?: CompletionBasis;
  /** The Owner declined publication / deployment (awaiting_approval -> closed_without_deploy). */
  declined?: boolean;
  /** The Owner asked for changes while reviewing the result (commit_publish gate -> running, same task). */
  revision?: boolean;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function validateTransition(
  from: TaskState,
  to: TaskState,
  ctx: TransitionContext,
): TransitionResult {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    return { ok: false, reason: `transition ${from} -> ${to} is not allowed` };
  }

  const red = ctx.riskLevel === "red";

  // Only a read-only task may complete straight from running (there is nothing to commit or publish);
  // a red read-only task additionally needs its granted pre-execution approval.
  if (from === "running" && to === "complete" && (ctx.readOnly !== true || (red && ctx.preExecutionApproved !== true))) {
    return { ok: false, reason: "only a read-only task (red: after pre-execution approval) may complete without commit/publish" };
  }

  // A passing PR is not completion: only a PR-only goal may complete there.
  if (from === "qa_passed" && to === "complete" && ctx.completion !== "pull_request") {
    return { ok: false, reason: "a passing PR completes only a PR-only goal; production delivery needs deploy approval and production verification" };
  }

  // Merge alone is not completion either: production verification must have succeeded.
  if (from === "deploying" && to === "complete" && ctx.completion !== "production_verified") {
    return { ok: false, reason: "a deployment completes only after production verification succeeded" };
  }

  // Red-risk gates exist before execution and after QA. Every risk level uses
  // the running -> awaiting_approval commit/publish gate and the qa_passed -> awaiting_approval deploy gate.
  if (to === "awaiting_approval" && !red && from !== "running" && from !== "qa_running" && !(from === "qa_passed" && ctx.approvalPhase === "deploy")) {
    return { ok: false, reason: "non-red tasks enter awaiting_approval only for commit or deploy authorization" };
  }

  // Red-risk tasks reach the queue only via awaiting_approval -> queued.
  if (red && from === "routed" && to === "queued") {
    return { ok: false, reason: "red-risk task must pass awaiting_approval before queued" };
  }

  // Red-risk tasks cannot complete without post-QA approval.
  if (red && from === "qa_passed" && to === "complete") {
    return { ok: false, reason: "red-risk task must pass awaiting_approval before complete" };
  }

  if (from === "awaiting_approval" && to === "closed_without_deploy") {
    if (ctx.declined !== true || (ctx.approvalPhase !== "commit_publish" && ctx.approvalPhase !== "deploy"))
      return { ok: false, reason: "only an Owner decline of publish or deploy closes a task without deployment" };
    return { ok: true };
  }

  if (from === "awaiting_approval" && to === "running" && ctx.revision === true) {
    // An Owner revision returns the SAME task to its Worker; it authorizes no commit/publish.
    if (ctx.approvalPhase !== "commit_publish") return { ok: false, reason: "an Owner revision applies only while the result awaits publish approval" };
    return { ok: true };
  }

  if (from === "awaiting_approval" && to !== "failed" && to !== "cancelled") {
    if (!ctx.approvalPhase) {
      return { ok: false, reason: "approvalPhase is required when leaving awaiting_approval" };
    }
    if (ctx.approved !== true) {
      return { ok: false, reason: "approval has not been granted" };
    }
    const expected: readonly TaskState[] =
      ctx.approvalPhase === "pre_execution"
        ? ["queued"]
        : ctx.approvalPhase === "commit_publish"
          ? ["running", "qa_running"]
          : ctx.approvalPhase === "deploy"
            ? ["deploying"]
            : ["complete"];
    if (!expected.includes(to)) {
      return {
        ok: false,
        reason: `awaiting_approval (${ctx.approvalPhase}) cannot transition to ${to}`,
      };
    }
    if (to === "complete" && ctx.completion !== "pull_request") {
      return { ok: false, reason: "post-QA approval completes only a PR-only goal" };
    }
  }

  return { ok: true };
}

export function assertTransition(from: TaskState, to: TaskState, ctx: TransitionContext): void {
  const result = validateTransition(from, to, ctx);
  if (!result.ok) throw new Error(`[taskState] ${result.reason}`);
}
