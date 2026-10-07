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
export function normalizeGuidance(text: string): { ok: true; guidance: string } | { ok: false; reason: string } {
  if (typeof text !== "string") return { ok: false, reason: "guidance must be text" };
  const guidance = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!guidance) return { ok: false, reason: "guidance is empty" };
  if (guidance.length > MAX_HUMAN_GUIDANCE_LENGTH) return { ok: false, reason: `guidance is longer than ${MAX_HUMAN_GUIDANCE_LENGTH} characters` };
  if (looksSecret(guidance)) return { ok: false, reason: "guidance looks like a credential or secret; remove it and resend" };
  return { ok: true, guidance };
}

/** Normalizes an untrusted goal. It becomes userInstruction only; intake derives everything else. */
export function normalizeGoal(text: string): { ok: true; goal: string } | { ok: false; reason: string } {
  if (typeof text !== "string") return { ok: false, reason: "goal must be text" };
  const goal = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!goal) return { ok: false, reason: "goal is empty" };
  if (goal.length > MAX_GOAL_LENGTH) return { ok: false, reason: `goal is longer than ${MAX_GOAL_LENGTH} characters` };
  if (goal.split("\n").some((line) => looksSecret(line)))
    return { ok: false, reason: "goal looks like it contains a credential or secret; remove it and resend" };
  return { ok: true, goal };
}

export function decisionNotice(view: PendingHumanDecisionView, label?: string): HumanDecisionNotice {
  const noticeId = `hd:${view.escalationId}`;
  const b = view.currentBlocker;
  return {
    kind: "human_decision",
    noticeId,
    ref: noticeRef(noticeId),
    taskId: view.taskId,
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
    approvalRequestId: approval.approvalRequestId,
    taskLabel: taskLabel(approval.taskId, label),
    objectiveSummary: oneLine(e.objectiveSummary, 400),
    actions: e.actions.slice(0, 20).map((a) => oneLine(a, 60)),
    riskReasons: e.riskReasons.slice(0, 8).map((r) => oneLine(r, 200)),
    allowedScope: e.allowedScope.slice(0, 20).map((p) => oneLine(p, 200)),
    repair: e.repair,
    readOnly: e.mode === "read_only",
    risk: approval.risk,
    expiresAt: approval.expiresAt,
    authorizes: { executeThisExactContract: true, commit: false, push: false, openPr: false, merge: false, deploy: false, gitPermissionsForWorker: false },
  };
}

