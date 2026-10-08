import type { CancelConfirmationNotice, CommitApprovalNotice, HumanDecisionNotice, HumanNotice, MilestoneNotice, StartApprovalNotice } from "../humanInteraction/types";
import { cancelConfirmationMessage, commitApprovalMessage, decisionMessage, startApprovalMessage, type OwnerLanguage } from "../executive/communication";
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

/**
 * Legacy "Ref:" line. Older notices carried it so a reply could be
 * correlated when the send was not recorded; it is still PARSED for those,
 * but no longer emitted: owner messages never show raw references. Implicit
 * correlation (exactly one pending decision) covers the crash case instead.
 */
export const REF_LINE = /^Ref: ([0-9a-f]{16})$/m;

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

const langOf = (n: HumanNotice): OwnerLanguage => n.lang ?? "zh";
const nameOf = (n: HumanNotice & { taskLabel: string }) => n.ownerLabel ?? n.taskLabel;

function resent(n: HumanNotice): string[] {
  if (!n.possibleDuplicate) return [];
  return [langOf(n) === "zh" ? "（重送：之前可能已經收過同一則訊息，兩則都有效。）" : "(Re-sent: an earlier copy may exist; either copy works.)", ""];
}

/** Executive decision request: what happened, what was tried, blocker, recommendation, what to do. */
export function formatDecisionNotice(n: HumanDecisionNotice): string {
  return clip([...resent(n), decisionMessage(n.plain)].join("\n"));
}

export function formatApprovalNotice(n: CommitApprovalNotice): string {
  return clip(
    [
      ...resent(n),
      commitApprovalMessage({ lang: langOf(n), label: nameOf(n), files: n.filesChanged, checksPassed: n.validationsPassed.length, checksNotPassed: n.validationsNotPassed, risk: n.risk, expiresAt: n.expiresAt }),
    ].join("\n"),
  );
}

export function formatStartApproval(n: StartApprovalNotice): string {
  return clip(
    [...resent(n), startApprovalMessage({ lang: langOf(n), label: nameOf(n), objective: n.objectiveSummary, reasons: n.riskReasons, readOnly: n.readOnly, repair: n.repair, expiresAt: n.expiresAt, handback: n.handback === true })].join("\n"),
  );
}

/** Milestones carry their plain text already; a short task header keeps several tasks apart. */
export function formatMilestone(n: MilestoneNotice): string {
  return clip([...resent(n), `【${nameOf(n)}】`, n.detail].join("\n"));
}

export function formatCancelConfirmation(n: CancelConfirmationNotice): string {
  return clip([...resent(n), cancelConfirmationMessage({ lang: langOf(n), label: nameOf(n), expiresAt: n.expiresAt })].join("\n"));
}

export function noticeButtons(n: HumanNotice): InlineButton[][] | undefined {
  const zh = langOf(n) === "zh";
  switch (n.kind) {
    case "commit_publish_approval":
      return [[{ text: zh ? "批准發布" : "Approve publish", callback_data: callbackData(n.ref, "a") }, { text: zh ? "不要發布" : "Reject", callback_data: callbackData(n.ref, "r") }]];
    case "start_approval":
      return [[{ text: zh ? "批准執行" : "Approve this run", callback_data: callbackData(n.ref, "a") }, { text: zh ? "拒絕" : "Reject", callback_data: callbackData(n.ref, "r") }]];
    case "human_decision":
      return [[{ text: zh ? "取消任務" : "Cancel task", callback_data: callbackData(n.ref, "c") }]];
    case "cancel_confirmation":
      return [[{ text: zh ? "確認取消" : "Confirm cancel", callback_data: callbackData(n.ref, "k") }, { text: zh ? "繼續執行" : "Keep running", callback_data: callbackData(n.ref, "n") }]];
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
  "直接用中文告訴我你要什麼就可以，例如「幫我看一下現在搜尋的邏輯是怎麼跑的」或「幫我把搜尋 loading 做順一點，手機版一起處理」。",
  "問問題我會用唯讀方式查，不會改任何檔案；要修改的需求，我會安排 Claude（程式）或 Codex（畫面設計）處理，檢查過後再請你批准發布。",
  "",
  "需要你決定時，直接傳訊息給我即可（同時有多件事要決定時，我會先問你指的是哪一件）。",
  "你的指示只是方向，不代表批准發布；發布和高風險執行都要按訊息上的按鈕。我不會合併或部署。",
  "",
  "可用指令：",
  "/goal <目標> — 直接建立新任務",
  "/goal priority:high <目標> — 指定優先序（系統可能調整）",
  "/tasks — 目前的任務",
  "/status <任務> — 某個任務的進度",
  "/cancel <任務> — 取消任務（會再確認一次）",
  "/help — 顯示這個說明",
].join("\n");

export const GOAL_USAGE = "用法：/goal <你要完成的事和怎麼確認>\n例如：/goal 修正 OXM 搜尋頁 AI loading 體驗，完成後自行測試";
