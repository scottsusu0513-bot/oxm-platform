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
  running: ["awaiting_approval", "pr_opened", "failed", "cancelled"],
  pr_opened: ["qa_running", "failed", "cancelled"],
  qa_running: ["awaiting_approval", "qa_passed", "failed", "cancelled"],
  qa_passed: ["awaiting_approval", "complete", "failed", "cancelled"],
  // pre_execution → queued; commit_publish → running; post_qa → complete
  awaiting_approval: ["queued", "running", "qa_running", "complete", "failed", "cancelled"],
  complete: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_STATES: readonly TaskState[] = ["complete", "failed", "cancelled"];

export type ApprovalPhase = "pre_execution" | "commit_publish" | "post_qa";

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

  // Red-risk gates exist before execution and after QA. Every risk level uses
  // the additional running -> awaiting_approval commit/publish gate.
  if (to === "awaiting_approval" && !red && from !== "running" && from !== "qa_running") {
    return { ok: false, reason: "non-red tasks enter awaiting_approval only for commit authorization" };
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
    const expected: readonly TaskState[] =
      ctx.approvalPhase === "pre_execution"
        ? ["queued"]
        : ctx.approvalPhase === "commit_publish"
          ? ["running", "qa_running"]
          : ["complete"];
    if (!expected.includes(to)) {
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
