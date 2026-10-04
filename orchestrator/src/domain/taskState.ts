import type { RiskLevel, TaskState } from "./types";

/**
 * Base lifecycle edges. Guards in validateTransition() further restrict
 * edges into/out of awaiting_approval depending on risk and approval phase.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  received: ["classified", "failed", "cancelled"],
  classified: ["routed", "failed", "cancelled"],
  // red-risk tasks go routed -> awaiting_approval -> queued before execution
  routed: ["queued", "awaiting_approval", "failed", "cancelled"],
  queued: ["running", "failed", "cancelled"],
  running: ["pr_opened", "failed", "cancelled"],
  pr_opened: ["qa_running", "failed", "cancelled"],
  qa_running: ["qa_passed", "failed", "cancelled"],
  qa_passed: ["awaiting_approval", "complete", "failed", "cancelled"],
  // pre_execution approval → queued; post_qa approval → complete
  awaiting_approval: ["queued", "complete", "failed", "cancelled"],
  complete: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_STATES: readonly TaskState[] = ["complete", "failed", "cancelled"];

export type ApprovalPhase = "pre_execution" | "post_qa";

export interface TransitionContext {
  riskLevel: RiskLevel;
  /** Whether a human approval has been granted for the current phase. */
  approved?: boolean;
  /** Which approval gate the task is in; required when leaving awaiting_approval. */
  approvalPhase?: ApprovalPhase;
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

  // Approval gates (pre-execution and post-QA) are only for red-risk tasks.
  if (to === "awaiting_approval" && !red) {
    return { ok: false, reason: "only red-risk tasks enter awaiting_approval" };
  }

  // Red-risk tasks reach the queue only via awaiting_approval -> queued.
  if (red && from === "routed" && to === "queued") {
    return { ok: false, reason: "red-risk task must pass awaiting_approval before queued" };
  }

  // Red-risk tasks cannot complete without post-QA approval.
  if (red && from === "qa_passed" && to === "complete") {
    return { ok: false, reason: "red-risk task must pass awaiting_approval before complete" };
  }

  if (from === "awaiting_approval" && to !== "failed" && to !== "cancelled") {
    if (!ctx.approvalPhase) {
      return { ok: false, reason: "approvalPhase is required when leaving awaiting_approval" };
    }
    if (ctx.approved !== true) {
      return { ok: false, reason: "approval has not been granted" };
    }
    const expected: TaskState = ctx.approvalPhase === "pre_execution" ? "queued" : "complete";
    if (to !== expected) {
      return {
        ok: false,
        reason: `awaiting_approval (${ctx.approvalPhase}) cannot transition to ${to}`,
      };
    }
  }

  return { ok: true };
}

export function assertTransition(from: TaskState, to: TaskState, ctx: TransitionContext): void {
  const result = validateTransition(from, to, ctx);
  if (!result.ok) throw new Error(`[taskState] ${result.reason}`);
}
