/**
 * Live Task Observatory — pure, deterministic, read-only.
 *
 * Turns the trusted (already sanitized) Gateway status of one task into ONE canonical live snapshot the
 * GPT Manager reasons over when the Owner asks about the CURRENT state ("現在進度到哪？", "有卡住嗎？",
 * "Claude 還在跑嗎？", "為什麼還沒部署？"). The Manager may explain it, never fabricate it.
 *
 * Precedence (highest first) — a lower source never overrides a higher one:
 *   1. terminal task state (completed / cancelled / closed_without_deploy / failed)
 *   2. trusted delivery record (merge, Render deployment, production verification)
 *   3. in-process Worker truth (a run THIS runtime started and has not seen finish)
 *   4. Owner gates (approval phase, open decision)
 *   5. scheduler status / pending side effect
 *   6. persisted flags and earlier summaries (PR-opened flag, Manager result text, persisted
 *      worker-running flag) — reported as ignored when a higher source contradicts them.
 *
 * Nothing here is guessed: unknown data is null. "Stuck" is only a terminal failure; a running Worker
 * is "possibly stalled" only past its configured hard time limit (real timing evidence).
 * No I/O, no mutation, no secrets: input is the Gateway's sanitized view.
 */
import { createHash } from "node:crypto";
import { terminalClass } from "../gateway/retry";
import type { GatewayTaskStatus } from "../gateway/types";

export const LIVE_STATUS_KINDS = [
  "worker_running",
  "queued_for_worker",
  "manager_reviewing",
  "waiting_owner_approval",
  "waiting_preview_review",
  "waiting_owner_decision",
  "publishing",
  "waiting_ci",
  "waiting_deploy_approval",
  "merging",
  "waiting_render",
  "render_deploying",
  "production_verifying",
  "completion_pending",
  "waiting_worker_availability",
  "blocked_infrastructure",
  "paused",
  "idle",
  "failed",
  "deployment_failed",
  "completed",
  "cancelled",
  "closed_without_deploy",
] as const;
export type LiveStatusKind = (typeof LIVE_STATUS_KINDS)[number];

export type WaitingForKind = "worker" | "queue" | "manager" | "owner" | "github" | "ci" | "render" | "production_check" | "worker_availability" | "infrastructure";

export interface LiveTaskSnapshot {
  taskId: string;
  lineage: { id: string | null; bindingMatches: boolean | null };
  branch: string | null;
  headSha: string | null;
  queueReason: string | null;
  blockingReason: string | null;
  pendingSideEffect: string | null;
  pendingSideEffectId: string | null;
  failureClassification: string | null;
  kind: LiveStatusKind;
  lifecycle: string | null;
  orchestrationStatus: string;
  terminal: boolean;
  worker: {
    kind: string | null;
    running: boolean;
    runId: string | null;
    startedAt: string | null;
    runningForMs: number | null;
    /** Latest structured orchestration event seen by THIS runtime (null after a restart until one occurs). */
    latestEvent: { event: string; at: string } | null;
  };
  waitingFor: WaitingForKind | null;
  ownerActionNeeded: boolean;
  /** Terminal failure: nothing will progress by itself. */
  stuck: boolean;
  stall: { suspected: boolean; evidence: string | null };
  approval: { required: boolean; phase: string | null; state: "awaiting_owner" | "deploy_approved" | "not_pending" };
  preview: { status: string } | null;
  pr: { number: number; state: string | null } | null;
  ci: { status: string; total: number; passed: number; pending: number; failed: number } | null;
  delivery: {
    stage: string;
    deployApprovedAt: string | null;
    merged: boolean;
    mergedAt: string | null;
    mergeSha: string | null;
    deployCommitSha: string | null;
    deployId: string | null;
    deployStatus: string | null;
    observerMissing: boolean;
  } | null;
  production: { verified: boolean; verifiedAt: string | null; health: boolean | null; smoke: boolean | null } | null;
  blocker: { reason: string } | null;
  nextExpectedStep: string;
  reconciliation: {
    /** Which source decided `kind`. */
    authoritative: string;
    /** Lower-precedence observations contradicted by the authoritative state (ignored). */
    ignored: string[];
    /** Records that disagree in a way the precedence does not explain (surfaced, never guessed away). */
    inconsistencies: string[];
    /** Another task owns the PR this task's title refers to (e.g. a cancelled "deploy PR #26" task). */
    relatedPr: { prNumber: number; ownerTaskId: string; ownerKind: LiveStatusKind; ownerKey?: string } | null;
  };
  observedAt: string;
}

