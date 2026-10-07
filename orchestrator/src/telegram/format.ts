import type { CancelConfirmationNotice, CommitApprovalNotice, HumanDecisionNotice, HumanNotice, MilestoneNotice, StartApprovalNotice } from "../humanInteraction/types";
import type { InlineButton } from "./client";

/** Telegram text limit is 4096 characters; stay well below it. */
const MAX_TEXT = 3800;

export const CALLBACK_PREFIX = "hi";
export const CALLBACK_ACTIONS = { a: "approve", r: "reject", c: "cancel_request", k: "cancel_confirm", n: "cancel_keep" } as const;
export type CallbackCode = keyof typeof CALLBACK_ACTIONS;

/** Opaque, <=64 bytes. It names a notice reference only; the server re-resolves everything. */
export function callbackData(ref: string, code: CallbackCode): string {
  return `${CALLBACK_PREFIX}:${ref}:${code}`;
}

export function parseCallbackData(data: unknown): { ref: string; action: (typeof CALLBACK_ACTIONS)[CallbackCode] } | null {
  if (typeof data !== "string" || data.length > 64) return null;
  const m = /^hi:([0-9a-f]{16}):([arckn])$/.exec(data);
  return m ? { ref: m[1], action: CALLBACK_ACTIONS[m[2] as CallbackCode] } : null;
}

/** Line carried by every notice so a reply can still be correlated if the send was not recorded (crash). */
export const REF_LINE = /^Ref: ([0-9a-f]{16})$/m;

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function resent(n: HumanNotice): string[] {
  return n.possibleDuplicate ? ["(Re-sent: an earlier copy of this message may exist; either copy works.)", ""] : [];
}

export function formatDecisionNotice(n: HumanDecisionNotice): string {
  const lines = [
    ...resent(n),
    "OXM Agent needs your decision",
    "",
    `Task: ${n.taskLabel}`,
    `Escalation: ${n.escalationId} (round ${n.round})`,
    "",
    `Why: ${n.whyNeeded}`,
    `Failing check: ${n.failingCheck} (${n.failureCode})`,
    `Root cause (Manager): ${n.rootCause || "not determined"}`,
    "",
    "Repair cycles attempted:",
    ...(n.repairAttempts.length ? n.repairAttempts.map((a) => `  ${a.cycle}. ${a.attempted} -> ${a.outcome}`) : ["  (none recorded)"]),
    "",
    `Current blocker: ${n.currentBlocker}`,
    `Manager recommendation: ${n.recommendation}`,
    "",
    "Reply directly to this message with your guidance.",
    "Your reply is guidance only. It does NOT approve commit, publish, merge, or deploy.",
    "To stop this task instead, press Cancel task (a confirmation follows).",
    "",
    `Ref: ${n.ref}`,
  ];
  return clip(lines.join("\n"));
}

export function formatApprovalNotice(n: CommitApprovalNotice): string {
  const yesNo = (v: boolean) => (v ? "yes" : "no");
  const lines = [
    ...resent(n),
    "OXM Agent requests commit + publish approval",
    "",
    `Task: ${n.taskLabel}`,
    `Branch: ${n.branch}`,
    `Files changed (${n.filesChanged.length}):`,
    ...n.filesChanged.map((p) => `  - ${p}`),
    `Validations passed: ${n.validationsPassed.length ? n.validationsPassed.join(", ") : "none"}`,
    ...(n.validationsNotPassed.length ? [`Validations NOT passed: ${n.validationsNotPassed.join(", ")}`] : []),
    `Manager accepted: ${yesNo(n.managerAccepted)}`,
    `Risk: ${n.risk}`,
    `Expires: ${n.expiresAt}`,
    "",
    "Approving authorizes exactly:",
    `  commit = ${yesNo(n.authorizes.commit)}`,
    `  normal push = ${yesNo(n.authorizes.normalPush)}`,
    `  open/reuse PR = ${yesNo(n.authorizes.openOrReusePr)}`,
    `  merge = ${yesNo(n.authorizes.merge)}`,
    `  deploy = ${yesNo(n.authorizes.deploy)}`,
    "",
    `Ref: ${n.ref}`,
  ];
  return clip(lines.join("\n"));
}

const MILESTONE_TITLE: Record<MilestoneNotice["milestone"], string> = {
  guidance_accepted: "OXM Agent resumed your task",
  guidance_rejected: "OXM Agent could not use your guidance",
  pr_opened: "OXM Agent opened a PR",
  completed: "OXM Agent finished a task",
  blocked: "OXM Agent task is blocked",
  cancelled: "OXM Agent task was cancelled",
  awaiting_other_approval: "OXM Agent task needs an operator approval",
  answered: "OXM Agent 的回答",
  infrastructure_waiting: "OXM Agent is waiting for infrastructure",
};

