import { createHash } from "node:crypto";
import { GatewayError } from "../gateway/errors";
import type {
  AgentGatewayService,
  GatewayAuthenticationInput,
  GatewayTaskStatus,
  PendingApprovalRequirement,
  PendingHumanDecisionView,
} from "../gateway/types";
import { MAX_HUMAN_GUIDANCE_LENGTH } from "../manager/types";
import type { TaskMode, WorkerKind } from "../domain/types";
import {
  DETAILS_REQUEST,
  technicalDetailsMessage,
  cancelConfirmationMessage,
  decisionContent,
  inputRejection,
  managerDecisionContent,
  ownerLanguage,
  progressMessage,
  taskReceivedMessage,
  type OwnerLanguage,
  type ProgressEvent,
} from "../executive/communication";
import { isDangerousValue } from "../store/sanitize";
import type { AuditHumanInteractionLedger } from "./ledger";
import type {
  CancelConfirmationNotice,
  CommitApprovalNotice,
  HumanDecisionNotice,
  HumanInteractionDirectory,
  HumanInteractionTransport,
  HumanNotice,
  InboundAction,
  InboundCancelRequest,
  InboundGoal,
  InboundOutcome,
  InboundReply,
  InboundResult,
  Milestone,
  MilestoneNotice,
  NoticeRecord,
  StartApprovalNotice,
} from "./types";

export type HumanInteractionGateway = Pick<
  AgentGatewayService,
  | "submitTask"
  | "interpretOwnerMessage"
  | "submitInterpretedTask"
  | "getTaskStatus"
  | "getHumanDecision"
  | "submitHumanDecision"
  | "getPendingApproval"
  | "approveTask"
  | "rejectTask"
  | "cancelTask"
>;

export interface HumanInteractionServiceDeps {
  /** Every read and mutation goes through the existing Gateway; nothing here touches Git, Workers or the Manager directly. */
  gateway: HumanInteractionGateway;
  authentication: () => GatewayAuthenticationInput;
  directory: HumanInteractionDirectory;
  ledger: AuditHumanInteractionLedger;
  transport: HumanInteractionTransport;
  now: () => string;
  /** Lifetime of a cancel confirmation (default 10 minutes). */
  cancelConfirmationMs?: number;
  /** Safe operational events only: no guidance/goal text, credentials, or Gateway payloads. */
  log?: (event: { event: string; outcome: string }) => void;
  /** Production: never fall back to the legacy (non-GPT) intake when the GPT Manager is unavailable. */
  managerRequired?: boolean;
}

export interface HumanInteractionService {
  /** Sends at most one notice per escalation / approval request / milestone. Safe to call repeatedly. */
  observe(): Promise<{ delivered: number }>;
  submitGoal(goal: InboundGoal): Promise<InboundResult>;
  handleReply(reply: InboundReply): Promise<InboundResult>;
  handleAction(action: InboundAction): Promise<InboundResult>;
  requestCancel(request: InboundCancelRequest): Promise<InboundResult>;
  listTasks(): Promise<InboundResult>;
  taskStatus(reference: string): Promise<InboundResult>;
}

export const MAX_GOAL_LENGTH = 2_000;
const NOT_APPROVAL = "Your reply is guidance only. It does NOT approve commit, publish, merge, or deploy.";
const NOT_APPROVAL_ZH = "這只是方向指示，不代表批准 commit、發布、合併或部署。";
/** Owner-language pick (Traditional Chinese when the owner writes Chinese). */
const L = (lang: OwnerLanguage, zh: string, en: string) => (lang === "zh" ? zh : en);
const TERMINAL = new Set(["accepted", "blocked"]);

export function noticeRef(noticeId: string): string {
  return createHash("sha256").update(noticeId).digest("hex").slice(0, 16);
}

export function oneLine(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Status text never carries raw bindings: SHAs and digests are masked. */
function safeDetail(value: string | null | undefined, max = 200): string {
  return oneLine((value ?? "").replace(/\b[0-9a-f]{40,64}\b/gi, "[sha]"), max);
}

/** Credential shapes that may appear mid-sentence (the shared sanitizer anchors some at the start). */
const EMBEDDED_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\bauthorization\s*[:=]\s*\S+|\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*\S{6,}/i;
const looksSecret = (text: string) => isDangerousValue(text) || EMBEDDED_SECRET.test(text) || text.split(/\s+/).some((word) => isDangerousValue(word));

/** Normalizes untrusted guidance; the Gateway applies its own (authoritative) checks again. */
export type InputRejectionCode = "empty" | "too_long" | "credential" | "invalid";

/** Internal reason (audit/log only) + a code the Executive layer turns into owner language. */
export function normalizeGuidance(text: string): { ok: true; guidance: string } | { ok: false; code: InputRejectionCode; reason: string } {
  if (typeof text !== "string") return { ok: false, code: "invalid", reason: "guidance must be text" };
  const guidance = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!guidance) return { ok: false, code: "empty", reason: "guidance is empty" };
  if (guidance.length > MAX_HUMAN_GUIDANCE_LENGTH) return { ok: false, code: "too_long", reason: `guidance is longer than ${MAX_HUMAN_GUIDANCE_LENGTH} characters` };
  if (looksSecret(guidance)) return { ok: false, code: "credential", reason: "guidance looks like a credential or secret; remove it and resend" };
  return { ok: true, guidance };
}

/** Normalizes an untrusted goal. It becomes userInstruction only; intake derives everything else. */
export function normalizeGoal(text: string): { ok: true; goal: string } | { ok: false; code: InputRejectionCode; reason: string } {
  if (typeof text !== "string") return { ok: false, code: "invalid", reason: "goal must be text" };
  const goal = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!goal) return { ok: false, code: "empty", reason: "goal is empty" };
  if (goal.length > MAX_GOAL_LENGTH) return { ok: false, code: "too_long", reason: `goal is longer than ${MAX_GOAL_LENGTH} characters` };
  if (goal.split("\n").some((line) => looksSecret(line)))
    return { ok: false, code: "credential", reason: "goal looks like it contains a credential or secret; remove it and resend" };
  return { ok: true, goal };
}