/** Grace past the Worker's hard time limit before a run is called "possibly stalled" (its adapter should have stopped it). */
export const STALL_GRACE_MS = 120_000;

const TERMINAL: readonly LiveStatusKind[] = ["failed", "deployment_failed", "completed", "cancelled", "closed_without_deploy"];
const OWNER_GATES: readonly LiveStatusKind[] = ["waiting_owner_approval", "waiting_preview_review", "waiting_owner_decision", "waiting_deploy_approval"];
const QUEUED_STATUSES = ["intake_queued", "queued", "waiting_runtime", "runtime_starting", "runtime_available", "waiting_dependency", "waiting_workspace", "waiting_branch_conflict"];
const RENDER_IN_PROGRESS = ["created", "queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"];

interface Classified {
  kind: LiveStatusKind;
  authoritative: string;
  waitingFor: WaitingForKind | null;
}

function classify(s: GatewayTaskStatus): Classified {
  const e = s.execution ?? null;
  const d = s.delivery ?? null;
  const st = s.taskState;
  const c = (kind: LiveStatusKind, authoritative: string, waitingFor: WaitingForKind | null = null): Classified => ({ kind, authoritative, waitingFor });
  // 1. Terminal task state.
  if (st === "cancelled" || s.status === "cancelled") return c("cancelled", "terminal task state");
  if (st === "closed_without_deploy") return c("closed_without_deploy", "terminal task state");
  if (st === "complete") return c("completed", d?.stage === "production_verified" ? "terminal task state + delivery record" : "terminal task state");
  if (d?.stage === "deployment_failed") return c("deployment_failed", "delivery record");
  if (st === "failed" || s.status === "blocked") return c("failed", "terminal task state");
  // 2. A progressed delivery record outranks an earlier approval/scheduler observation.
  if (d?.stage === "production_verified") return c("completion_pending", "delivery record (verification complete; lifecycle not complete)", "manager");
  if (d && (s.status === "deploying" || d.stage === "merging" || d.stage === "deploying" || d.stage === "production_verifying")) {
    if (d.stage === "merging" || e?.pendingSideEffect === "merge") return c("merging", "delivery record", "github");
    if (d.observerMissing) return c("blocked_infrastructure", "delivery record (deployment observer not configured)", "infrastructure");
    if (d.stage === "production_verifying" || (d.deployStatus === "live" && !(e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha))) return c("production_verifying", "delivery record", "production_check");
    if (d.deployStatus && RENDER_IN_PROGRESS.includes(d.deployStatus) && !(e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha)) return c("render_deploying", "delivery record (Render observation)", "render");
    return c("waiting_render", "delivery record", "render");
  }
  // 3. A Worker process this runtime owns.
  if (e?.workerRunning) return c("worker_running", "live Worker process", "worker");
  // 4. Owner gates.
  if (s.status === "needs_human_approval") {
    const phase = e?.approvalPhase ?? s.details?.approvalPhase ?? null;
    if (phase === "deploy" || s.lifecyclePhase === "awaiting_deploy_approval") return c("waiting_deploy_approval", "approval gate", "owner");
    if (s.lifecyclePhase === "preview_ready") return c("waiting_preview_review", "approval gate", "owner");
    return c("waiting_owner_approval", "approval gate", "owner");
  }
  if (s.status === "needs_human_decision") return c("waiting_owner_decision", "open Owner decision", "owner");
  // 5. Scheduler status / side effects.
  if (e?.pendingSideEffect === "commit" || e?.pendingSideEffect === "push" || e?.pendingSideEffect === "pr" || s.lifecyclePhase === "publishing") return c("publishing", "pending side effect", "github");
  if (s.status === "qa_pending") return c("waiting_ci", "scheduler status", "ci");
  if (s.status === "waiting_worker_quota" || s.status === "waiting_worker_availability") return c("waiting_worker_availability", "scheduler status", "worker_availability");
  if (s.status === "waiting_infrastructure") return c("blocked_infrastructure", "scheduler status", "infrastructure");
  if (s.status === "paused" || e?.paused) return c("paused", "scheduler status", "owner");
  if (e?.managerReviewPending || s.status === "waiting_group") return c("manager_reviewing", "scheduler status", "manager");
  if (QUEUED_STATUSES.includes(s.status)) return c("queued_for_worker", "scheduler status", "queue");
  // running / repair_requested without a live Worker: the run finished and the Manager is validating it.
  if (s.status === "running" || s.status === "repair_requested") return c("manager_reviewing", "scheduler status (no live Worker process)", "manager");
  return c("idle", "scheduler status");
}

