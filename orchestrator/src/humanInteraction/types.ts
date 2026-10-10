/**
 * Human Interaction Port — transport-agnostic contract between the Manager /
 * Gateway side and any human-facing transport (Telegram is the first one).
 *
 * Notices are sanitized, read-only views built from Gateway reads. Inbound
 * messages carry only an opaque transport identity, the human's text, and an
 * opaque reference to a notice this service issued earlier; task, branch,
 * HEAD, approval binding and authority are always resolved server-side.
 */
import type { RiskLevel } from "../domain/types";
import type { RetryEligibility } from "../gateway/retry";
import type { TransportStatusContext } from "../planning/types";
import type { OwnerLanguage, PlainDecision } from "../executive/communication";

/**
 * Who authored the Owner-visible wording (single human-facing voice):
 * - manager: the GPT Manager's own text from an existing reasoning turn (semantic content);
 * - system_status: fixed operational status (quota/availability/service waits, PR opened, cancelled);
 * - safety_binding: deterministic approval/cancel contract text (authority must never be paraphrased);
 * - fallback: deterministic template used ONLY because the Manager produced no usable text.
 */
export type OwnerVoice = "manager" | "system_status" | "safety_binding" | "fallback";

interface NoticeBase {
  /** Stable dedupe identity (one notice per escalation / approval request / milestone). */
  noticeId: string;
  /** Short opaque reference a transport may echo back (buttons, "Ref:" line); never authority. */
  ref: string;
  taskId: string;
  /** Set when an earlier send attempt may have reached the human (crash or timeout). */
  possibleDuplicate?: boolean;
  /** Owner's language (Traditional Chinese when the owner writes Chinese). */
  lang?: OwnerLanguage;
  /** Plain task name for the owner (their own goal words); never ids or bindings. */
  ownerLabel?: string;
  /** Author of the wording (audited with the send intent). */
  voice?: OwnerVoice;
}

export interface HumanDecisionNotice extends NoticeBase {
  kind: "human_decision";
  escalationId: string;
  taskLabel: string;
  round: number;
  whyNeeded: string;
  failingCheck: string;
  failureCode: string;
  rootCause: string;
  repairAttempts: { cycle: number; attempted: string; outcome: string }[];
  currentBlocker: string;
  recommendation: string;
  inputRequested: string;
  /** Owner-facing plain-language content (Executive communication layer). Internal fields above stay for audit. */
  plain: PlainDecision;
  /** A reply is guidance only. */
  grantsApproval: false;
}

export interface CommitApprovalNotice extends NoticeBase {
  kind: "commit_publish_approval";
  approvalRequestId: string;
  taskLabel: string;
  /** The Manager reviewer's own explanation of the result (absent: fallback wording only). */
  managerSummary?: string;
  branch: string;
  filesChanged: string[];
  validationsPassed: string[];
  /** Validations that ran and failed. */
  validationsNotPassed: string[];
  /** Validations that could not be verified (environment / unattributable); not task failures. */
  validationsUnverified?: string[];
  /** Other actors' workspace changes the publish leaves out (shared workspace). */
  excludedPaths?: string[];
  managerAccepted: true;
  risk: RiskLevel;
  expiresAt: string;
  authorizes: { commit: true; normalPush: true; openOrReusePr: true; merge: false; deploy: false };
}

/** Red-risk pre-execution approval of one exact Worker contract (an orchestrator approval, never a Worker prompt). */
export interface StartApprovalNotice extends NoticeBase {
  kind: "start_approval";
  approvalRequestId: string;
  taskLabel: string;
  objectiveSummary: string;
  actions: string[];
  riskReasons: string[];
  allowedScope: string[];
  /** True when this approves a Manager-guided repair/retry contract rather than the first run. */
  repair: boolean;
  /** Read-only task: approval authorizes a read-only run only. */
  readOnly: boolean;
  /** Approving hands a red programming task back from Codex to Claude (same task, branch, progress). */
  handback?: boolean;
  risk: RiskLevel;
  expiresAt: string;
  authorizes: { executeThisExactContract: true; commit: false; push: false; openPr: false; merge: false; deploy: false; gitPermissionsForWorker: false };
}

export const MILESTONES = [
  "guidance_accepted",
  "guidance_rejected",
  "pr_opened",
  "completed",
  "blocked",
  "cancelled",
  "awaiting_other_approval",
  "answered",
  "infrastructure_waiting",
  // Executive progress milestones (meaningful lifecycle points only; never chain-of-thought).
  "worker_assigned",
  "repairing",
  "quota_takeover",
  "quota_handback",
  "quota_paused",
  "availability_paused",
  "part_completed",
  "combined_accepted",
  "combined_not_accepted",
  "combined_review_waiting",
  "combined_repairing",
] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Informational milestone; at-least-once delivery is harmless (no buttons, no authority). */
export interface MilestoneNotice extends NoticeBase {
  kind: "milestone";
  milestone: Milestone;
  taskLabel: string;
  detail: string;
}