export function decisionNotice(view: PendingHumanDecisionView, label?: string, context: { mode?: TaskMode } = {}): HumanDecisionNotice {
  const noticeId = `hd:${view.escalationId}`;
  const b = view.currentBlocker;
  const lang = ownerLanguage(label);
  const owner = ownerLabelOf(view.taskId, label);
  return {
    kind: "human_decision",
    noticeId,
    ref: noticeRef(noticeId),
    taskId: view.taskId,
    lang,
    ownerLabel: owner,
    plain: view.ownerDecision
      ? managerDecisionContent({ lang, label: owner, question: view.ownerDecision.question, options: view.ownerDecision.options, recommended: view.ownerDecision.recommended })
      : decisionContent({ lang, label: owner, mode: context.mode ?? "change", failureCode: b.failureCode, attempts: view.cyclesCompleted, stagnated: view.fingerprintTrend === "stagnated" }),
    escalationId: view.escalationId,
    taskLabel: taskLabel(view.taskId, label),
    round: view.round,
    whyNeeded: oneLine(view.whyNeeded, 320),
    failingCheck: oneLine(b.failingCheck, 80),
    failureCode: oneLine(b.failureCode, 80),
    rootCause: oneLine(view.rootCause, 320),
    repairAttempts: view.repairAttempts.slice(0, 4).map((a) => ({ cycle: a.cycle, attempted: oneLine(a.attempted, 240), outcome: oneLine(a.outcome, 160) })),
    currentBlocker: oneLine(`expected ${b.expected}; actual ${b.actual}`, 320),
    recommendation: oneLine(view.managerRecommendation, 400),
    inputRequested: oneLine(view.inputRequested, 400),
    grantsApproval: false,
  };
}

const RISK_ORDER = ["green", "yellow", "red"] as const;

export function approvalNotice(approval: PendingApprovalRequirement, label?: string): CommitApprovalNotice | null {
  const e = approval.commitEvidence;
  if (approval.kind !== "commit_publish" || approval.phase !== "commit_publish" || !e) return null;
  const a = e.authorization;
  // Fail closed: never present an approval whose authorization differs from the fixed commit/publish scope.
  if (!(a.commit === true && a.normalPush === true && a.openOrReusePr === true && a.merge === false && a.deploy === false) || e.managerDecision !== "accepted")
    return null;
  const noticeId = `ap:${approval.approvalRequestId}`;
  const risk = RISK_ORDER[Math.max(RISK_ORDER.indexOf(approval.risk), RISK_ORDER.indexOf(e.observedRisk))] ?? "red";
  return {
    kind: "commit_publish_approval",
    noticeId,
    ref: noticeRef(noticeId),
    taskId: approval.taskId,
    lang: ownerLanguage(label),
    ownerLabel: ownerLabelOf(approval.taskId, label),
    approvalRequestId: approval.approvalRequestId,
    taskLabel: taskLabel(approval.taskId, label),
    branch: oneLine(e.branch, 240),
    filesChanged: e.changedPaths.slice(0, 30).map((p) => oneLine(p, 200)),
    validationsPassed: e.validations.filter((v) => v.status === "passed" && v.executed && v.trusted).map((v) => oneLine(v.name, 60)),
    validationsNotPassed: e.validations.filter((v) => !(v.status === "passed" && v.executed && v.trusted)).map((v) => oneLine(`${v.name} (${v.status})`, 80)),
    managerAccepted: true,
    risk,
    expiresAt: approval.expiresAt,
    authorizes: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
  };
}

/** Red-risk pre-execution approval notice; null unless it is exactly a start approval with structured evidence. */
export function startApprovalNotice(approval: PendingApprovalRequirement, label?: string): StartApprovalNotice | null {
  const e = approval.startEvidence;
  if (approval.kind !== "start" || approval.phase !== "pre_execution" || !e) return null;
  const noticeId = `ap:${approval.approvalRequestId}`;
  return {
    kind: "start_approval",
    noticeId,
    ref: noticeRef(noticeId),
    taskId: approval.taskId,
    lang: ownerLanguage(label),
    ownerLabel: ownerLabelOf(approval.taskId, label),
    approvalRequestId: approval.approvalRequestId,
    taskLabel: taskLabel(approval.taskId, label),
    objectiveSummary: oneLine(e.objectiveSummary, 400),
    actions: e.actions.slice(0, 20).map((a) => oneLine(a, 60)),
    riskReasons: e.riskReasons.slice(0, 8).map((r) => oneLine(r, 200)),
    allowedScope: e.allowedScope.slice(0, 20).map((p) => oneLine(p, 200)),
    repair: e.repair,
    readOnly: e.mode === "read_only",
    ...(e.handback ? { handback: true } : {}),
    risk: approval.risk,
    expiresAt: approval.expiresAt,
    authorizes: { executeThisExactContract: true, commit: false, push: false, openPr: false, merge: false, deploy: false, gitPermissionsForWorker: false },
  };
}

function taskLabel(taskId: string, label?: string): string {
  return label ? `${oneLine(taskId, 64)} — ${oneLine(label, 60)}` : oneLine(taskId, 64);
}

/** The owner's own words for a task; the id only when nothing else is known. */
export function ownerLabelOf(taskId: string, label?: string): string {
  return label ? oneLine(label, 60) : oneLine(taskId, 64);
}

/** Plain-language phase of a task for the owner (no internal status names). */
export function plainPhase(s: GatewayTaskStatus, lang: OwnerLanguage): string {
  const zh = lang === "zh";
  const w = s.assignedWorker ? (s.assignedWorker === "claude" ? "Claude" : "Codex") : zh ? "工程師" : "the engineer";
  switch (s.status) {
    case "queued":
      return zh ? "排隊中，馬上開始" : "queued, starting soon";
    case "waiting_runtime":
    case "runtime_starting":
    case "runtime_available":
      return zh ? "正在啟動工作環境" : "starting the work environment";
    case "waiting_dependency":
      return zh ? "等前一個相關任務完成" : "waiting for a related task to finish";
    case "waiting_workspace":
    case "waiting_branch_conflict":
      return zh ? "等其他任務用完工作區（一次處理一個）" : "waiting for the workspace (one task at a time)";
    case "running":
      return zh ? `${w} 正在處理，完成後我會檢查` : `${w} is working; I will review when done`;
    case "repair_requested":
      return zh ? `檢查發現問題，${w} 正在修正` : `${w} is fixing a problem my review found`;
    case "qa_pending":
      return zh ? `PR${s.prNumber ? ` #${s.prNumber}` : ""} 已開，等自動檢查` : `PR${s.prNumber ? ` #${s.prNumber}` : ""} open, waiting for checks`;
    case "needs_human_approval":
      return zh ? "等你批准" : "waiting for your approval";
    case "needs_human_decision":
      return zh ? "等你決定下一步（直接傳訊息給我即可）" : "waiting for your decision (just message me)";
    case "waiting_infrastructure":
      return zh ? "工程師已完成，等我的檢查服務恢復（不消耗修正次數）" : "done; waiting for my review service (no fix attempt used)";
    case "waiting_worker_quota":
      return zh ? "工程師使用額度用完，進度已保存，等額度恢復" : "engineer out of usage quota; progress saved, waiting";
    case "waiting_worker_availability":
      return zh ? "工程師的執行環境暫時無法使用，進度已保存，恢復後從原位置繼續" : "engineer runtime unavailable; progress saved, resumes from the same point";
    case "waiting_group":
      return zh ? "這部分已完成，等整個需求合在一起檢查" : "this part is done; waiting for the combined review";
    case "accepted":
      return zh ? (s.prNumber ? `已完成（PR #${s.prNumber} 通過檢查，未合併）` : "已完成") : s.prNumber ? `done (PR #${s.prNumber} passed checks; not merged)` : "done";
    case "blocked":
      return s.taskState === "cancelled" ? (zh ? "已取消" : "cancelled") : zh ? "已停止" : "stopped";
    default:
      return zh ? "處理中" : "in progress";
  }
}