export function formatStartApproval(n: StartApprovalNotice): string {
  const yesNo = (v: boolean) => (v ? "yes" : "no");
  const lines = [
    ...resent(n),
    "OXM Agent requests a RED-RISK execution approval",
    "",
    `Task: ${n.taskLabel}`,
    `Intended action${n.repair ? " (Manager-guided repair/retry run)" : ""}: ${n.objectiveSummary}`,
    `Risk: ${n.risk}`,
    n.readOnly
      ? "Mode: READ-ONLY — the Worker runs in a disposable snapshot; no file can change and there is no commit/publish path."
      : "Mode: change (scoped to the affected scope below)",
    "Why it is red-risk:",
    ...(n.riskReasons.length ? n.riskReasons.map((r) => `  - ${r}`) : ["  - (policy classification)"]),
    `Declared actions: ${n.actions.join(", ") || "none"}`,
    `Affected scope: ${n.allowedScope.join(", ") || "none"}`,
    `Expires: ${n.expiresAt}`,
    "",
    "Approving authorizes exactly:",
    `  run the Worker on this exact contract = ${yesNo(n.authorizes.executeThisExactContract)}`,
    "It does NOT authorize:",
    `  commit = ${yesNo(n.authorizes.commit)}, push = ${yesNo(n.authorizes.push)}, open PR = ${yesNo(n.authorizes.openPr)}`,
    `  merge = ${yesNo(n.authorizes.merge)}, deploy = ${yesNo(n.authorizes.deploy)}, Worker Git permissions = ${yesNo(n.authorizes.gitPermissionsForWorker)}`,
    "Commit/publish needs its own later approval. A changed contract (e.g. a repair) asks again.",
    "",
    `Ref: ${n.ref}`,
  ];
  return clip(lines.join("\n"));
}

export function formatMilestone(n: MilestoneNotice): string {
  return clip([...resent(n), MILESTONE_TITLE[n.milestone], "", `Task: ${n.taskLabel}`, n.detail, "", `Ref: ${n.ref}`].join("\n"));
}

export function formatCancelConfirmation(n: CancelConfirmationNotice): string {
  return clip(
    [
      ...resent(n),
      "Cancel this task?",
      "",
      `Task: ${n.taskLabel}`,
      "Cancelling stops the task through the Gateway. Nothing is committed, pushed, merged, or deployed by cancelling.",
      `This confirmation expires at ${n.expiresAt}.`,
      "",
      `Ref: ${n.ref}`,
    ].join("\n"),
  );
}

export function noticeButtons(n: HumanNotice): InlineButton[][] | undefined {
  switch (n.kind) {
    case "commit_publish_approval":
      return [[{ text: "Approve commit + publish", callback_data: callbackData(n.ref, "a") }, { text: "Reject", callback_data: callbackData(n.ref, "r") }]];
    case "start_approval":
      return [[{ text: "Approve this execution", callback_data: callbackData(n.ref, "a") }, { text: "Reject", callback_data: callbackData(n.ref, "r") }]];
    case "human_decision":
      return [[{ text: "Cancel task", callback_data: callbackData(n.ref, "c") }]];
    case "cancel_confirmation":
      return [[{ text: "Confirm cancel", callback_data: callbackData(n.ref, "k") }, { text: "Keep running", callback_data: callbackData(n.ref, "n") }]];
    default:
      return undefined;
  }
}

export function formatNotice(n: HumanNotice): string {
  switch (n.kind) {
    case "human_decision":
      return formatDecisionNotice(n);
    case "commit_publish_approval":
      return formatApprovalNotice(n);
    case "start_approval":
      return formatStartApproval(n);
    case "milestone":
      return formatMilestone(n);
    case "cancel_confirmation":
      return formatCancelConfirmation(n);
  }
}

export const HELP_TEXT = [
  "OXM Agent",
  "Just write what you need, e.g. 「幫我看一下現在搜尋的邏輯是怎麼跑的」 or 「幫我把搜尋 loading 做順一點，手機版一起處理」.",
  "Questions become read-only investigations; change requests become implementation tasks.",
  "",
  "Optional commands:",
  "/goal <goal> — force a new task (e.g. /goal 修正搜尋頁 AI loading 體驗，完成後自行測試)",
  "/goal priority:high <goal> — same, with a requested priority (policy may adjust it)",
  "/tasks — list active tasks",
  "/status <task> — status of one task (task id or at least 4 of its characters)",
  "/cancel <task> — cancel a task (asks for confirmation)",
  "/help — this message",
  "",
  "Escalations: reply directly to the escalation message with guidance.",
  "Red-risk execution and commit + publish approvals: use the buttons on the approval message.",
  "Guidance never approves commit, publish, merge, or deploy. Merge and deploy are not available here.",
].join("\n");

export const GOAL_USAGE = "Usage: /goal <what you want done and how to verify it>\nExample: /goal 修正 OXM 搜尋頁 AI loading 體驗，完成後自行測試";