/** Second step of a cancel: the only notice whose button can cancel a task. */
export interface CancelConfirmationNotice extends NoticeBase {
  kind: "cancel_confirmation";
  taskLabel: string;
  expiresAt: string;
}

export type HumanNotice = HumanDecisionNotice | CommitApprovalNotice | StartApprovalNotice | MilestoneNotice | CancelConfirmationNotice;
export type NoticeKind = HumanNotice["kind"];

/** Outbound side of a transport. deliveryRef is the transport's own message identity. */
export interface HumanInteractionTransport {
  deliver(notice: HumanNotice): Promise<{ deliveryRef: string }>;
}

/** Durable notice record. deliveryRef is null while only the send intent is recorded. */
export interface NoticeRecord {
  noticeId: string;
  kind: NoticeKind;
  ref: string;
  taskId: string;
  /** escalationId, approvalRequestId, milestone key, or the task id for a cancel confirmation. */
  targetId: string;
  deliveryRef: string | null;
  createdAt: string;
  voice?: OwnerVoice;
}

/** Durable dedupe/correlation state. Implementations must survive restart. */
export interface HumanInteractionLedger {
  byNotice(noticeId: string): NoticeRecord | null;
  byDeliveryRef(deliveryRef: string): NoticeRecord | null;
  byRef(ref: string): NoticeRecord | null;
  /** Written BEFORE the transport send, so a crash leaves a trace instead of silence. */
  recordIntent(notice: Omit<NoticeRecord, "deliveryRef">): void;
  recordDelivered(noticeId: string, deliveryRef: string): void;
  /** Opaque transport cursor (e.g. Telegram update offset). */
  cursor(transport: string): number | null;
  setCursor(transport: string, value: number): void;
}

/** Task lists come from trusted runtime state; everything else is re-read through the Gateway. */
export interface HumanInteractionDirectory {
  /** Non-terminal tasks (may need a human). */
  activeTaskIds(): string[];
  /** Every task the runtime knows (for /status lookup and terminal milestones). */
  allTaskIds(): string[];
}

/** Human free-text reply (guidance). Correlation names a notice this service issued. */
export interface InboundReply {
  kind: "reply";
  /** Derived from the transport's own message identity; reused on duplicate delivery. */
  idempotencyKey: string;
  replyToDeliveryRef: string | null;
  /** Fallback correlation: the "Ref:" of one of our own notices (resolved through the ledger). */
  replyToNoticeRef?: string | null;
  text: string;
  /** Transport statuses the owner already received for this message (Manager context only). */
  transportContext?: TransportStatusContext[];
}

/** New task goal. Only user intent: text and an optional requested priority. */
export interface InboundGoal {
  kind: "goal";
  idempotencyKey: string;
  text: string;
  priority?: "critical" | "high" | "normal" | "low";
  /** Transport statuses the owner already received for this message (Manager context only). */
  transportContext?: TransportStatusContext[];
}

export type ActionKind = "approve" | "reject" | "cancel_request" | "cancel_confirm" | "cancel_keep";

/** Button/command action bound to a notice reference. The action itself is never authority. */
export interface InboundAction {
  kind: "action";
  idempotencyKey: string;
  ref: string;
  action: ActionKind;
}

/** Cancel request (step 1) addressed by a replied-to notice or a task reference. */
export interface InboundCancelRequest {
  kind: "cancel_request";
  idempotencyKey: string;
  target: { deliveryRef: string } | { noticeRef: string } | { taskReference: string };
}

export type InboundOutcome =
  | "resumed"
  | "submitted"
  | "duplicate"
  | "approved"
  | "rejected"
  | "cancelled"
  | "kept"
  | "confirm_requested"
  | "stale"
  | "invalid"
  | "needs_selection"
  | "nothing_open"
  | "info"
  | "failed";

export interface InboundResult {
  outcome: InboundOutcome;
  /** Safe, human-readable status for the transport to show; empty when a notice already answered. */
  message: string;
  taskId?: string;
  /** Author of the wording; absent for plain system replies (help, usage, lists). */
  voice?: OwnerVoice;
  /** Deterministic re-run verdict when the owner asked about re-running (structured; never from the model). */
  retryEligibility?: RetryEligibility;
}