/** Owner-facing phase for a task status. Never includes branch/HEAD/binding values. */
export function phaseOf(s: GatewayTaskStatus): string {
  switch (s.status) {
    case "queued":
      return "queued for the Manager";
    case "waiting_runtime":
    case "runtime_starting":
    case "runtime_available":
      return "waiting for the Codespace runtime";
    case "waiting_dependency":
      return "waiting for a dependency";
    case "waiting_workspace":
    case "waiting_branch_conflict":
      return "waiting for the workspace (tasks run one at a time)";
    case "running":
      return "Worker running / Manager validating";
    case "repair_requested":
      return "Manager-guided repair in progress";
    case "qa_pending":
      return s.prNumber ? `PR #${s.prNumber} open; waiting for CI` : "waiting for CI";
    case "needs_human_approval":
      return "waiting for an approval";
    case "needs_human_decision":
      return "waiting for your decision (just send your guidance)";
    case "waiting_worker_quota":
      return "paused: Worker usage quota exhausted; progress saved (repair cycles not consumed)";
    case "waiting_worker_availability":
      return "paused: Worker runtime unavailable (login, executable or service); progress saved (repair cycles not consumed)";
    case "waiting_infrastructure":
      return "waiting for the Manager's goal reviewer (infrastructure outage; repair cycles not consumed)";
    case "accepted":
      return s.prNumber ? `complete (PR #${s.prNumber} passed CI; not merged by the agent)` : "complete";
    case "blocked":
      return s.taskState === "cancelled" ? "cancelled" : "blocked";
    default:
      return "unknown";
  }
}

function gatewayOutcome(error: unknown, lang: OwnerLanguage = "zh"): InboundResult {
  if (error instanceof GatewayError) {
    if (["stale_binding", "conflict", "approval_not_required", "approval_expired", "not_found"].includes(error.code))
      return { outcome: "stale", message: L(lang, "這個請求已經過期或狀態改變了，所以沒有做任何變更。", "This request is no longer current. Nothing was changed.") };
    // The raw reason stays in the Gateway audit; a Chinese owner gets a natural explanation, never the internal string.
    if (error.code === "invalid_request") return { outcome: "invalid", message: lang === "zh" ? inputRejection("invalid", lang, "request") : `Not accepted: ${oneLine(error.message, 160)}. Nothing was changed.` };
    if (error.code === "idempotency_conflict") return { outcome: "invalid", message: L(lang, "這則訊息已經用在另一個請求上，沒有做任何變更。", "This message was already used for a different request. Nothing was changed.") };
  }
  return { outcome: "failed", message: L(lang, "系統暫時無法處理這個請求，沒有做任何變更。請稍後再試。", "The control plane could not process this request. Nothing was changed.") };
}

const TASK_REF = /^[a-z0-9-]{4,64}$/;