const NEXT_STEP: Record<LiveStatusKind, string> = {
  worker_running: "the Worker finishes its run; the Manager then validates and reviews the result",
  queued_for_worker: "a Worker starts when the scheduler dispatches the task",
  manager_reviewing: "the Manager finishes validating/reviewing the latest run, then asks for publish approval or starts a repair",
  waiting_owner_approval: "nothing runs until the Owner approves or rejects",
  waiting_preview_review: "after the Owner's publish approval: commit, push and open the PR, then CI",
  waiting_owner_decision: "the Owner's direction resumes the work",
  publishing: "the PR is opened, then CI runs on it",
  waiting_ci: "when CI passes, the Owner is asked to approve the production deploy",
  waiting_deploy_approval: "after the Owner's deploy approval: trusted merge of the approved head, then wait for the Render deployment of the merge commit, then production health check + smoke test, then completed",
  merging: "the merge result is recorded, then the Render deployment of the merge commit is observed",
  waiting_render: "Render picks up and builds the merge commit, then production verification",
  render_deploying: "the Render deployment goes live, then production health check + smoke test",
  completion_pending: "reconcile the verified delivery record with the task lifecycle and record completion",
  production_verifying: "production health check + smoke test pass, then the task is completed",
  waiting_worker_availability: "the task resumes from the same point when an eligible Worker is available again",
  blocked_infrastructure: "the task resumes automatically when the service recovers (bounded retries); nothing was published by this wait",
  paused: "nothing runs until the Owner resumes the task",
  idle: "nothing is scheduled",
  failed: "nothing runs; the Owner may ask for a re-run (a new task)",
  deployment_failed: "nothing runs; the deployment failure needs the Owner's attention",
  completed: "nothing further; the task is finished",
  cancelled: "nothing further; the task was cancelled",
  closed_without_deploy: "nothing further; closed without deployment",
};