function taskLabel(taskId: string, label?: string): string {
  return label ? `${oneLine(taskId, 64)} — ${oneLine(label, 60)}` : oneLine(taskId, 64);
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
      return "waiting for your decision (reply to the escalation message)";
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

function gatewayOutcome(error: unknown): InboundResult {
  if (error instanceof GatewayError) {
    if (["stale_binding", "conflict", "approval_not_required", "approval_expired", "not_found"].includes(error.code))
      return { outcome: "stale", message: `This request is no longer current (${error.code}). Nothing was changed.` };
    if (error.code === "invalid_request") return { outcome: "invalid", message: `Not accepted: ${oneLine(error.message, 160)}. Nothing was changed.` };
    if (error.code === "idempotency_conflict") return { outcome: "invalid", message: "This message was already used for a different request. Nothing was changed." };
  }
  return { outcome: "failed", message: "The control plane could not process this request. Nothing was changed." };
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
    // An answer keeps its line breaks (bounded); every other milestone is one short line.
    const text = kind === "answered" ? detail.replace(/\b[0-9a-f]{40,64}\b/gi, "[sha]").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").slice(0, 3_000) : safeDetail(detail, 400);
    return { kind: "milestone", noticeId, ref: noticeRef(noticeId), taskId, milestone: kind, taskLabel: taskLabel(taskId, label), detail: text };
  }

  const status = (taskId: string) => deps.gateway.getTaskStatus(call({ taskId }));
  const openEscalation = async (taskId: string) => (await deps.gateway.getHumanDecision(call({ taskId }))).pending;
  async function currentApproval(taskId: string): Promise<PendingApprovalRequirement | null> {
    const response = await deps.gateway.getPendingApproval(call({ taskId }));
    return response.result === "pending" ? response.approval : null;
  }

  function remember(key: string, result: InboundResult): InboundResult {
    // Only terminal outcomes are remembered; a transient failure may be retried by a new message.
    if (result.outcome !== "failed" && result.outcome !== "info") deps.ledger.recordHandled({ idempotencyKey: key, outcome: result.outcome });
    log({ event: "human_inbound_handled", outcome: result.outcome });
    return result;
  }
  function duplicateOf(key: string): InboundResult | null {
    const prior = deps.ledger.handled(key);
    return prior ? { outcome: "duplicate", message: `Already handled (${prior.outcome}). Nothing was changed.` } : null;
  }

  /** Resolves an owner-typed task reference among trusted task ids. Read-only selection, never authority. */
  function resolveTask(reference: string, pool: string[]): { ok: true; taskId: string } | { ok: false; result: InboundResult } {
    const ref = reference.trim().toLowerCase();
    if (pool.includes(ref)) return { ok: true, taskId: ref };
    if (!TASK_REF.test(ref)) return { ok: false, result: { outcome: "invalid", message: "Task reference must be a task id or at least 4 of its characters." } };
    const matches = pool.filter((id) => id.endsWith(ref) || id.startsWith(ref));
    if (matches.length === 1) return { ok: true, taskId: matches[0] };
    if (matches.length === 0) return { ok: false, result: { outcome: "invalid", message: "No task matches that reference. Use /tasks to list tasks." } };
    return { ok: false, result: { outcome: "needs_selection", message: `That reference matches ${matches.length} tasks: ${matches.slice(0, 5).join(", ")}. Use a longer reference.` } };
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
      const n = milestone(
        taskId,
        `hd:${last.decisionId}`,
        accepted ? "guidance_accepted" : "guidance_rejected",
        accepted
          ? "The Manager accepted your guidance and resumed the same task with a new repair plan. You will be notified at the next decision point."
          : `The Manager did not accept your guidance (${last.reason}). Nothing was resumed.`,
        label,
      );
      if (await notify(n, n.noticeId)) sent++;
    }
    if (s.status === "waiting_infrastructure") {
      const n = milestone(
        taskId,
        `infra:${s.repairAttempt}`,
        "infrastructure_waiting",
        `The Worker finished, but the Manager's goal reviewer is unavailable (infrastructure), so the result cannot be judged yet. The task is waiting, not failed; no repair cycle was used. ${s.waitReason ?? ""}`,
        label,
      );
      if (await notify(n, n.noticeId)) sent++;
    }
    if (s.status === "qa_pending" && s.prNumber) {
      const n = milestone(taskId, `pr:${s.prNumber}`, "pr_opened", `PR #${s.prNumber} is open and waiting for CI. The agent will not merge or deploy.`, label);
      if (await notify(n, n.noticeId)) sent++;
    }
    if (s.status === "needs_human_approval") {
      const approval = await currentApproval(taskId).catch(() => null);
      // Only approval kinds this transport cannot decide (e.g. post-QA) become an informational milestone.
      if (approval && approval.phase === "post_qa") {
        const n = milestone(
          taskId,
          `approval:${approval.approvalRequestId}`,
          "awaiting_other_approval",
          `This task needs a ${approval.phase.replace("_", "-")} approval (risk ${approval.risk}). That approval is not available in Telegram; it stays with the operator Gateway.`,
          label,
        );
        if (await notify(n, n.noticeId)) sent++;
      }
    }
    if (TERMINAL.has(s.status)) {
      const answered = s.status === "accepted" && s.mode === "read_only";
      const kind: Milestone = answered ? "answered" : s.status === "accepted" ? "completed" : s.taskState === "cancelled" ? "cancelled" : "blocked";
      const detail = answered
        ? `${s.answer ?? "(no answer recorded)"}\n\n(Read-only task: no file was changed; the Manager verified the answer against the cited repository files.)`
        : kind === "completed"
          ? `Task complete${s.prNumber ? `: PR #${s.prNumber} passed the required checks` : ""}. Merge and deploy are left to you.`
          : kind === "cancelled"
            ? "The task was cancelled. No further commit, push, or PR update will happen."
            : `The task is blocked: ${s.waitReason ?? "see /status"}.`;
      const n = milestone(taskId, "terminal", kind, detail, label);
      if (await notify(n, n.noticeId)) sent++;
    }
    return sent;
  }

  const INTENT_LABEL: Record<string, string> = {
    investigate_or_answer: "唯讀調查（不會修改任何檔案）",
    audit_or_review: "唯讀審查（不會修改任何檔案）",
    change_code: "修改程式",
    audit_and_fix: "審查並在範圍內修正",
  };

  function ack(taskId: string, s: GatewayTaskStatus, intent: string | null, criteria: readonly string[] | null): string {
    return [
      "OXM Agent 已收到任務",
      `Task: ${taskId}`,
      ...(intent ? [`類型：${INTENT_LABEL[intent] ?? intent}`] : []),
      "狀態：已交給 Manager",
      `風險：${s.risk}`,
      `優先序：${s.priority}`,
      ...(criteria && criteria.length ? ["驗收條件（Manager 會逐條驗證）：", ...criteria.slice(0, 8).map((c, i) => `  ${i + 1}. ${oneLine(c, 200)}`)] : []),
      s.status === "needs_human_approval" ? "此任務屬高風險：執行前我會先請你在這裡批准。" : "",
      s.mode === "read_only"
        ? "接下來我會自行調查並回覆答案；不會修改程式，也不需要發布批准。"
        : "接下來我會自行執行；只有需要你的決策或最終發布批准時才會通知你。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Natural-language routing. Intent understanding happens in the trusted
   * planning layer behind the Gateway; this service only executes the
   * resulting decision through existing Gateway operations. Returns null when
   * the planner is unavailable so the caller can fall back safely.
   */
  async function routeMessage(key: string, text: string, contextTaskId: string | null, requireTask: boolean, priority?: InboundGoal["priority"]): Promise<InboundResult | null> {
    let view: Awaited<ReturnType<HumanInteractionGateway["interpretOwnerMessage"]>>;
    try {
      view = await deps.gateway.interpretOwnerMessage(call({ idempotencyKey: key, text, contextTaskId, requireTask, ...(priority ? { priority } : {}) }));
    } catch (error) {
      if (error instanceof GatewayError && error.code === "unavailable") return null;
      return remember(key, gatewayOutcome(error));
    }
    const d = view.decision;
    switch (d.kind) {
      case "task": {
        try {
          const result = await deps.gateway.submitInterpretedTask(call({ interpretationId: view.interpretationId }));
          deps.ledger.track({ taskId: result.taskId, label: oneLine(d.title, 60) });
          if (result.duplicate) return remember(key, { outcome: "duplicate", taskId: result.taskId, message: `This request was already submitted as task ${result.taskId}.` });
          return remember(key, { outcome: "submitted", taskId: result.taskId, message: ack(result.taskId, result.status, d.intent, d.criteria) });
        } catch (error) {
          if (error instanceof GatewayError && error.code === "invalid_request")
            return remember(key, { outcome: "invalid", message: `The Manager could not turn this into a task (${oneLine(error.message, 120)}). Please restate the goal as the outcome you want. No task was created.` });
          return remember(key, gatewayOutcome(error));
        }
      }
      case "clarify":
        return { outcome: "info", message: `${d.question}\n(Nothing was changed.)` };
      case "status_query":
        return service.listTasks();
      case "task_follow_up":
        return d.taskId ? service.taskStatus(d.taskId) : service.listTasks();
      case "cancel_or_pause":
        if (!d.taskId) return { outcome: "needs_selection", message: "Which task should stop? Reply /cancel to its message or send /cancel <task>. Nothing was changed." };
        return service.requestCancel({ kind: "cancel_request", idempotencyKey: key, target: { taskReference: d.taskId } });
      case "human_decision": {
        // Guidance binds only through a reply to the escalation message (trusted correlation), never a guess.
        const open = d.taskId ? await openEscalation(d.taskId).catch(() => null) : null;
        return {
          outcome: "needs_selection",
          message: open
            ? `To give guidance on ${d.taskId} (${open.escalationId}), reply directly to its escalation message. Nothing was changed.`
            : "I could not find an open escalation for that. Reply directly to the escalation message you are answering. Nothing was changed.",
        };
      }
    }
  }

  const service: HumanInteractionService = {
    async observe() {
      let delivered = 0;
      const names = labels();
      for (const taskId of Array.from(new Set(deps.directory.activeTaskIds()))) {
        try {
          const pending = await openEscalation(taskId);
          if (pending && (await notify(decisionNotice(pending, names.get(taskId)), pending.escalationId))) {
            delivered++;
            deps.ledger.track({ taskId, label: names.get(taskId) ?? "" });
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
      const dup = duplicateOf(goal.idempotencyKey);
      if (dup) return dup;
      const normalized = normalizeGoal(goal.text);
      if (!normalized.ok) return remember(goal.idempotencyKey, { outcome: "invalid", message: `Not accepted: ${normalized.reason}. No task was created.` });
      // Explicit /goal still goes through the trusted planner (criteria, intent, mode) when it is available.
      const routed = await routeMessage(goal.idempotencyKey, normalized.goal, null, true, goal.priority);
      if (routed) return routed;
      try {
        // Planner unavailable: legacy intake with only user intent (instruction + optional priority).
        const result = await deps.gateway.submitTask(
          call({ idempotencyKey: goal.idempotencyKey, userInstruction: normalized.goal, ...(goal.priority ? { priority: goal.priority } : {}) }),
        );
        deps.ledger.track({ taskId: result.taskId, label: oneLine(normalized.goal, 60) });
        if (result.duplicate) return remember(goal.idempotencyKey, { outcome: "duplicate", taskId: result.taskId, message: `This goal was already submitted as task ${result.taskId}.` });
        return remember(goal.idempotencyKey, { outcome: "submitted", taskId: result.taskId, message: ack(result.taskId, result.status, null, null) + "\n（Agent planner 目前無法使用：此任務只以驗證結果驗收。）" });
      } catch (error) {
        if (error instanceof GatewayError && error.code === "invalid_request" && /clarification/.test(error.message))
          return remember(goal.idempotencyKey, { outcome: "invalid", message: "The Manager needs a more specific goal (what to change and the observable outcome). No task was created." });
        return remember(goal.idempotencyKey, gatewayOutcome(error));
      }
    },

    async handleReply(reply) {
      const dup = duplicateOf(reply.idempotencyKey);
      if (dup) return dup;
      let notice: NoticeRecord | null = null;
      if (reply.replyToDeliveryRef !== null) notice = deps.ledger.byDeliveryRef(reply.replyToDeliveryRef);
      if (!notice && reply.replyToNoticeRef) notice = deps.ledger.byRef(reply.replyToNoticeRef);
      if (!notice || notice.kind !== "human_decision") {
        // Ordinary owner text (or a reply to a non-escalation message): the trusted planner interprets it.
        // A reply only contributes the trusted task it replied to as context.
        const screened = normalizeGoal(reply.text);
        if (!screened.ok) return remember(reply.idempotencyKey, { outcome: "invalid", message: `Not accepted: ${screened.reason}. Nothing was changed.` });
        const routed = await routeMessage(reply.idempotencyKey, screened.goal, notice?.taskId ?? null, false);
        return (
          routed ?? {
            outcome: "info",
            message: "The Agent planner is unavailable right now, so I cannot interpret free text. Nothing was changed. Use /goal <goal>, /tasks, /status <task>, or reply directly to an escalation message.",
          }
        );
      }
      const normalized = normalizeGuidance(reply.text);
      if (!normalized.ok) return remember(reply.idempotencyKey, { outcome: "invalid", message: `Not accepted: ${normalized.reason}. Nothing was changed.` });
      if (notice.kind !== "human_decision")
        return remember(reply.idempotencyKey, {
          outcome: "invalid",
          message: notice.kind === "commit_publish_approval" ? "Commit/publish approvals are decided with the buttons only. Nothing was changed." : "That message does not accept guidance. Nothing was changed.",
        });
      try {
        const open = await openEscalation(notice.taskId);
        if (!open || open.escalationId !== notice.targetId)
          return remember(reply.idempotencyKey, { outcome: "stale", message: "That escalation is no longer open. Nothing was changed." });
        const result = await deps.gateway.submitHumanDecision(call({ escalationId: open.escalationId, idempotencyKey: reply.idempotencyKey, guidance: normalized.guidance }));
        if (result.taskId !== notice.taskId) return { outcome: "failed", message: "The control plane could not process this request." };
        if (result.duplicate) return remember(reply.idempotencyKey, { outcome: "duplicate", message: "Already submitted. Nothing was changed." });
        return remember(reply.idempotencyKey, {
          outcome: "resumed",
          taskId: notice.taskId,
          message: `Guidance received for ${notice.taskId} (${open.escalationId}). The Manager re-validates the task state; I will report whether it resumed. ${NOT_APPROVAL}`,
        });
      } catch (error) {
        return remember(reply.idempotencyKey, gatewayOutcome(error));
      }
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
          return remember(request.idempotencyKey, { outcome: "invalid", message: "Reply /cancel to a task message, or use /cancel <task>. Nothing was changed." });
        taskId = notice.taskId;
      }
      try {
        const s = await status(taskId);
        if (TERMINAL.has(s.status)) return remember(request.idempotencyKey, { outcome: "stale", message: `Task ${taskId} is already finished. Nothing was changed.` });
      } catch (error) {
        return remember(request.idempotencyKey, gatewayOutcome(error));
      }
      const noticeId = `cancel:${taskId}:${request.idempotencyKey}`;
      const confirmation: CancelConfirmationNotice = {
        kind: "cancel_confirmation",
        noticeId,
        ref: noticeRef(noticeId),
        taskId,
        taskLabel: taskLabel(taskId, labels().get(taskId)),
        expiresAt: new Date(Date.parse(deps.now()) + cancelMs).toISOString(),
      };
      const sent = await notify(confirmation, taskId);
      if (!sent) return { outcome: "failed", message: "Could not send the cancel confirmation. Nothing was changed." };
      return remember(request.idempotencyKey, { outcome: "confirm_requested", taskId, message: "" });
    },

    async handleAction(action) {
      const dup = duplicateOf(action.idempotencyKey);
      if (dup) return dup;
      const notice = deps.ledger.byRef(action.ref);
      if (!notice) return remember(action.idempotencyKey, { outcome: "stale", message: "This button is no longer valid. Nothing was changed." });
      try {
        if (action.action === "cancel_request") return service.requestCancel({ kind: "cancel_request", idempotencyKey: action.idempotencyKey, target: { noticeRef: action.ref } });
        if (action.action === "cancel_keep" || action.action === "cancel_confirm") {
          if (notice.kind !== "cancel_confirmation") return remember(action.idempotencyKey, { outcome: "invalid", message: "Nothing to confirm. Nothing was changed." });
          if (action.action === "cancel_keep") return remember(action.idempotencyKey, { outcome: "kept", message: `Task ${notice.taskId} keeps running.` });
          if (deps.ledger.handled(`cancel-used:${notice.ref}`)) return { outcome: "duplicate", message: "This confirmation was already used. Nothing was changed." };
          const age = Date.parse(deps.now()) - Date.parse(notice.createdAt);
          if (!Number.isFinite(age) || age < 0 || age > cancelMs)
            return remember(action.idempotencyKey, { outcome: "stale", message: "This confirmation expired. Send /cancel again if you still want to cancel. Nothing was changed." });
          const s = await status(notice.taskId);
          if (TERMINAL.has(s.status)) return remember(action.idempotencyKey, { outcome: "stale", message: `Task ${notice.taskId} is already finished. Nothing was changed.` });
          await deps.gateway.cancelTask(call({ taskId: notice.taskId, idempotencyKey: `hi.cancel.${notice.ref}` }));
          deps.ledger.recordHandled({ idempotencyKey: `cancel-used:${notice.ref}`, outcome: "cancelled" });
          markInline(notice.taskId, "terminal");
          return remember(action.idempotencyKey, {
            outcome: "cancelled",
            taskId: notice.taskId,
            message: `Task ${notice.taskId} was cancelled through the Gateway. No commit, push, or PR was made by this action.`,
          });
        }
        if (notice.kind !== "commit_publish_approval" && notice.kind !== "start_approval")
          return remember(action.idempotencyKey, { outcome: "invalid", message: "Only approval messages can be approved or rejected. Nothing was changed." });
        const current = await currentApproval(notice.taskId);
        // The button only names a notice; the exact binding is re-read from the Manager through the Gateway,
        // and the notice kind must still match the approval kind (a start approval can never become commit/publish).
        const expected = notice.kind === "commit_publish_approval" ? { kind: "commit_publish", phase: "commit_publish" } : { kind: "start", phase: "pre_execution" };
        if (!current || current.approvalRequestId !== notice.targetId || current.kind !== expected.kind || current.phase !== expected.phase)
          return remember(action.idempotencyKey, { outcome: "stale", message: "This approval request is no longer current. Nothing was changed." });
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
        if (result.duplicate) return remember(action.idempotencyKey, { outcome: "duplicate", message: "Already decided. Nothing was changed." });
        const outcome: InboundOutcome = decision === "approved" ? "approved" : "rejected";
        const start = current.kind === "start";
        return remember(action.idempotencyKey, {
          outcome,
          taskId: current.taskId,
          message: start
            ? decision === "approved"
              ? `Approved this exact execution for ${current.taskId}. The Worker may now run this contract only. Commit/publish is a separate later approval; merge and deploy are NOT approved.`
              : `Rejected the execution of ${current.taskId}. The Worker will not run this contract.`
            : decision === "approved"
              ? `Approved commit + publish for ${current.taskId}: commit, normal push, open/reuse PR. Merge and deploy are NOT approved.`
              : `Rejected commit + publish for ${current.taskId}. Nothing will be committed or pushed for this request.`,
        });
      } catch (error) {
        return remember(action.idempotencyKey, gatewayOutcome(error));
      }
    },

    async listTasks() {
      const names = labels();
      const lines: string[] = [];
      for (const taskId of deps.directory.activeTaskIds()) {
        try {
          const s = await status(taskId);
          lines.push(`• ${taskLabel(taskId, names.get(taskId))}\n  ${phaseOf(s)} · risk ${s.risk}`);
        } catch {
          lines.push(`• ${taskId}\n  status unavailable`);
        }
      }
      const finished = deps.directory.allTaskIds().length - lines.length;
      return {
        outcome: "info",
        message: lines.length ? `Active tasks (${lines.length}):\n${lines.join("\n")}${finished > 0 ? `\n(${finished} finished)` : ""}` : `No active tasks.${finished > 0 ? ` (${finished} finished)` : ""}`,
      };
    },

    async taskStatus(reference) {
      const resolved = resolveTask(reference, deps.directory.allTaskIds());
      if (!resolved.ok) return resolved.result;
      try {
        const s = await status(resolved.taskId);
        const label = labels().get(resolved.taskId);
        const lines = [
          `Task: ${resolved.taskId}`,
          ...(label ? [`Goal: ${oneLine(label, 60)}`] : []),
          `Phase: ${phaseOf(s)}`,
          `Manager status: ${s.status}`,
          `Worker: ${s.assignedWorker ?? "not assigned"}`,
          `Risk: ${s.risk} · Priority: ${s.priority}`,
          `Repair attempts: ${s.repairAttempt}`,
          ...(s.prNumber ? [`PR: #${s.prNumber}${s.qaState ? ` (CI ${safeDetail(s.qaState, 30)})` : ""}`] : []),
          ...(s.waitReason ? [`Note: ${safeDetail(s.waitReason)}`] : []),
          `Updated: ${s.updatedAt}`,
        ];
        return { outcome: "info", taskId: resolved.taskId, message: lines.join("\n") };
      } catch (error) {
        return gatewayOutcome(error);
      }
    },
  };
  return service;
}