export function createHumanInteractionService(deps: HumanInteractionServiceDeps): HumanInteractionService {
  const inFlight = new Set<string>();
  const log = deps.log ?? (() => {});
  const cancelMs = deps.cancelConfirmationMs ?? 10 * 60 * 1000;
  const call = <T>(request: T) => ({ authentication: deps.authentication(), request });
  const labels = () => new Map(deps.ledger.tracked().map((t) => [t.taskId, t.label]));

  async function notify(notice: HumanNotice, targetId: string): Promise<boolean> {
    const existing = deps.ledger.byNotice(notice.noticeId);
    if ((existing && existing.deliveryRef !== null) || inFlight.has(notice.noticeId)) return false;
    inFlight.add(notice.noticeId);
    try {
      // Intent first: a crash after the send but before recordDelivered is then visible on restart.
      if (!existing) deps.ledger.recordIntent({ noticeId: notice.noticeId, kind: notice.kind, ref: notice.ref, taskId: notice.taskId, targetId, createdAt: deps.now() });
      const { deliveryRef } = await deps.transport.deliver(existing ? { ...notice, possibleDuplicate: true } : notice);
      deps.ledger.recordDelivered(notice.noticeId, deliveryRef);
      log({ event: "human_notice_delivered", outcome: notice.kind });
      return true;
    } catch {
      log({ event: "human_notice_delivery_failed", outcome: notice.kind });
      return false;
    } finally {
      inFlight.delete(notice.noticeId);
    }
  }

  /** Marks a milestone as already communicated inline (no separate notice). */
  function markInline(taskId: string, key: string) {
    const noticeId = `ms:${taskId}:${key}`;
    if (deps.ledger.byNotice(noticeId)) return;
    deps.ledger.recordIntent({ noticeId, kind: "milestone", ref: noticeRef(noticeId), taskId, targetId: key, createdAt: deps.now() });
    deps.ledger.recordDelivered(noticeId, `inline:${noticeId}`);
  }

  function milestone(taskId: string, key: string, kind: Milestone, detail: string, label?: string): MilestoneNotice {
    const noticeId = `ms:${taskId}:${key}`;
    // An answer keeps its line breaks (bounded); every other milestone is short plain text.
    const text =
      kind === "answered"
        ? detail.replace(/\b[0-9a-f]{40,64}\b/gi, "[sha]").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").slice(0, 3_000)
        : detail.replace(/\b[0-9a-f]{40,64}\b/gi, "[sha]").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").slice(0, 600);
    return { kind: "milestone", noticeId, ref: noticeRef(noticeId), taskId, milestone: kind, taskLabel: taskLabel(taskId, label), detail: text, lang: ownerLanguage(label), ownerLabel: ownerLabelOf(taskId, label) };
  }

  const status = (taskId: string) => deps.gateway.getTaskStatus(call({ taskId }));
  const openEscalation = async (taskId: string) => (await deps.gateway.getHumanDecision(call({ taskId }))).pending;
  async function currentApproval(taskId: string): Promise<PendingApprovalRequirement | null> {
    const response = await deps.gateway.getPendingApproval(call({ taskId }));
    return response.result === "pending" ? response.approval : null;
  }

  /** Every currently open human decision (trusted Gateway reads), oldest task first. */
  async function openDecisions(): Promise<{ taskId: string; escalationId: string; label: string }[]> {
    const names = labels();
    const out: { taskId: string; escalationId: string; label: string }[] = [];
    for (const taskId of Array.from(new Set(deps.directory.activeTaskIds()))) {
      const pending = await openEscalation(taskId).catch(() => null);
      if (pending) out.push({ taskId, escalationId: pending.escalationId, label: ownerLabelOf(taskId, names.get(taskId)) });
    }
    return out;
  }

  function remember(key: string, result: InboundResult): InboundResult {
    // Only terminal outcomes are remembered; a transient failure may be retried by a new message.
    if (result.outcome !== "failed" && result.outcome !== "info") deps.ledger.recordHandled({ idempotencyKey: key, outcome: result.outcome });
    log({ event: "human_inbound_handled", outcome: result.outcome });
    return result;
  }
  function duplicateOf(key: string, lang: OwnerLanguage = "zh"): InboundResult | null {
    const prior = deps.ledger.handled(key);
    return prior ? { outcome: "duplicate", message: L(lang, "這則訊息已經處理過了，沒有重複執行。", `Already handled (${prior.outcome}). Nothing was changed.`) } : null;
  }

  /** Resolves an owner-typed task reference among trusted task ids. Read-only selection, never authority. */
  function resolveTask(reference: string, pool: string[], lang: OwnerLanguage = "zh"): { ok: true; taskId: string } | { ok: false; result: InboundResult } {
    const ref = reference.trim().toLowerCase();
    if (pool.includes(ref)) return { ok: true, taskId: ref };
    if (!TASK_REF.test(ref)) return { ok: false, result: { outcome: "invalid", message: L(lang, "請給我任務編號（或至少 4 個字元）。", "Task reference must be a task id or at least 4 of its characters.") } };
    const matches = pool.filter((id) => id.endsWith(ref) || id.startsWith(ref));
    if (matches.length === 1) return { ok: true, taskId: matches[0] };
    if (matches.length === 0) return { ok: false, result: { outcome: "invalid", message: L(lang, "找不到這個任務。可以用 /tasks 看目前的任務。", "No task matches that reference. Use /tasks to list tasks.") } };
    return { ok: false, result: { outcome: "needs_selection", message: L(lang, `有 ${matches.length} 個任務符合：${matches.slice(0, 5).join(", ")}。請給我更完整的編號。`, `That reference matches ${matches.length} tasks: ${matches.slice(0, 5).join(", ")}. Use a longer reference.`) } };
  }

  async function progress(taskId: string, key: string, kind: Milestone, event: ProgressEvent, label: string | undefined, extra: Omit<Parameters<typeof progressMessage>[1], "lang">): Promise<number> {
    const n = milestone(taskId, key, kind, progressMessage(event, { lang: ownerLanguage(label), ...extra }), label);
    return (await notify(n, n.noticeId)) ? 1 : 0;
  }

  async function observeMilestones(taskId: string, label: string | undefined): Promise<number> {
    let sent = 0;
    if (deps.ledger.byNotice(`ms:${taskId}:terminal`)) return 0;
    const s = await status(taskId);
    // Outcome of the latest human decision, so the owner never sees only "submitted".
    const hd = await deps.gateway.getHumanDecision(call({ taskId })).catch(() => null);
    const last = hd?.lastOutcome;
    if (last?.decisionId && (last.outcome === "accepted" || last.outcome === "rejected" || last.outcome === "stale")) {
      const accepted = last.outcome === "accepted";
      sent += await progress(taskId, `hd:${last.decisionId}`, accepted ? "guidance_accepted" : "guidance_rejected", accepted ? "guidance_accepted" : "guidance_rejected", label, { reason: last.reason });
    }
    const wf = s.workforce;
    // Lifecycle progress: only meaningful milestones, each at most once.
    if (s.mode !== "read_only" && (s.status === "running" || s.status === "repair_requested") && s.assignedWorker && !wf?.temporaryCover)
      sent += await progress(taskId, `worker:${s.assignedWorker}`, "worker_assigned", "worker_assigned", label, { worker: s.assignedWorker, area: wf?.workArea ?? "programming" });
    if (s.status === "repair_requested" && s.repairAttempt > 0)
      sent += await progress(taskId, `repair:${s.repairAttempt}`, "repairing", "repairing", label, { attempt: s.repairAttempt });
    if (wf?.temporaryCover && s.assignedWorker === "codex" && wf.primaryWorker === "claude")
      sent += await progress(taskId, `cover:${wf.handoffs}`, "quota_takeover", "quota_takeover", label, {});
    if (wf && !wf.temporaryCover && wf.handoffs > 0 && wf.primaryWorker === "claude" && s.assignedWorker === "claude")
      sent += await progress(taskId, `handback:${wf.handoffs}`, "quota_handback", "quota_handback", label, {});
    if (s.status === "waiting_worker_quota" && wf?.availabilityPause) {
      const p = wf.availabilityPause;
      sent += await progress(taskId, `quota:${p.exhausted}:${p.waitingFor.join("+")}:${wf.handoffs}`, "quota_paused", "quota_paused", label, { area: wf.workArea, waitingFor: p.waitingFor, resetAt: p.resetAt });
    }
    if (s.status === "waiting_worker_availability" && wf?.availabilityPause) {
      const p = wf.availabilityPause;
      sent += await progress(taskId, `avail:${p.cause}:${p.exhausted}:${wf.handoffs}`, "availability_paused", "availability_paused", label, { worker: p.exhausted, cause: p.cause });
    }
    if (s.status === "waiting_infrastructure")
      sent += await progress(taskId, `infra:${s.repairAttempt}`, "infrastructure_waiting", "reviewing_infrastructure_wait", label, {});
    if (s.status === "qa_pending" && s.prNumber) sent += await progress(taskId, `pr:${s.prNumber}`, "pr_opened", "pr_opened", label, { prNumber: s.prNumber });
    if (s.status === "needs_human_approval") {
      const approval = await currentApproval(taskId).catch(() => null);
      // Only approval kinds this transport cannot decide (e.g. post-QA) become an informational milestone.
      if (approval && approval.phase === "post_qa") sent += await progress(taskId, `approval:${approval.approvalRequestId}`, "awaiting_other_approval", "awaiting_other_approval", label, {});
    }
    // A part of a decomposed request: its own completion is not the end; the combined review decides.
    if ((s.status === "accepted" || s.status === "waiting_group" || s.status === "needs_human_decision") && wf?.combinedReview) {
      const c = wf.combinedReview;
      // A cross-part repair task is not a new "part done" moment for the owner.
      if (c.leadTaskId === taskId || !/-g\d+c\d+$/.test(taskId)) sent += await progress(taskId, "part_completed", "part_completed", "part_completed", label, {});
      if (c.lead) {
        if (c.status === "accepted") sent += await progress(taskId, "combined:accepted", "combined_accepted", "combined_accepted", label, { summary: c.ownerSummary });
        else if (c.status === "repairing") sent += await progress(taskId, `combined:repairing:${c.round}.${c.cycle}`, "combined_repairing" as Milestone, "combined_repairing", label, { summary: c.ownerSummary, targets: c.repairTargets });
        else if (c.status === "review_unavailable" || c.status === "diagnosis_unavailable") sent += await progress(taskId, `combined:waiting:${c.round}.${c.cycle}`, "combined_review_waiting", "combined_review_waiting", label, {});
      }
      if (c.status === "accepted") markInline(taskId, "terminal");
      return sent;
    }
    if (TERMINAL.has(s.status)) {
      const answered = s.status === "accepted" && s.mode === "read_only";
      const kind: Milestone = answered ? "answered" : s.status === "accepted" ? "completed" : s.taskState === "cancelled" ? "cancelled" : "blocked";
      sent += await progress(taskId, "terminal", kind, kind as ProgressEvent, label, { answer: s.answer ?? null, prNumber: s.prNumber });
    }
    return sent;
  }

  /** Task-received acknowledgement in the owner's language, conclusion first. */
  function ack(s: GatewayTaskStatus, label: string, intent: string | null, related: { taskId: string; area: "programming" | "visual" }[] | null, lang: OwnerLanguage): string {
    const workers: WorkerKind[] = related ? related.map((p) => (p.area === "visual" ? "codex" : "claude")) : s.assignedWorker ? [s.assignedWorker] : [];
    return taskReceivedMessage({
      lang,
      label,
      mode: s.mode,
      intent: (intent as Parameters<typeof taskReceivedMessage>[0]["intent"]) ?? null,
      workers,
      mixed: Boolean(related && related.length > 1),
      needsStartApproval: s.status === "needs_human_approval",
    });
  }

  /** Submits owner guidance to one open escalation (server-side binding re-read; replay-safe by idempotency key). */
  async function submitGuidance(key: string, target: { taskId: string; escalationId: string }, text: string, lang: OwnerLanguage): Promise<InboundResult> {
    const normalized = normalizeGuidance(text);
    if (!normalized.ok) {
      log({ event: "human_guidance_rejected", outcome: normalized.code });
      return remember(key, { outcome: "invalid", message: inputRejection(normalized.code, lang, "guidance") });
    }
    try {
      const open = await openEscalation(target.taskId);
      if (!open || open.escalationId !== target.escalationId)
        return remember(key, { outcome: "stale", message: L(lang, "這件事已經不需要你決定了（狀態已改變），沒有做任何變更。", "That decision is no longer open. Nothing was changed.") });
      const result = await deps.gateway.submitHumanDecision(call({ escalationId: open.escalationId, idempotencyKey: key, guidance: normalized.guidance }));
      if (result.taskId !== target.taskId) return { outcome: "failed", message: L(lang, "系統暫時無法處理這個請求。", "The control plane could not process this request.") };
      if (result.duplicate) return remember(key, { outcome: "duplicate", message: L(lang, "這個指示已經送出過了，沒有重複執行。", "Already submitted. Nothing was changed.") });
      return remember(key, {
        outcome: "resumed",
        taskId: target.taskId,
        message: L(lang, `收到你的指示，我會重新確認任務狀態後照這個方向繼續，有結果再告訴你。${NOT_APPROVAL_ZH}`, `Guidance received. I will re-check the task state and continue in this direction, and report back. ${NOT_APPROVAL}`),
      });
    } catch (error) {
      return remember(key, gatewayOutcome(error, lang));
    }
  }

  /**
   * The technical view on explicit request: the replied-to task, else the one pending decision, else the
   * only active task. Several candidates: ask which (never guess).
   */
  async function technicalDetails(taskId: string | null, lang: OwnerLanguage): Promise<InboundResult> {
    let id = taskId;
    if (!id) {
      const open = await openDecisions();
      if (open.length === 1) id = open[0].taskId;
      else {
        const active = Array.from(new Set(deps.directory.activeTaskIds()));
        const recent = active.length ? active : deps.ledger.tracked().map((t) => t.taskId).slice(-1);
        if (recent.length === 1) id = recent[0];
        else if (recent.length === 0) return { outcome: "info", message: L(lang, "目前沒有任務可以看細節。", "There is no task to show details for.") };
        else {
          const names = labels();
          return {
            outcome: "needs_selection",
            message: L(
              lang,
              `你要看哪一個任務的技術細節？請直接「回覆」那個任務的訊息再問一次：\n${recent.slice(0, 6).map((t, i) => `${i + 1}.「${ownerLabelOf(t, names.get(t))}」`).join("\n")}`,
              `Which task's technical details? Reply to that task's message and ask again:\n${recent.slice(0, 6).map((t, i) => `${i + 1}. "${ownerLabelOf(t, names.get(t))}"`).join("\n")}`,
            ),
          };
        }
      }
    }
    try {
      const s = await status(id);
      const d = s.details;
      const label = ownerLabelOf(id, labels().get(id));
      if (!d) return { outcome: "info", taskId: id, message: L(lang, `「${label}」目前還沒有技術細節。`, `No technical details for "${label}" yet.`) };
      return {
        outcome: "info",
        taskId: id,
        message: technicalDetailsMessage({ taskId: id, label, phase: plainPhase(s, lang), prNumber: s.prNumber, ...d }, lang),
      };
    } catch (error) {
      return gatewayOutcome(error, lang);
    }
  }

  function whichDecision(open: { label: string }[], lang: OwnerLanguage): InboundResult {
    const list = open.slice(0, 6).map((o, i) => `${i + 1}.「${o.label}」`).join("\n");
    return {
      outcome: "needs_selection",
      message: L(
        lang,
        `目前有 ${open.length} 件事在等你決定，我不確定你指的是哪一件：\n${list}\n請直接「回覆」那件事的訊息，我就會照你的指示處理。這次沒有做任何變更。`,
        `${open.length} decisions are waiting for you and I am not sure which one you mean:\n${list}\nPlease reply directly to that decision's message. Nothing was changed.`,
      ),
    };
  }

  /**
   * Natural-language routing. Intent understanding happens in the trusted
   * planning layer behind the Gateway; this service only executes the
   * resulting decision through existing Gateway operations. Returns null when
   * the planner is unavailable so the caller can fall back safely.
   *
   * `pending` lists the open human decisions when the message was NOT an
   * explicit reply: with exactly one, ordinary guidance-like text is bound to
   * it; with several, the owner is asked which one (never a guess).
   */
  async function routeMessage(key: string, text: string, contextTaskId: string | null, requireTask: boolean, priority?: InboundGoal["priority"], pending: { taskId: string; escalationId: string; label: string }[] = []): Promise<InboundResult | null> {
    const lang = ownerLanguage(text);
    let view: Awaited<ReturnType<HumanInteractionGateway["interpretOwnerMessage"]>>;
    try {
      view = await deps.gateway.interpretOwnerMessage(call({ idempotencyKey: key, text, contextTaskId, requireTask, ...(priority ? { priority } : {}) }));
    } catch (error) {
      if (error instanceof GatewayError && error.code === "unavailable") return null;
      return remember(key, gatewayOutcome(error, lang));
    }
    const d = view.decision;
    const guidanceLike = d.kind === "human_decision" || d.kind === "clarify" || (d.kind === "task_follow_up" && (d.taskId === null || pending.some((p) => p.taskId === d.taskId)));
    if (pending.length === 1 && guidanceLike) return submitGuidance(key, pending[0], text, lang);
    if (pending.length > 1 && d.kind === "human_decision") return whichDecision(pending, lang);
    switch (d.kind) {
      case "task": {
        try {
          const result = await deps.gateway.submitInterpretedTask(call({ interpretationId: view.interpretationId }));
          const parts = result.parts ?? null;
          if (parts && parts.length > 1)
            for (const p of parts) deps.ledger.track({ taskId: p.taskId, label: oneLine(`${d.title}${p.area === "visual" ? L(lang, "（畫面）", " (visual)") : L(lang, "（程式）", " (programming)")}`, 60) });
          else deps.ledger.track({ taskId: result.taskId, label: oneLine(d.title, 60) });
          if (result.duplicate) return remember(key, { outcome: "duplicate", taskId: result.taskId, message: L(lang, "這個需求已經交辦過了，不會重複建立任務。", `This request was already submitted as task ${result.taskId}.`) });
          return remember(key, { outcome: "submitted", taskId: result.taskId, message: ack(result.status, oneLine(d.title, 60), d.intent, parts, lang) });
        } catch (error) {
          if (error instanceof GatewayError && error.code === "invalid_request")
            return remember(key, {
              outcome: "invalid",
              message: L(lang, "我沒辦法把這段話轉成明確的任務，可以再說明一下你想要的結果嗎？沒有建立任何任務。", `The Manager could not turn this into a task (${oneLine(error.message, 120)}). Please restate the goal as the outcome you want. No task was created.`),
            });
          return remember(key, gatewayOutcome(error, lang));
        }
      }
      case "clarify": {
        // A Manager question that is not in the owner's language is replaced (never shown raw).
        const q = lang === "zh" && !/[\u3400-\u9fff]/.test(d.question) ? "我不太確定你的意思，可以再具體說明你希望我做什麼嗎？" : d.question;
        return { outcome: "info", message: `${q}\n${L(lang, "（沒有做任何變更）", "(Nothing was changed.)")}` };
      }
      case "status_query":
        return service.listTasks();
      case "task_follow_up":
        return d.taskId ? service.taskStatus(d.taskId) : service.listTasks();
      case "cancel_or_pause":
        if (!d.taskId) return { outcome: "needs_selection", message: L(lang, "要停止哪一個任務？請回覆該任務的訊息並輸入 /cancel，或傳 /cancel <任務編號>。沒有做任何變更。", "Which task should stop? Reply /cancel to its message or send /cancel <task>. Nothing was changed.") };
        return service.requestCancel({ kind: "cancel_request", idempotencyKey: key, target: { taskReference: d.taskId } });
      case "human_decision":
        return { outcome: "info", message: L(lang, "目前沒有等你決定的事項，沒有做任何變更。", "Nothing is waiting for your decision right now. Nothing was changed.") };
    }
  }

  const service: HumanInteractionService = {
    async observe() {
      let delivered = 0;
      // Cross-part repair tasks belong to the owner's same request: they carry its label.
      for (const taskId of Array.from(new Set(deps.directory.activeTaskIds()))) {
        if (labels().has(taskId)) continue;
        const s = await status(taskId).catch(() => null);
        const lead = s?.workforce?.combinedReview?.leadTaskId;
        const leadLabel = lead ? labels().get(lead) : undefined;
        if (lead && lead !== taskId && leadLabel !== undefined) deps.ledger.track({ taskId, label: oneLine(`${leadLabel.replace(/（程式）|（畫面）| \((?:programming|visual)\)$/, "")}（修正）`, 60) });
      }
      const names = labels();
      for (const taskId of Array.from(new Set(deps.directory.activeTaskIds()))) {
        try {
          const pending = await openEscalation(taskId);
          if (pending) {
            const mode = await status(taskId).then((s) => s.mode).catch(() => "change" as const);
            if (await notify(decisionNotice(pending, names.get(taskId), { mode }), pending.escalationId)) {
              delivered++;
              deps.ledger.track({ taskId, label: names.get(taskId) ?? "" });
            }
          }
        } catch {
          log({ event: "human_decision_read_failed", outcome: "skipped" });
        }
        try {
          const approval = await currentApproval(taskId);
          const notice = approval ? (approvalNotice(approval, names.get(taskId)) ?? startApprovalNotice(approval, names.get(taskId))) : null;
          if (approval && notice && (await notify(notice, approval.approvalRequestId))) {
            delivered++;
            deps.ledger.track({ taskId, label: names.get(taskId) ?? "" });
          }
        } catch {
          log({ event: "approval_read_failed", outcome: "skipped" });
        }
      }
      const known = new Set(deps.directory.allTaskIds());
      for (const t of deps.ledger.tracked()) {
        if (!known.has(t.taskId)) continue;
        try {
          delivered += await observeMilestones(t.taskId, t.label || undefined);
        } catch {
          log({ event: "milestone_read_failed", outcome: "skipped" });
        }
      }
      return { delivered };
    },

    async submitGoal(goal) {
      const lang = ownerLanguage(goal.text);
      const dup = duplicateOf(goal.idempotencyKey, lang);
      if (dup) return dup;
      const normalized = normalizeGoal(goal.text);
      if (!normalized.ok) {
        log({ event: "human_goal_rejected", outcome: normalized.code });
        return remember(goal.idempotencyKey, { outcome: "invalid", message: inputRejection(normalized.code, lang, "request") });
      }
      // Explicit /goal still goes through the trusted planner (criteria, intent, mode) when it is available.
      const routed = await routeMessage(goal.idempotencyKey, normalized.goal, null, true, goal.priority);
      if (routed) return routed;
      if (deps.managerRequired)
        return { outcome: "info", message: L(lang, "我的理解服務（GPT Manager）暫時無法使用，這次沒有建立任務。請稍後再傳一次。", "My GPT Manager is unavailable right now, so no task was created. Please resend shortly.") };
      try {
        // Planner unavailable: legacy intake with only user intent (instruction + optional priority).
        const result = await deps.gateway.submitTask(
          call({ idempotencyKey: goal.idempotencyKey, userInstruction: normalized.goal, ...(goal.priority ? { priority: goal.priority } : {}) }),
        );
        deps.ledger.track({ taskId: result.taskId, label: oneLine(normalized.goal, 60) });
        if (result.duplicate) return remember(goal.idempotencyKey, { outcome: "duplicate", taskId: result.taskId, message: L(lang, "這個需求已經交辦過了，不會重複建立任務。", `This goal was already submitted as task ${result.taskId}.`) });
        return remember(goal.idempotencyKey, {
          outcome: "submitted",
          taskId: result.taskId,
          message: `${ack(result.status, oneLine(normalized.goal, 60), null, null, lang)}\n${L(lang, "（我的理解服務目前無法使用，這個任務只會以自動檢查結果驗收。）", "(The Manager's interpretation service is unavailable; this task is accepted on automatic checks only.)")}`,
        });
      } catch (error) {
        if (error instanceof GatewayError && error.code === "invalid_request" && /clarification/.test(error.message))
          return remember(goal.idempotencyKey, { outcome: "invalid", message: L(lang, "我需要更明確的目標（要改什麼、希望看到什麼結果）。沒有建立任務。", "The Manager needs a more specific goal (what to change and the observable outcome). No task was created.") });
        return remember(goal.idempotencyKey, gatewayOutcome(error, lang));
      }
    },

    async handleReply(reply) {
      const lang = ownerLanguage(reply.text);
      const dup = duplicateOf(reply.idempotencyKey, lang);
      if (dup) return dup;
      let notice: NoticeRecord | null = null;
      if (reply.replyToDeliveryRef !== null) notice = deps.ledger.byDeliveryRef(reply.replyToDeliveryRef);
      if (!notice && reply.replyToNoticeRef) notice = deps.ledger.byRef(reply.replyToNoticeRef);
      // Explicit request for technical details (also as a reply to a decision): a question, never guidance.
      if (DETAILS_REQUEST.test(reply.text)) return technicalDetails(notice?.taskId ?? null, lang);
      if (notice && notice.kind === "human_decision") {
        // Explicit reply to a decision message: preferred, exact correlation.
        return submitGuidance(reply.idempotencyKey, { taskId: notice.taskId, escalationId: notice.targetId }, reply.text, lang);
      }
      // Ordinary owner text (or a reply to a non-decision message): the trusted planner interprets it.
      const screened = normalizeGoal(reply.text);
      if (!screened.ok) {
        log({ event: "human_message_rejected", outcome: screened.code });
        return remember(reply.idempotencyKey, { outcome: "invalid", message: inputRejection(screened.code, lang, "request") });
      }
      // Only an ordinary (not explicitly correlated) message may bind to an open decision implicitly.
      const pending = notice ? [] : await openDecisions();
      const context = notice?.taskId ?? (pending.length === 1 ? pending[0].taskId : null);
      const routed = await routeMessage(reply.idempotencyKey, screened.goal, context, false, undefined, pending);
      if (routed) return routed;
      if (pending.length === 1) return submitGuidance(reply.idempotencyKey, pending[0], screened.goal, lang);
      if (pending.length > 1) return whichDecision(pending, lang);
      return {
        outcome: "info",
        message: L(
          lang,
          "我的理解服務暫時無法使用，所以現在沒辦法解讀一般文字，沒有做任何變更。可以用 /goal <目標>、/tasks、/status <任務>。",
          "My interpretation service is unavailable right now, so I cannot read free text. Nothing was changed. Use /goal <goal>, /tasks or /status <task>, or reply directly to a decision message.",
        ),
      };
    },

    async requestCancel(request) {
      const dup = duplicateOf(request.idempotencyKey);
      if (dup) return dup;
      let taskId: string;
      const t = request.target;
      if ("taskReference" in t) {
        const resolved = resolveTask(t.taskReference, deps.directory.activeTaskIds());
        if (!resolved.ok) return resolved.result;
        taskId = resolved.taskId;
      } else {
        const notice = "deliveryRef" in t ? deps.ledger.byDeliveryRef(t.deliveryRef) : deps.ledger.byRef(t.noticeRef);
        if (!notice || notice.kind === "cancel_confirmation")
          return remember(request.idempotencyKey, { outcome: "invalid", message: "請回覆要取消的任務訊息並輸入 /cancel，或傳 /cancel <任務編號>。沒有做任何變更。" });
        taskId = notice.taskId;
      }
      const label = labels().get(taskId);
      const lang = ownerLanguage(label);
      try {
        const s = await status(taskId);
        if (TERMINAL.has(s.status)) return remember(request.idempotencyKey, { outcome: "stale", message: L(lang, `「${ownerLabelOf(taskId, label)}」已經結束了，沒有做任何變更。`, `Task ${taskId} is already finished. Nothing was changed.`) });
      } catch (error) {
        return remember(request.idempotencyKey, gatewayOutcome(error, lang));
      }
      const noticeId = `cancel:${taskId}:${request.idempotencyKey}`;
      const confirmation: CancelConfirmationNotice = {
        kind: "cancel_confirmation",
        noticeId,
        ref: noticeRef(noticeId),
        taskId,
        taskLabel: taskLabel(taskId, label),
        lang,
        ownerLabel: ownerLabelOf(taskId, label),
        expiresAt: new Date(Date.parse(deps.now()) + cancelMs).toISOString(),
      };
      const sent = await notify(confirmation, taskId);
      if (!sent) return { outcome: "failed", message: L(lang, "取消確認訊息送不出去，沒有做任何變更。", "Could not send the cancel confirmation. Nothing was changed.") };
      return remember(request.idempotencyKey, { outcome: "confirm_requested", taskId, message: "" });
    },

    async handleAction(action) {
      const dup = duplicateOf(action.idempotencyKey);
      if (dup) return dup;
      const notice = deps.ledger.byRef(action.ref);
      if (!notice) return remember(action.idempotencyKey, { outcome: "stale", message: "這個按鈕已經失效，沒有做任何變更。" });
      const label = labels().get(notice.taskId);
      const lang = ownerLanguage(label);
      const name = ownerLabelOf(notice.taskId, label);
      try {
        if (action.action === "cancel_request") return service.requestCancel({ kind: "cancel_request", idempotencyKey: action.idempotencyKey, target: { noticeRef: action.ref } });
        if (action.action === "cancel_keep" || action.action === "cancel_confirm") {
          if (notice.kind !== "cancel_confirmation") return remember(action.idempotencyKey, { outcome: "invalid", message: L(lang, "沒有需要確認的事，沒有做任何變更。", "Nothing to confirm. Nothing was changed.") });
          if (action.action === "cancel_keep") return remember(action.idempotencyKey, { outcome: "kept", message: L(lang, `好的，「${name}」會繼續進行。`, `Task ${notice.taskId} keeps running.`) });
          if (deps.ledger.handled(`cancel-used:${notice.ref}`)) return { outcome: "duplicate", message: L(lang, "這個確認已經用過了，沒有做任何變更。", "This confirmation was already used. Nothing was changed.") };
          const age = Date.parse(deps.now()) - Date.parse(notice.createdAt);
          if (!Number.isFinite(age) || age < 0 || age > cancelMs)
            return remember(action.idempotencyKey, { outcome: "stale", message: L(lang, "這個確認已經過期。如果還要取消，請再傳一次 /cancel。沒有做任何變更。", "This confirmation expired. Send /cancel again if you still want to cancel. Nothing was changed.") });
          const s = await status(notice.taskId);
          if (TERMINAL.has(s.status)) return remember(action.idempotencyKey, { outcome: "stale", message: L(lang, `「${name}」已經結束了，沒有做任何變更。`, `Task ${notice.taskId} is already finished. Nothing was changed.`) });
          await deps.gateway.cancelTask(call({ taskId: notice.taskId, idempotencyKey: `hi.cancel.${notice.ref}` }));
          deps.ledger.recordHandled({ idempotencyKey: `cancel-used:${notice.ref}`, outcome: "cancelled" });
          markInline(notice.taskId, "terminal");
          return remember(action.idempotencyKey, {
            outcome: "cancelled",
            taskId: notice.taskId,
            message: L(lang, `已取消「${name}」。這個動作沒有做任何 commit、推送或 PR。`, `Task ${notice.taskId} was cancelled. No commit, push, or PR was made by this action.`),
          });
        }
        if (notice.kind !== "commit_publish_approval" && notice.kind !== "start_approval")
          return remember(action.idempotencyKey, { outcome: "invalid", message: L(lang, "只有批准訊息可以按批准或拒絕，沒有做任何變更。", "Only approval messages can be approved or rejected. Nothing was changed.") });
        const current = await currentApproval(notice.taskId);
        // The button only names a notice; the exact binding is re-read from the Manager through the Gateway,
        // and the notice kind must still match the approval kind (a start approval can never become commit/publish).
        const expected = notice.kind === "commit_publish_approval" ? { kind: "commit_publish", phase: "commit_publish" } : { kind: "start", phase: "pre_execution" };
        if (!current || current.approvalRequestId !== notice.targetId || current.kind !== expected.kind || current.phase !== expected.phase)
          return remember(action.idempotencyKey, { outcome: "stale", message: L(lang, "這個批准請求已經不是最新的了，沒有做任何變更。", "This approval request is no longer current. Nothing was changed.") });
        const decision = action.action === "approve" ? "approved" : "rejected";
        const request = {
          taskId: current.taskId,
          idempotencyKey: `hi.ap.${notice.ref}.${decision}`,
          approvalRequestId: current.approvalRequestId,
          kind: current.kind,
          phase: current.phase,
          action: current.action,
          bindingTarget: current.bindingTarget,
        };
        const result = decision === "approved" ? await deps.gateway.approveTask(call(request)) : await deps.gateway.rejectTask(call(request));
        if (result.duplicate) return remember(action.idempotencyKey, { outcome: "duplicate", message: L(lang, "這個已經決定過了，沒有做任何變更。", "Already decided. Nothing was changed.") });
        const outcome: InboundOutcome = decision === "approved" ? "approved" : "rejected";
        const start = current.kind === "start";
        return remember(action.idempotencyKey, {
          outcome,
          taskId: current.taskId,
          message: start
            ? decision === "approved"
              ? L(lang, `已批准執行「${name}」。只允許這一次執行；之後要發布時會另外請你批准。不會合併，也不會部署。`, `Approved this exact execution for ${current.taskId}. The Worker may now run this contract only. Commit/publish is a separate later approval; merge and deploy are NOT approved.`)
              : L(lang, `已拒絕執行「${name}」，工程師不會執行這次的內容。`, `Rejected the execution of ${current.taskId}. The Worker will not run this contract.`)
            : decision === "approved"
              ? L(lang, `已批准發布「${name}」：我會建立 commit、推送並開 PR。不會合併，也不會部署。`, `Approved commit + publish for ${current.taskId}: commit, normal push, open/reuse PR. Merge and deploy are NOT approved.`)
              : L(lang, `已拒絕發布「${name}」，這次不會 commit 或推送。`, `Rejected commit + publish for ${current.taskId}. Nothing will be committed or pushed for this request.`),
        });
      } catch (error) {
        return remember(action.idempotencyKey, gatewayOutcome(error, lang));
      }
    },

    async listTasks() {
      const names = labels();
      const lines: string[] = [];
      for (const taskId of deps.directory.activeTaskIds()) {
        const label = names.get(taskId);
        const lang = ownerLanguage(label);
        try {
          const s = await status(taskId);
          lines.push(`• ${ownerLabelOf(taskId, label)}\n  ${plainPhase(s, lang)}${L(lang, `（編號 ${taskId}）`, ` (id ${taskId})`)}`);
        } catch {
          lines.push(`• ${ownerLabelOf(taskId, label)}\n  ${L(lang, "狀態暫時讀不到", "status unavailable")}`);
        }
      }
      const finished = deps.directory.allTaskIds().length - lines.length;
      return {
        outcome: "info",
        message: lines.length
          ? `目前進行中的任務（${lines.length}）：\n${lines.join("\n")}${finished > 0 ? `\n（另有 ${finished} 個已結束）` : ""}`
          : `目前沒有進行中的任務。${finished > 0 ? `（另有 ${finished} 個已結束）` : ""}`,
      };
    },

    async taskStatus(reference) {
      const resolved = resolveTask(reference, deps.directory.allTaskIds());
      if (!resolved.ok) return resolved.result;
      const label = labels().get(resolved.taskId);
      const lang = ownerLanguage(label);
      try {
        const s = await status(resolved.taskId);
        const wf = s.workforce;
        const who = s.assignedWorker
          ? `${s.assignedWorker === "claude" ? "Claude" : "Codex"}${wf?.temporaryCover ? L(lang, "（暫代 Claude，額度恢復後交回）", " (temporarily covering for Claude)") : ""}`
          : L(lang, "尚未指派", "not assigned yet");
        const lines = [
          L(lang, `任務：${ownerLabelOf(resolved.taskId, label)}`, `Task: ${ownerLabelOf(resolved.taskId, label)}`),
          L(lang, `目前進度：${plainPhase(s, lang)}`, `Progress: ${plainPhase(s, lang)}`),
          L(lang, `負責：${who}`, `Assigned: ${who}`),
          ...(s.repairAttempt > 0 ? [L(lang, `修正次數：${s.repairAttempt}`, `Fix attempts: ${s.repairAttempt}`)] : []),
          ...(s.prNumber ? [`PR: #${s.prNumber}`] : []),
          L(lang, `編號：${resolved.taskId}`, `Id: ${resolved.taskId}`),
        ];
        return { outcome: "info", taskId: resolved.taskId, message: lines.join("\n") };
      } catch (error) {
        return gatewayOutcome(error, lang);
      }
    },
  };
  return service;
}

/** Plain-language cancel confirmation text (exported for transports). */
export function cancelText(n: CancelConfirmationNotice): string {
  return cancelConfirmationMessage({ lang: n.lang ?? "zh", label: n.ownerLabel ?? n.taskLabel, expiresAt: n.expiresAt });
}