/** Titles that name a PR ("PR #26", "pr 26"): deterministic cross-reference only. */
export function prReferences(text: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const m of Array.from((text ?? "").matchAll(/\bPR\s*#?\s*(\d{1,6})\b/gi))) out.add(Number(m[1]));
  return Array.from(out);
}

export interface LiveSnapshotContext {
  now: string;
  /** Task title (sanitized), for PR cross-references. */
  title?: string | null;
  /** Other known tasks owning a PR (taskId, prNumber, their live kind). */
  prOwners?: readonly { taskId: string; prNumber: number; kind: LiveStatusKind; liveKey?: string }[];
}

export function buildLiveTaskSnapshot(s: GatewayTaskStatus, ctx: LiveSnapshotContext): LiveTaskSnapshot {
  const e = s.execution ?? null;
  const d = s.delivery ?? null;
  const { kind, authoritative, waitingFor } = classify(s);
  const terminal = TERMINAL.includes(kind);
  const now = Date.parse(ctx.now);
  const started = e?.workerRunning && e.workerStartedAt ? Date.parse(e.workerStartedAt) : NaN;
  const runningForMs = Number.isFinite(started) && Number.isFinite(now) ? Math.max(0, now - started) : null;
  const limit = e?.workerTimeoutMs ?? null;
  const suspected = kind === "worker_running" && runningForMs !== null && limit !== null && runningForMs > limit + STALL_GRACE_MS;

  const ignored: string[] = [];
  const inconsistencies: string[] = [];
  if (s.approvalRequired && !OWNER_GATES.includes(kind)) ignored.push("historical pending approval: no current approval gate at the authoritative stage");
  if (e?.staleRunRecord) ignored.push("persisted worker-running flag: no Worker process of this runtime is running (the run ended with a previous runtime)");
  if ((e?.mergedAt || e?.mergeSha) && s.prState === "open") ignored.push("PR-open flag: superseded by the recorded merge");
  if (d && s.resultSummary) ignored.push("earlier Manager result summary: written at implementation acceptance, before the delivery facts above");
  if (d?.stage === "production_verified" && s.taskState !== "complete") inconsistencies.push("delivery record says production verified but the task is not complete");
  if (d && ["merging", "deploying", "production_verifying"].includes(d.stage) && s.status !== "deploying") inconsistencies.push("progressed delivery record supersedes an earlier orchestration status");
  if (e?.deliveryBindingMatches === false) inconsistencies.push("delivery binding does not match the current task lineage/PR/head/CI evidence");
  if (e?.ciHeadSha && s.headSha && e.ciHeadSha !== s.headSha) inconsistencies.push("CI observation belongs to a different head SHA; ignored");
  if (e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha) inconsistencies.push("Render observation belongs to a different merge SHA; ignored");
  if (terminal && e?.workerRunning) inconsistencies.push("terminal task still has an outstanding Worker handle");
  if (terminal && e?.pendingSideEffect) inconsistencies.push(`task stopped with an indeterminate ${e.pendingSideEffect} side effect recorded`);
  if (kind === "completed" && s.deliveryTarget === "production" && s.mode === "change" && d?.stage !== "production_verified" && s.prNumber !== null)
    inconsistencies.push("task is complete but no verified production deployment is recorded (legacy PR-terminal completion)");

  let relatedPr: LiveTaskSnapshot["reconciliation"]["relatedPr"] = null;
  for (const n of prReferences(ctx.title)) {
    if (n === s.prNumber) continue;
    const candidates = (ctx.prOwners ?? []).filter((o) => o.prNumber === n && o.taskId !== s.taskId);
    const rank = (o: typeof candidates[number]) => !TERMINAL.includes(o.kind) ? 0 : o.kind === "completed" ? 1 : 2;
    const owners = [...candidates].sort((a, b) => rank(a) - rank(b) || a.taskId.localeCompare(b.taskId));
    const owner = owners[0];
    if (owners.length > 1 && rank(owners[0]) === rank(owners[1])) inconsistencies.push(`multiple equally authoritative tasks claim PR #${n}; ownership requires reconciliation`);
    if (owner && !(owners.length > 1 && rank(owners[0]) === rank(owners[1]))) {
      relatedPr = { prNumber: n, ownerTaskId: owner.taskId, ownerKind: owner.kind, ...(owner.liveKey ? { ownerKey: owner.liveKey } : {}) };
      ignored.push(`this task does not own PR #${n}; PR #${n}'s authoritative state is task ${owner.taskId} (${owner.kind})`);
      break;
    }
  }

  const blockerReason = kind === "failed" || kind === "deployment_failed" || kind === "blocked_infrastructure" ? (d?.failure?.reason ?? e?.blockingReason ?? s.waitReason ?? null) : null;
  return {
    taskId: s.taskId,
    lineage: { id: e?.lineageId ?? null, bindingMatches: e?.deliveryBindingMatches ?? null },
    branch: s.branch,
    headSha: s.headSha,
    queueReason: e?.queueReason ?? null,
    blockingReason: e?.blockingReason ?? null,
    pendingSideEffect: e?.pendingSideEffect ?? null,
    pendingSideEffectId: e?.pendingSideEffectId ?? null,
    failureClassification: d?.failure?.code ?? (terminal ? terminalClass(s.waitReason) : null),
    kind,
    lifecycle: s.lifecyclePhase ?? null,
    orchestrationStatus: s.status,
    terminal,
    worker: {
      kind: s.assignedWorker,
      running: e?.workerRunning === true,
      runId: e?.workerRunning ? e.runId : null,
      startedAt: e?.workerRunning ? e.workerStartedAt : null,
      runningForMs: kind === "worker_running" ? runningForMs : null,
      latestEvent: e?.latestEvent ?? null,
    },
    waitingFor: terminal ? null : waitingFor,
    ownerActionNeeded: OWNER_GATES.includes(kind) || kind === "paused",
    stuck: kind === "failed" || kind === "deployment_failed",
    stall: suspected
      ? { suspected: true, evidence: `running ${Math.round(runningForMs! / 60_000)} min, past the configured ${Math.round(limit! / 60_000)} min Worker time limit` }
      : { suspected: false, evidence: null },
    approval: {
      required: OWNER_GATES.includes(kind) && s.approvalRequired,
      phase: OWNER_GATES.includes(kind) ? e?.approvalPhase ?? s.details?.approvalPhase ?? null : null,
      state: OWNER_GATES.includes(kind) && s.approvalRequired ? "awaiting_owner" : e?.deployApprovedAt ? "deploy_approved" : "not_pending",
    },
    preview: s.preview ? { status: s.preview.status } : null,
    pr: s.prNumber !== null ? { number: s.prNumber, state: e?.mergedAt || e?.mergeSha ? "merged" : s.prState } : null,
    ci: e?.ciHeadSha && s.headSha && e.ciHeadSha !== s.headSha ? null : e?.ci ?? (s.qaState ? { status: s.qaState, total: 0, passed: 0, pending: 0, failed: 0 } : null),
    delivery: d
      ? {
          stage: d.stage,
          deployApprovedAt: e?.deployApprovedAt ?? null,
          merged: Boolean(e?.mergedAt || e?.mergeSha),
          mergedAt: e?.mergedAt ?? null,
          mergeSha: e?.mergeSha ?? null,
          deployCommitSha: e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha ? null : e?.deployCommitSha ?? null,
          deployId: e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha ? null : e?.deployId ?? null,
          deployStatus: e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha ? null : d.deployStatus,
          observerMissing: d.observerMissing,
        }
      : null,
    production: d
      ? { verified: d.stage === "production_verified" && e?.deliveryBindingMatches !== false && !(e?.deployCommitSha && e.mergeSha && e.deployCommitSha !== e.mergeSha), verifiedAt: d.verifiedAt, health: d.health ? d.health.ok : null, smoke: d.smoke ? d.smoke.ok : null }
      : null,
    blocker: blockerReason ? { reason: blockerReason } : null,
    nextExpectedStep: e?.deliveryBindingMatches === false && !terminal ? "reconcile trusted task/lineage/PR/head/CI evidence before any delivery transition" : NEXT_STEP[kind],
    reconciliation: { authoritative, ignored, inconsistencies, relatedPr },
    observedAt: ctx.now,
  };
}

/**
 * Stable key of the live state a Manager reply was grounded in. A reply is only used while the key is
 * unchanged: fresher live state always wins over an answer composed from an older view.
 */
export function liveStateKey(s: GatewayTaskStatus, now?: string): string {
  // Hash every trusted fact used by the prompt, including run identity and lineage. Clock-only
  // changes do not invalidate an answer; no full snapshot is saved in the reply basis.
  const { createdAt: _created, updatedAt: _updated, ...facts } = s;
  const e = s.execution;
  const stalled = Boolean(now && e?.workerRunning && e.workerStartedAt && e.workerTimeoutMs && Date.parse(now) - Date.parse(e.workerStartedAt) > e.workerTimeoutMs + STALL_GRACE_MS);
  return createHash("sha256").update(JSON.stringify({ facts, stalled })).digest("hex");
}

const mins = (ms: number) => ms < 60_000 ? "<1 min" : `${Math.floor(ms / 60_000)} min`;

/** One compact, bounded line block for the Manager's prompt (facts only, no free text beyond sanitized reasons). */
export function renderLiveSnapshot(l: LiveTaskSnapshot): string {
  const w = l.worker;
  const parts = [
    `LIVE(observedAt ${l.observedAt}): state=${l.kind}${l.terminal ? " (terminal)" : ""}; lifecycle=${l.lifecycle ?? "unknown"}`,
    w.running ? `worker ${w.kind ?? "unknown"} RUNNING for ${w.runningForMs !== null ? mins(w.runningForMs) : "unknown time"} (run ${w.runId ?? "unknown"})` : `no Worker running`,
    w.latestEvent ? `latest event ${w.latestEvent.event} at ${w.latestEvent.at}` : "",
    l.waitingFor ? `waitingFor=${l.waitingFor}` : "",
    `ownerActionNeeded=${l.ownerActionNeeded}`,
    `stuck=${l.stuck}`,
    l.stall.suspected ? `POSSIBLY STALLED: ${l.stall.evidence}` : "",
    l.approval.required ? `approval pending (${l.approval.phase ?? "unknown phase"})` : "",
    l.preview ? `preview=${l.preview.status}` : "",
    l.pr ? `PR #${l.pr.number} ${l.pr.state ?? "unknown"}` : "",
    l.ci ? `CI ${l.ci.status}${l.ci.total ? ` (${l.ci.passed}/${l.ci.total} passed, ${l.ci.pending} pending, ${l.ci.failed} failed)` : ""}` : "",
    l.delivery
      ? `delivery stage=${l.delivery.stage}${l.delivery.deployApprovedAt ? `, deploy approved ${l.delivery.deployApprovedAt}` : ""}${l.delivery.merged ? `, merged${l.delivery.mergedAt ? ` ${l.delivery.mergedAt}` : ""}` : ", not merged"}${l.delivery.deployId ? `, Render deployment ${l.delivery.deployId} ${l.delivery.deployStatus ?? "unknown"}` : ", no Render deployment observed"}${l.delivery.observerMissing ? ", deployment observer NOT configured" : ""}`
      : "",
    l.production ? `production ${l.production.verified ? `verified ${l.production.verifiedAt ?? ""}`.trim() : "not verified"}` : "",
    l.blocker ? `blocker: ${l.blocker.reason}` : "",
    l.queueReason ? `queue: ${l.queueReason}` : "",
    l.pendingSideEffect ? `pending trusted action=${l.pendingSideEffect}` : "",
    l.lineage.id ? `current lineage=${l.lineage.id}${l.lineage.bindingMatches !== null ? `, delivery binding matches=${l.lineage.bindingMatches}` : ""}` : "",
    l.branch ? `branch=${l.branch}` : "",
    l.headSha ? `head SHA=${l.headSha}` : "",
    l.delivery?.mergeSha ? `merge SHA=${l.delivery.mergeSha}` : "",
    l.delivery?.deployCommitSha ? `Render SHA=${l.delivery.deployCommitSha}` : "",
    l.failureClassification ? `safe failure classification=${l.failureClassification}` : "",
    `next: ${l.nextExpectedStep}`,
    `authoritative: ${l.reconciliation.authoritative}`,
    l.reconciliation.ignored.length ? `ignored (stale/superseded): ${l.reconciliation.ignored.join(" | ")}` : "",
    l.reconciliation.inconsistencies.length ? `INCONSISTENCY: ${l.reconciliation.inconsistencies.join(" | ")}` : "",
  ];
  return parts.filter(Boolean).join("; ");
}
