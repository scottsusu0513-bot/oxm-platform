import { planBranch } from "../branches/planner";
import { BASE_BRANCH, type ActiveWork, type AssignedBranchPlan } from "../branches/types";
import { isValidBranchTaskId } from "../branches/naming";
import { normalizePathSet } from "../branches/overlap";
import { assertTransition, isTerminalState, type ApprovalPhase, type TransitionContext } from "../domain/taskState";
import { TASK_CATEGORIES, checkMutability, type RiskLevel, type TaskMode, type TaskState, type WorkerKind } from "../domain/types";
import { DEFAULT_POLL_POLICY, nextPollStep } from "../github/qa";
import type { QaDecision } from "../github/types";
import { assignWorkerBranch, pushInputFromWorkerResult } from "../githubWrite/flow";
import type { WorkspaceLease } from "../githubWrite/lease";
import type { PushReceipt, TrustedPullRequest } from "../githubWrite/types";
import { DEFAULT_MAX_REPAIR_ATTEMPTS, managerBudget } from "../manager/budget";
import { managerStep, type ManagerStep } from "../manager/lifecycle";
import { buildHumanEscalationReport, failureFingerprint, primaryFailureCode, repairOutcomeSummary } from "../manager/diagnosis";
import { checkHumanDecisionBinding, humanDecisionResumeStep, normalizeHumanDecision } from "../manager/humanDecision";
import { advanceRepairCounters, repairWorkerContract } from "../manager/repair";
import { gateTransition } from "../manager/sequencing";
import type { ApprovalEvidenceState, HumanDecisionRequest, HumanEscalationReport, ManagerValidation, RepairCounters, RepairCycleRecord, RepairRequest } from "../manager/types";
import { REPAIRABLE_STATES, TRANSIENT_WORKER_ERRORS, validateEvidence } from "../manager/validator";
import type { WorkerResult, WorkerTaskContract } from "../workers/types";
import { WORKER_INTERACTIVE_PROMPTS_ALLOWED } from "../workers/permissions";
import { COMMIT_PUBLISH_ACTION, commitApprovalBinding, normalizeCommitApprovalEvidence, redStartBindingId, type CommitApprovalEvidence } from "../workers/prompt";
import type { Approval, IsoTimestamp } from "../store/types";
import { findDependencyCycle } from "./dependencies";
import { buildManagerEvidence } from "./evidence";
import { orchestrationAudit, type OrchestrationAuditEvent } from "./events";
import { assessPriority } from "./priority";
import { decideSchedule } from "./scheduler";
import {
  CAPABILITIES,
  TERMINAL_ORCHESTRATION_STATUSES,
  type BranchPlanState,
  type ApprovalCheck,
  type Capability,
  type EscalationAction,
  type EscalationRecord,
  type HumanDecisionLogEntry,
  type OrchestrationEvent,
  type OrchestrationPolicy,
  type OrchestrationPorts,
  type OrchestrationStatus,
  type PriorityAssessment,
  type PersistedTaskRecord,
  type ScheduleDecision,
  type SchedulerTaskView,
  type StartApprovalEvidence,
  type TaskIntake,
  type TaskSnapshot,
  type TrustedRunRecord,
} from "./types";

/**
 * Deterministic Manager Loop. Orchestration logic, not an LLM agent.
 *
 * Event-driven: the loop advances only when an event is posted (task
 * created, scheduler tick, worker finished, branch pushed, PR opened, QA
 * updated, approval decided, dependency/workspace freed). There is no
 * timer, sleep, or polling loop: QA re-polls are suggested via
 * `nextQaPollDelayMs` and requested by an external timer posting
 * `qa_updated`. Events are processed one at a time, in order.
 *
 * Per task:
 *   intake (classification/routing already done) -> scheduler decision ->
 *   branch plan -> lease -> create branch -> prepare workspace -> worker ->
 *   trusted run record -> evidence -> Manager validation ->
 *     transient runtime failure: bounded same-contract retry (no repair cycle)
 *     needs_repair: Manager root-cause diagnosis -> repair instruction ->
 *       same task / branch / worker repairs -> revalidation (max 2 cycles,
 *       cycle 2 diagnoses fresh evidence against diagnosis #1)
 *     needs_human_decision: both cycles failed -> escalation report, paused
 *       (lease kept) -> bound human decision -> Manager consumes it as
 *       evidence -> fresh diagnosis (next round) -> same task/branch/worker
 *       repairs -> revalidation; or cancel
 *     accepted (no PR): commit/publish approval -> trusted commit -> safe push -> open PR -> QA
 *     QA final: validation -> qa_passed -> complete | human approval
 *     blocked: stop (failed) or replan marker
 *
 * Boundaries: the loop never reads source code, never runs a shell, never
 * calls an LLM, and has no merge/deploy/approve/close/force-push path. It
 * only reaches GitHub, git, workers, QA and the audit log through the
 * injected ports, and only with planner-approved plans and held leases.
 */

export const DEFAULT_ORCHESTRATION_POLICY: OrchestrationPolicy = Object.freeze({
  maxConcurrentTasks: 2,
  maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
  maxInfrastructureRetries: 2,
  maxHumanResumes: 3,
  maxReviewRetries: 5,
  maxReplans: 1,
  executableWorkers: Object.freeze(["claude", "codex"]) as readonly WorkerKind[],
  prDraft: false,
  qaPoll: DEFAULT_POLL_POLICY,
  deepReviewEnabled: false as const,
  llmCallBudget: null,
});

const EXECUTABLE_THIS_PHASE: readonly WorkerKind[] = ["claude", "codex"];

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

export const APPROVAL_ACTIONS = {
  pre_execution: "start",
  commit_publish: COMMIT_PUBLISH_ACTION,
  post_qa: "complete_post_qa",
} as const;

interface TaskRecord {
  intake: TaskIntake;
  seq: number;
  lineageId: string;
  priority: PriorityAssessment;
  risk: RiskLevel;
  worker: WorkerKind | null;
  state: TaskState;
  status: OrchestrationStatus;
  branchPlanState: BranchPlanState;
  plan: AssignedBranchPlan | null;
  lease: WorkspaceLease | null;
  baseContract: WorkerTaskContract | null;
  contract: WorkerTaskContract | null;
  runId: string | null;
  runCount: number;
  workerRunning: boolean;
  workerExecutions: number;
  maxRepairAttempts: number;
  lastResult: WorkerResult | null;
  record: TrustedRunRecord | null;
  repair: RepairCounters;
  repairCycles: RepairCycleRecord[];
  infraRetries: number;
  humanEscalation: HumanEscalationReport | null;
  humanRound: number;
  humanDecisionRequest: HumanDecisionRequest | null;
  /** Evidence phase the escalation was judged in; a resume re-judges the same phase. */
  escalationPhase: "pre_push" | "post_qa" | null;
  humanDecisionLog: HumanDecisionLogEntry[];
  consumedHumanDecisionIds: string[];
  escalationHistory: HumanEscalationReport[];
  /** A red-risk repair waiting for its own fresh pre-execution approval. */
  pendingRepair: { request: RepairRequest; contract: WorkerTaskContract } | null;
  /** A red-risk transient retry whose changed contract waits for a fresh pre-execution approval. */
  pendingRetry: { contract: WorkerTaskContract; errorType: string } | null;
  replans: number;
  receipt: PushReceipt | null;
  pr: TrustedPullRequest | null;
  qa: QaDecision | null;
  qaPolls: number;
  nextQaPollDelayMs: number | null;
  approval: Record<ApprovalPhase, ApprovalEvidenceState>;
  approvalPhase: ApprovalPhase | null;
  queueReason: string | null;
  blockingReason: string | null;
  escalations: EscalationRecord[];
  capabilities: Set<Capability>;
  pendingSideEffect: "worker" | "commit" | "push" | "pr" | null;
  pendingSideEffectId: string | null;
  trustedApproval: Approval | null;
  approvalRequestedAt: IsoTimestamp | null;
  commitApprovalEvidence: CommitApprovalEvidence | null;
  paused: boolean;
  /** Finished run waiting for the Manager's goal reviewer (infrastructure); no repair cycle consumed. */
  pendingReview: boolean;
  reviewRetries: number;
}

export interface ManagerLoop {
  /** Enqueues an event; processing is serialized. */
  post(event: OrchestrationEvent): void;
  /** Resolves once queued events are drained; optionally awaits already-started worker runs and their resulting events. */
  settle(options?: { waitForWorkers?: boolean }): Promise<void>;
  task(taskId: string): TaskSnapshot | null;
  tasks(): TaskSnapshot[];
  lastSchedule(): ScheduleDecision[];
  rejectedIntakes(): { taskId: string; reason: string }[];
  /** Loads the latest checkpoint once and deterministically resumes safe pending work. */
  resume(): Promise<void>;
  /** Stops future dispatch only; an already-running worker is not interrupted. */
  pause(taskId: string): { ok: boolean; reason?: string };
  /** Stops future work and uses the active WorkerHandle cancellation path when running. */
  cancel(taskId: string): { ok: boolean; cancellationRequested: boolean; reason?: string };
  /** Exact current approval check. Read-only; it never wakes the runtime. */
  pendingApproval(taskId: string): Promise<(ApprovalCheck & { risk: RiskLevel; requestedAt: IsoTimestamp }) | null>;
  readonly policy: OrchestrationPolicy;
}

function validateIntake(t: TaskIntake, known: ReadonlyMap<string, unknown>): string | null {
  if (!t || typeof t !== "object") return "malformed intake";
  if (!isValidBranchTaskId(t.taskId)) return "invalid task id";
  if (known.has(t.taskId)) return "duplicate task id";
  if (!(TASK_CATEGORIES as readonly string[]).includes(t.category)) return "unknown category";
  if (!t.classification || t.classification.taskId !== t.taskId || t.classification.category !== t.category) {
    return "classification does not belong to this task";
  }
  if (!t.routing) return "routing decision is required";
  const paths = normalizePathSet(Array.isArray(t.expectedPaths) ? t.expectedPaths : []);
  if (!paths.ok || paths.paths.length === 0) return "expected paths are missing or unsafe";
  if (typeof t.workspaceId !== "string" || t.workspaceId === "") return "workspace id is required";
  if (!Array.isArray(t.acceptanceCriteria) || t.acceptanceCriteria.length === 0) return "acceptance criteria are required";
  if (!Array.isArray(t.requiredValidations) || t.requiredValidations.length === 0) return "required validations are required";
  if ((t.dependsOn ?? []).includes(t.taskId)) return "task depends on itself";
  return null;
}

function modeOf(t: { intake: TaskIntake }): TaskMode {
  return t.intake.mode === "read_only" ? "read_only" : "change";
}

export function createManagerLoop(ports: OrchestrationPorts, overrides: Partial<OrchestrationPolicy> = {}): ManagerLoop {
  const policy: OrchestrationPolicy = Object.freeze({
    ...DEFAULT_ORCHESTRATION_POLICY,
    ...overrides,
    deepReviewEnabled: false as const,
    executableWorkers: (overrides.executableWorkers ?? DEFAULT_ORCHESTRATION_POLICY.executableWorkers).filter((k) => EXECUTABLE_THIS_PHASE.includes(k)),
  });
  const recs = new Map<string, TaskRecord>();
  const results = new Map<string, WorkerResult>();
  const cancels = new Map<string, (reason: string) => void>();
  const workerCompletions = new Set<Promise<void>>();
  const rejected: { taskId: string; reason: string }[] = [];
  const queue: OrchestrationEvent[] = [];
  let draining: Promise<void> | null = null;
  // Set synchronously so an event posted while the first handler runs never starts a second drain.
  let running = false;
  let seq = 0;
  let last: ScheduleDecision[] = [];
  let resumed = false;
  let persistenceFailed = false;

  function persistedRecord(t: TaskRecord): PersistedTaskRecord {
    const record = t.record
      ? {
          ...t.record,
          validations: t.record.validations.map(({ summary: _summary, ...v }) => v),
          acceptance: t.record.acceptance.map(({ summary: _summary, ...a }) => a),
        }
      : null;
    const lastResult = t.lastResult ? { ...t.lastResult, summary: "" } : null;
    const qa = t.qa ? { ...t.qa, reasons: [] } : null;
    return {
      intake: structuredClone(t.intake),
      seq: t.seq,
      lineageId: t.lineageId,
      priority: structuredClone(t.priority),
      risk: t.risk,
      worker: t.worker,
      state: t.state,
      status: t.status,
      branchPlanState: t.branchPlanState,
      plan: t.plan ? structuredClone(t.plan) : null,
      baseContract: t.baseContract ? structuredClone(t.baseContract) : null,
      contract: t.contract ? structuredClone(t.contract) : null,
      runId: t.runId,
      runCount: t.runCount,
      workerRunning: t.workerRunning,
      workerExecutions: t.workerExecutions,
      maxRepairAttempts: t.maxRepairAttempts,
      lastResult,
      record,
      repair: structuredClone(t.repair),
      repairCycles: structuredClone(t.repairCycles),
      infrastructureRetries: t.infraRetries,
      humanEscalation: t.humanEscalation ? structuredClone(t.humanEscalation) : null,
      humanRound: t.humanRound,
      humanDecisionRequest: t.humanDecisionRequest ? structuredClone(t.humanDecisionRequest) : null,
      escalationPhase: t.escalationPhase,
      humanDecisionLog: structuredClone(t.humanDecisionLog),
      consumedHumanDecisionIds: [...t.consumedHumanDecisionIds],
      escalationHistory: structuredClone(t.escalationHistory),
      pendingRepair: t.pendingRepair ? structuredClone(t.pendingRepair) : null,
      pendingRetry: t.pendingRetry ? structuredClone(t.pendingRetry) : null,
      replans: t.replans,
      receipt: t.receipt ? structuredClone(t.receipt) : null,
      pr: t.pr ? structuredClone(t.pr) : null,
      prState: t.pr ? "open" : null,
      qa,
      qaPolls: t.qaPolls,
      nextQaPollDelayMs: t.nextQaPollDelayMs,
      approval: structuredClone(t.approval),
      approvalPhase: t.approvalPhase,
      approvalRequestedAt: t.approvalRequestedAt,
      commitApprovalEvidence: t.commitApprovalEvidence ? structuredClone(t.commitApprovalEvidence) : null,
      queueReason: t.queueReason,
      blockingReason: t.blockingReason,
      escalations: structuredClone(t.escalations),
      capabilities: capabilityList(t),
      pendingSideEffect: t.pendingSideEffect,
      pendingSideEffectId: t.pendingSideEffectId,
      paused: t.paused,
      pendingReview: t.pendingReview,
      reviewRetries: t.reviewRetries,
    };
  }

  function persistOrThrow() {
    if (!ports.persistence || persistenceFailed) return;
    ports.persistence.save({
      version: 1,
      sequence: seq,
      tasks: Array.from(recs.values())
        .sort((a, b) => a.seq - b.seq)
        .map(persistedRecord),
    });
  }

  // ---------------------------------------------------------------- helpers

  const isTerminalStatus = (s: OrchestrationStatus) => TERMINAL_ORCHESTRATION_STATUSES.includes(s);
  const maxInfraRetries = Math.max(0, Math.floor(policy.maxInfrastructureRetries));
  // Each accepted human decision opens one more round of maxRepairAttempts cycles.
  const maxWorkerExecutions = (t: TaskRecord) => 1 + t.maxRepairAttempts * t.humanRound + maxInfraRetries;
  const capabilityList = (t: TaskRecord) => CAPABILITIES.filter((c) => t.capabilities.has(c));

  function audit(
    t: TaskRecord,
    event: OrchestrationAuditEvent,
    extra: {
      from?: TaskState | null;
      to?: TaskState | null;
      attempt?: number;
      reason?: string | null;
      dependencyIds?: readonly string[];
      fallbackFrom?: WorkerKind | null;
      reasonCode?: string | null;
    } = {},
  ) {
    ports.audit(
      orchestrationAudit(event, extra.from ?? t.state, extra.to ?? null, {
        taskId: t.intake.taskId,
        priority: t.priority.priority,
        worker: t.worker,
        fallbackFrom: extra.fallbackFrom ?? t.intake.routing.fallbackFrom ?? null,
        reasonCode: extra.reasonCode ?? t.intake.routing.reasonCode ?? null,
        risk: t.risk,
        branch: t.plan?.branch ?? null,
        headSha: t.receipt?.headSha ?? t.record?.verifiedHeadSha ?? t.contract?.expectedHeadSha ?? null,
        attempt: extra.attempt ?? t.repair.attempt,
        dependencyIds: extra.dependencyIds ?? t.intake.dependsOn ?? [],
        queueReason: extra.reason ?? t.queueReason,
        outcome: t.status,
        activatedCapabilities: capabilityList(t),
      }),
    );
  }

  function escalate(t: TaskRecord, trigger: string, action: EscalationAction) {
    t.escalations.push({ trigger, action });
  }

  function move(t: TaskRecord, to: TaskState, ctx: Omit<TransitionContext, "riskLevel"> = {}) {
    assertTransition(t.state, to, { riskLevel: t.risk, ...ctx });
    t.state = to;
  }

  function releaseLease(t: TaskRecord): boolean {
    if (!t.lease) return false;
    const released = ports.leases.release(t.lease).ok;
    t.lease = null;
    return released;
  }

  function view(t: TaskRecord): SchedulerTaskView {
    return {
      taskId: t.intake.taskId,
      seq: t.seq,
      priority: t.priority.priority,
      state: t.state,
      status: t.status,
      inFlight: t.plan !== null && !isTerminalStatus(t.status),
      worker: t.worker,
      dependsOn: t.intake.dependsOn ?? [],
      workspaceId: t.intake.workspaceId,
      lineageId: t.lineageId,
      expectedPaths: t.intake.expectedPaths,
      workerExecutions: t.workerExecutions,
      maxWorkerExecutions: maxWorkerExecutions(t),
    };
  }

  function activeWork(): ActiveWork[] {
    const out: ActiveWork[] = [];
    for (const t of Array.from(recs.values())) {
      if (!t.plan || isTerminalStatus(t.status)) continue;
      out.push({
        taskId: t.intake.taskId,
        lineageId: t.plan.lineageId,
        branch: t.plan.branch,
        expectedPaths: t.plan.expectedPaths,
        state: t.state,
        prNumber: t.pr?.number ?? null,
        prState: t.pr ? "open" : null,
        workerRunning: t.workerRunning,
        baseSha: t.plan.baseSha,
      });
    }
    return out;
  }

  function snapshot(t: TaskRecord): TaskSnapshot {
    return structuredClone({
      taskId: t.intake.taskId,
      seq: t.seq,
      title: t.intake.title,
      category: t.intake.category,
      mode: modeOf(t),
      answer: modeOf(t) === "read_only" && t.status === "accepted" ? (t.lastResult?.summary ?? null) : null,
      risk: t.risk,
      priority: t.priority,
      state: t.state,
      status: t.status,
      branchPlanState: t.branchPlanState,
      branch: t.plan?.branch ?? null,
      worker: t.worker,
      dependsOn: [...(t.intake.dependsOn ?? [])],
      workspaceId: t.intake.workspaceId,
      expectedPaths: [...t.intake.expectedPaths],
      inFlight: view(t).inFlight,
      workerRunning: t.workerRunning,
      workerErrorType: t.lastResult?.errorType ?? null,
      paused: t.paused,
      pendingReview: t.pendingReview,
      reviewRetries: t.reviewRetries,
      repair: t.repair,
      repairCycles: t.repairCycles,
      humanEscalation: t.humanEscalation,
      humanDecisionRequest: t.humanDecisionRequest,
      humanRound: t.humanRound,
      escalationHistory: t.escalationHistory,
      humanDecisionLog: t.humanDecisionLog,
      pendingRepair: t.pendingRepair
        ? {
            round: t.pendingRepair.request.diagnosis.round,
            attempt: t.pendingRepair.request.attempt,
            diagnosis: t.pendingRepair.request.diagnosis,
            approvalBinding: redStartBindingId(t.pendingRepair.contract),
          }
        : null,
      pendingRetry: t.pendingRetry ? { errorType: t.pendingRetry.errorType, approvalBinding: redStartBindingId(t.pendingRetry.contract) } : null,
      replans: t.replans,
      prNumber: t.pr?.number ?? null,
      headSha: t.receipt?.headSha ?? null,
      approvalPhase: t.approvalPhase,
      qaStatus: t.qa?.status ?? null,
      nextQaPollDelayMs: t.nextQaPollDelayMs,
      queueReason: t.queueReason,
      blockingReason: t.blockingReason,
      escalations: t.escalations,
      budget: {
        managerProfile: managerBudget(t.risk).profile,
        maxRepairAttempts: t.maxRepairAttempts,
        maxConcurrentTasks: policy.maxConcurrentTasks,
        maxWorkerExecutions: maxWorkerExecutions(t),
        workerExecutions: t.workerExecutions,
        maxInfrastructureRetries: maxInfraRetries,
        infrastructureRetries: t.infraRetries,
        workerInteractivePromptsAllowed: WORKER_INTERACTIVE_PROMPTS_ALLOWED,
        managerLlmCalls: 0 as const,
        llmCallBudget: policy.llmCallBudget,
        deepReviewEnabled: false as const,
        activatedCapabilities: capabilityList(t),
        escalationCount: t.escalations.length,
      },
    });
  }

  // ------------------------------------------------------ terminal outcomes

  function block(t: TaskRecord, reason: string, opts: { terminal: boolean; action?: EscalationAction; trigger?: string }) {
    if (isTerminalStatus(t.status)) return;
    const from = t.state;
    if (opts.terminal && !isTerminalState(t.state)) {
      try {
        move(t, "failed");
      } catch {
        // Every non-terminal state may fail; keep the current state if not.
      }
    }
    if (t.workerRunning && t.runId) cancels.get(t.runId)?.("orchestration blocked");
    t.status = "blocked";
    t.blockingReason = reason.slice(0, 200);
    escalate(t, opts.trigger ?? "blocked", opts.action ?? "block");
    const freed = t.lease?.workspaceId ?? null;
    releaseLease(t);
    audit(t, "manager_blocked", {
      from,
      to: t.state === from ? null : t.state,
      reason,
    });
    post({ type: "dependency_completed", taskId: t.intake.taskId });
    if (freed) post({ type: "workspace_available", workspaceId: freed });
  }

  function failPersistence(t: TaskRecord) {
    if (!isTerminalStatus(t.status)) {
      block(t, "orchestration persistence failed", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
      return;
    }
    // A terminal outcome that was not durably recorded is not trustworthy.
    // Keep the domain state for auditability but fail the orchestration closed.
    t.status = "blocked";
    t.blockingReason = "orchestration persistence failed";
    escalate(t, "missing_trusted_evidence", "block");
    releaseLease(t);
  }

  function accept(t: TaskRecord, from: TaskState) {
    t.status = "accepted";
    t.queueReason = null;
    const freed = t.lease?.workspaceId ?? null;
    releaseLease(t);
    audit(t, "manager_accepted", { from, to: t.state });
    post({ type: "dependency_completed", taskId: t.intake.taskId });
    if (freed) post({ type: "workspace_available", workspaceId: freed });
  }

  function awaitApproval(t: TaskRecord, phase: ApprovalPhase, trigger: string) {
    t.capabilities.add("human_approval");
    t.status = "needs_human_approval";
    t.approvalPhase = phase;
    t.approvalRequestedAt = ports.now();
    escalate(t, trigger, "request_human_approval");
    audit(t, "human_approval_requested", {
      reason: `${phase} approval required`,
    });
  }

  function setWaiting(t: TaskRecord, status: OrchestrationStatus, d: Pick<ScheduleDecision, "reason" | "waitingOn">, event: OrchestrationAuditEvent, esc?: { trigger: string; action: EscalationAction }) {
    if (t.status === status && t.queueReason === d.reason) return; // no change, no noise
    t.status = status;
    t.queueReason = d.reason;
    if (esc) escalate(t, esc.trigger, esc.action);
    audit(t, event, { reason: d.reason, dependencyIds: d.waitingOn });
  }

  // ------------------------------------------------------------- intake

  function intake(task: TaskIntake) {
    const reason = validateIntake(task, recs);
    if (reason) {
      rejected.push({
        taskId: String((task as { taskId?: unknown })?.taskId ?? "").slice(0, 64),
        reason,
      });
      return;
    }
    const graph = new Map<string, readonly string[]>(Array.from(recs.values()).map((r) => [r.intake.taskId, r.intake.dependsOn ?? []]));
    graph.set(task.taskId, task.dependsOn ?? []);
    const cycle = findDependencyCycle(graph);
    if (cycle) {
      rejected.push({
        taskId: task.taskId,
        reason: `dependency cycle: ${cycle.join(" -> ")}`,
      });
      return;
    }
    const risk = task.classification.risk.level;
    const t: TaskRecord = {
      intake: structuredClone(task),
      seq: ++seq,
      lineageId: task.lineage?.rootTaskId ?? task.taskId,
      priority: assessPriority({
        signals: task.prioritySignals,
        requested: task.requestedPriority,
      }),
      risk,
      worker: task.routing.worker,
      state: "routed",
      status: "queued",
      branchPlanState: "none",
      plan: null,
      lease: null,
      baseContract: null,
      contract: null,
      runId: null,
      runCount: 0,
      workerRunning: false,
      workerExecutions: 0,
      maxRepairAttempts: Math.max(0, Math.min(policy.maxRepairAttempts, managerBudget(risk).maxRepairAttempts)),
      lastResult: null,
      record: null,
      repair: { attempt: 0, prior: [] },
      repairCycles: [],
      infraRetries: 0,
      humanEscalation: null,
      humanRound: 1,
      humanDecisionRequest: null,
      escalationPhase: null,
      humanDecisionLog: [],
      consumedHumanDecisionIds: [],
      escalationHistory: [],
      pendingRepair: null,
      pendingRetry: null,
      replans: 0,
      receipt: null,
      pr: null,
      qa: null,
      qaPolls: 0,
      nextQaPollDelayMs: null,
      approval: { pre_execution: "none", commit_publish: "none", post_qa: "none" },
      approvalPhase: null,
      queueReason: null,
      blockingReason: null,
      escalations: [],
      capabilities: new Set<Capability>(["scheduler"]),
      pendingSideEffect: null,
      pendingSideEffectId: null,
      trustedApproval: null,
      approvalRequestedAt: null,
      commitApprovalEvidence: null,
      paused: false,
      pendingReview: false,
      reviewRetries: 0,
    };
    if ((task.dependsOn ?? []).length > 0) t.capabilities.add("dependency_resolver");
    recs.set(task.taskId, t);
    if (task.routing.worker === null) {
      audit(t, "worker_unavailable", {
        reason: task.routing.reason,
        reasonCode: task.routing.reasonCode,
      });
    } else if (task.routing.isFallback) {
      audit(t, "worker_fallback_selected", {
        reason: task.routing.reason,
        reasonCode: task.routing.reasonCode,
        fallbackFrom: task.routing.fallbackFrom,
      });
    } else {
      audit(t, "worker_selected", {
        reason: task.routing.reason,
        reasonCode: task.routing.reasonCode,
      });
    }
    if (risk === "red") {
      move(t, "awaiting_approval");
      awaitApproval(t, "pre_execution", "approval_required");
    } else {
      move(t, "queued");
      audit(t, "task_queued", {
        from: "routed",
        to: "queued",
        reason: "accepted for scheduling",
      });
    }
    post({ type: "scheduler_tick" });
  }

  // ------------------------------------------------------------ scheduling

  async function tick() {
    const schedulerTasks = Array.from(recs.values()).filter((t) => !t.paused).map(view);
    const schedulerInput = {
      tasks: schedulerTasks,
      workspaceHolder: (id: string) => ports.leases.current(id)?.taskId ?? null,
      policy: {
        maxConcurrentTasks: policy.maxConcurrentTasks,
        executableWorkers: policy.executableWorkers,
        highConflictPaths: policy.highConflictPaths,
      },
    };
    const candidates = decideSchedule({ ...schedulerInput, runtimeAvailable: true });
    let runtimeAvailable = true;
    let runtimeStarting = false;
    let runtimeReason = "runtime_not_available";
    if (ports.lifecycle) {
      const runnableTaskIds = candidates.filter((d) => d.action === "dispatch").map((d) => d.taskId);
      const imminentTaskIds = candidates
        .filter((d) => d.action === "wait_workspace" || d.action === "wait_branch_conflict" || (d.action === "keep_queued" && d.reason.startsWith("max concurrency")))
        .map((d) => d.taskId);
      const active = Array.from(recs.values()).filter((t) => !isTerminalStatus(t.status));
      const lifecycle = await ports.lifecycle.reconcile(
        {
          runnableTaskIds,
          imminentTaskIds,
          repairPendingTaskIds: active.filter((t) => t.status === "repair_requested").map((t) => t.intake.taskId),
          workerRunningTaskIds: active.filter((t) => t.workerRunning).map((t) => t.intake.taskId),
          activeWorkspaceLease: active.some((t) => t.lease !== null),
          orchestrationActive: active.some((t) => t.workerRunning || t.pendingSideEffect !== null || t.status === "qa_pending" || t.status === "repair_requested"),
        },
        ports.now(),
      );
      runtimeAvailable = lifecycle.ready;
      runtimeStarting = lifecycle.state.state === "starting";
      runtimeReason = lifecycle.decision.reasonCode;
      if (lifecycle.workerInterrupted) {
        for (const t of active.filter((item) => item.workerRunning))
          block(t, "codespace stopped unexpectedly while worker was running", {
            terminal: true,
            trigger: "runtime_interrupted",
            action: "wait",
          });
        return;
      }
    }
    const decisions = decideSchedule({ ...schedulerInput, runtimeAvailable });
    last = decisions;
    for (const d of decisions) {
      const t = recs.get(d.taskId);
      if (!t || isTerminalStatus(t.status)) continue;
      switch (d.action) {
        case "dispatch":
          await dispatch(t);
          break;
        case "keep_queued":
          setWaiting(t, "queued", d, "task_queued");
          break;
        case "wait_runtime":
          setWaiting(t, runtimeStarting ? "runtime_starting" : "waiting_runtime", { ...d, reason: `${d.reason}: ${runtimeReason}` }, "task_queued", {
            trigger: "runtime_unavailable",
            action: "wait",
          });
          break;
        case "wait_dependency":
          setWaiting(t, "waiting_dependency", d, "dependency_wait");
          break;
        case "wait_branch_conflict":
          setWaiting(t, "waiting_branch_conflict", d, "conflict_wait", {
            trigger: "branch_conflict",
            action: "wait",
          });
          break;
        case "wait_workspace":
          setWaiting(t, "waiting_workspace", d, "workspace_wait");
          break;
        case "blocked":
          block(t, d.reason, { terminal: true });
          break;
        case "completed":
          break;
      }
    }
  }

  function replan(t: TaskRecord, reason: string) {
    releaseLease(t);
    t.plan = null;
    t.branchPlanState = "none";
    t.replans++;
    t.capabilities.add("replan");
    if (t.replans > policy.maxReplans) {
      block(t, `replan budget exhausted (${reason})`, {
        terminal: true,
        trigger: "stale_base",
        action: "block",
      });
      return;
    }
    escalate(t, "stale_base", "replan_branch");
    t.status = "queued";
    t.queueReason = `replan ${t.replans}: base moved`;
    audit(t, "task_queued", { reason: t.queueReason });
    post({ type: "scheduler_tick" });
  }

  async function dispatch(t: TaskRecord) {
    const task = t.intake;
    t.capabilities.add("branch_planner");
    const baseSha = await ports.repo.mainHeadSha();
    const plan = planBranch(
      {
        taskId: task.taskId,
        category: task.category,
        title: task.title,
        expectedPaths: task.expectedPaths,
        baseBranch: BASE_BRANCH,
        baseSha,
        lineage: task.lineage,
      },
      { active: activeWork(), highConflictPaths: policy.highConflictPaths },
    );
    if (plan.decision === "queue") {
      t.branchPlanState = "queued";
      setWaiting(
        t,
        "waiting_branch_conflict",
        {
          reason: plan.reasons.join("; "),
          waitingOn: plan.blockedBy.map((b) => b.taskId),
        },
        "conflict_wait",
        {
          trigger: "branch_conflict",
          action: "wait",
        },
      );
      return;
    }
    if (plan.decision === "reject") {
      t.branchPlanState = "rejected";
      block(t, `branch plan rejected: ${plan.reasons.join("; ")}`, {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
      return;
    }
    t.plan = plan;
    t.branchPlanState = "assigned";

    t.capabilities.add("workspace_lease");
    const lease = ports.leases.acquire({
      workspaceId: task.workspaceId,
      taskId: task.taskId,
      lineageId: plan.lineageId,
      branch: plan.branch,
    });
    if (!lease.ok) {
      t.plan = null;
      t.branchPlanState = "none";
      setWaiting(t, "waiting_workspace", { reason: lease.reason, waitingOn: [] }, "workspace_wait");
      return;
    }
    t.lease = lease.lease;

    t.capabilities.add("github_write");
    let creation = null;
    if (plan.decision === "new_branch") {
      const created = await ports.github.createTaskBranch(plan);
      if (!created.ok) {
        if (created.error === "replan_required") return replan(t, created.reason);
        return block(t, `branch creation failed: ${created.error}`, {
          terminal: true,
          trigger: "unsafe_branch_state",
        });
      }
      creation = created.creation;
    }
    const prepared = await ports.workspace.prepare({
      plan,
      lease: t.lease,
      creation,
    });
    if (!prepared.ok)
      return block(t, `workspace preparation failed: ${prepared.error}`, {
        terminal: true,
        trigger: "unsafe_branch_state",
      });

    const assigned = assignWorkerBranch(baseContract(t), plan);
    if (!assigned.ok)
      return block(t, assigned.reason, {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
    const pre = await ports.workspace.checkPreconditions({
      prepared: prepared.prepared,
      plan,
      contract: assigned.contract,
      lease: t.lease,
    });
    if (!pre.ok)
      return block(t, `worker preconditions failed: ${pre.reason}`, {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
    t.baseContract = pre.contract;
    if (!(await authorizeWorkerContract(t, pre.contract))) return;

    const from = t.state;
    move(t, "running");
    t.status = "running";
    t.queueReason = null;
    audit(t, "task_dispatched", { from, to: "running" });
    startRun(t, pre.contract, 0);
  }

  function baseContract(t: TaskRecord): Omit<WorkerTaskContract, "branch"> {
    const task = t.intake;
    return {
      ...(modeOf(t) === "read_only" ? { mode: "read_only" as const } : {}),
      taskId: task.taskId,
      runId: `${task.taskId}-run-${t.runCount + 1}`,
      category: task.category,
      actions: task.actions,
      changedPaths: task.expectedPaths,
      storedRiskLevel: t.risk,
      objective: task.objective,
      allowedScope: task.allowedScope ?? task.expectedPaths,
      acceptanceCriteria: task.acceptanceCriteria.map((c) => c.text),
      requiredValidations: task.requiredValidations,
    };
  }

  // ----------------------------------------------------------- worker runs

  async function authorizeWorkerContract(t: TaskRecord, contract: WorkerTaskContract): Promise<boolean> {
    if (t.risk !== "red") return true;
    const resolved = await ports.approvals.resolve({
      taskId: t.intake.taskId,
      phase: "pre_execution",
      kind: "start",
      requestedAction: APPROVAL_ACTIONS.pre_execution,
      bindingShaOrActionId: redStartBindingId(contract),
    });
    t.approval.pre_execution = resolved.state;
    if (resolved.state !== "approved" || !resolved.approval) {
      block(t, "stored pre-execution approval does not authorize the current worker contract", {
        terminal: true,
        trigger: "approval_required",
      });
      return false;
    }
    t.trustedApproval = resolved.approval;
    return true;
  }

  function startRun(t: TaskRecord, contract: WorkerTaskContract, attempt: number) {
    // Typed invariant: no Worker run (first run, repair, retry, or after any approval) may carry a
    // mutability different from the task's intent-derived mode.
    const mutability = checkMutability({ taskMode: modeOf(t), contractMode: contract.mode, intent: t.intake.goal?.intent ?? null });
    if (!mutability.ok) return block(t, `mutability invariant violated: ${mutability.reason}`, { terminal: true, trigger: "scope_violation" });
    // Hard cap independent of the validator: no path can exceed 1 + maxRepairAttempts runs.
    if (t.workerExecutions >= maxWorkerExecutions(t)) {
      return block(t, "worker execution budget exhausted", {
        terminal: true,
        trigger: "repeated_repair_failure",
      });
    }
    if (!t.worker || !policy.executableWorkers.includes(t.worker)) {
      return block(t, `worker ${t.worker ?? "none"} is not executable`, {
        terminal: true,
        trigger: "worker_unavailable",
      });
    }
    t.capabilities.add("worker");
    const runId = contract.runId;
    t.runCount++;
    t.workerExecutions++;
    t.workerRunning = true;
    t.runId = runId;
    t.contract = contract;
    t.pendingSideEffect = "worker";
    t.pendingSideEffectId = runId;
    // Intent is durable before the non-idempotent worker process starts.
    persistOrThrow();
    const handle = ports.worker.start(t.worker, contract, t.trustedApproval);
    if (handle.runId !== runId) throw new Error("[scheduler] worker handle runId does not match the contract");
    cancels.set(runId, (reason) => handle.cancel(reason));
    audit(t, "worker_started", { attempt });
    if (t.worker === "codex") audit(t, "codex_worker_started", { attempt });
    const taskId = t.intake.taskId;
    const completion = handle.result.then(
      (result) => {
        results.set(runId, result);
        post({
          type: attempt > 0 ? "repair_completed" : result.status === "success" ? "worker_completed" : "worker_failed",
          taskId,
          runId,
        });
      },
      () => post({ type: "worker_failed", taskId, runId }),
    );
    workerCompletions.add(completion);
    void completion.finally(() => workerCompletions.delete(completion));
  }

  async function onRunDone(taskId: string, runId: string) {
    const t = recs.get(taskId);
    // Only the loop's own outstanding run is accepted; stale or forged notifications are ignored.
    if (!t || t.runId !== runId || !t.workerRunning) return;
    const result = results.get(runId) ?? null;
    results.delete(runId);
    cancels.delete(runId);
    t.workerRunning = false;
    t.pendingSideEffect = null;
    t.pendingSideEffectId = null;
    if (isTerminalStatus(t.status)) return;
    if (!result || !t.lease || !t.plan || !t.contract)
      return block(t, "worker run produced no trusted result", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    t.lastResult = result;
    // The latest run of the current Manager-guided cycle (an infrastructure retry re-runs the same cycle).
    const cycle = currentCycle(t);
    if (cycle) {
      cycle.repairRunId = runId;
      cycle.workerResult = { status: result.status, errorType: result.errorType };
      cycle.revalidation = null;
    }
    audit(t, t.repair.attempt > 0 ? "repair_completed" : "worker_completed");
    if (t.worker === "codex") audit(t, result.status === "success" ? "codex_worker_completed" : "codex_worker_failed");

    let record: TrustedRunRecord;
    try {
      record = await ports.evidence.record({
        taskId,
        runId,
        contract: t.contract,
        result,
        lease: t.lease,
        // The original goal and its criteria come from the immutable intake, never from the Worker.
        goal: {
          mode: modeOf(t),
          title: t.intake.title,
          objective: t.intake.objective,
          goal: t.intake.goal ? structuredClone(t.intake.goal) : null,
          criteria: structuredClone(t.intake.acceptanceCriteria),
        },
      });
    } catch (err) {
      // No prior failure: the evidence error is the primary failure (generic fail-closed path).
      if (result.status === "success" || result.errorType === null) throw err;
      // A Worker failure (e.g. git_metadata_changed with headSha=null) is primary; the
      // evidence error is secondary and must never mask it. Still terminal, no repair.
      escalate(t, `secondary:evidence_record_failed(${err instanceof Error ? err.name : "unknown"})`, "block");
      return block(t, `worker failure: ${result.errorType}`, {
        terminal: true,
        trigger: `worker_${result.errorType}`,
      });
    }
    t.record = record;
    const phase = t.pr ? "pre_push" : "post_qa";
    // A read-only task that changed anything is a policy violation, never a repairable result.
    if (modeOf(t) === "read_only" && record.changedPaths.length > 0)
      return block(t, "read-only task modified the workspace", { terminal: true, trigger: "scope_violation" });

    // A transient runtime/tool/quota/infrastructure failure is re-run on the
    // same contract without a Manager diagnosis, so it never consumes a
    // Manager-guided repair cycle. Only when nothing else about the run is
    // unsafe; once the bounded retries are used, the validator blocks it as
    // an unrecoverable infrastructure condition.
    if (result.errorType !== null && TRANSIENT_WORKER_ERRORS.includes(result.errorType) && t.infraRetries < maxInfraRetries) {
      const probe = validateEvidence(evidenceFor(t, phase));
      const unsafe = probe.findings.some((f) => f.severity === "blocked" && f.evidenceId !== "worker:result");
      if (!unsafe) return retryInfrastructure(t, result.errorType);
    }

    // The Manager could not JUDGE the run (goal reviewer outage): wait, never a repair verdict.
    if (record.goalReviewUnavailable && result.status === "success") return awaitReview(t);

    // With an open PR, validate the repaired local result as a pre-push
    // artifact. CI is deliberately absent here because this exact head is not
    // on GitHub yet; post-QA validation below still requires exact-head CI.
    return evaluate(t, undefined, phase);
  }

  /**
   * Typed infrastructure wait. The run's result and trusted evidence exist,
   * but the goal reviewer is unavailable, so the Manager cannot complete a
   * diagnosis: no verdict is recorded, no repair cycle is consumed, the lease
   * and work stay intact, and review_retry re-judges the SAME run.
   */
  function awaitReview(t: TaskRecord) {
    t.pendingReview = true;
    t.status = "waiting_infrastructure";
    const exhausted = t.reviewRetries >= policy.maxReviewRetries;
    t.queueReason = exhausted
      ? `goal reviewer unavailable after ${t.reviewRetries} retries (infrastructure); waiting for the operator: restart the runtime to retry, or cancel. No Manager repair cycle was consumed.`
      : `goal reviewer unavailable (infrastructure); review retry ${t.reviewRetries}/${policy.maxReviewRetries}. No Manager repair cycle consumed.`;
    escalate(t, "goal_review_unavailable", "wait");
    audit(t, "goal_review_unavailable", { reason: t.queueReason });
  }

  async function onReviewRetry(taskId: string) {
    const t = recs.get(taskId);
    if (!t || !t.pendingReview || t.status !== "waiting_infrastructure" || isTerminalStatus(t.status)) return;
    if (t.reviewRetries >= policy.maxReviewRetries) return; // exhausted: only a restart re-arms retries
    if (!t.lease || !t.contract || !t.lastResult || !t.runId)
      return block(t, "review retry state incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    t.reviewRetries++;
    const record = await ports.evidence.record({
      taskId,
      runId: t.runId,
      contract: t.contract,
      result: t.lastResult,
      lease: t.lease,
      goal: {
        mode: modeOf(t),
        title: t.intake.title,
        objective: t.intake.objective,
        goal: t.intake.goal ? structuredClone(t.intake.goal) : null,
        criteria: structuredClone(t.intake.acceptanceCriteria),
      },
    });
    if (record.goalReviewUnavailable) return awaitReview(t);
    t.pendingReview = false;
    t.reviewRetries = 0;
    t.record = record;
    if (modeOf(t) === "read_only" && record.changedPaths.length > 0)
      return block(t, "read-only task modified the workspace", { terminal: true, trigger: "scope_violation" });
    t.status = t.repair.attempt > 0 ? "repair_requested" : "running";
    t.queueReason = null;
    return evaluate(t, undefined, t.pr ? "pre_push" : "post_qa");
  }

  async function retryInfrastructure(t: TaskRecord, errorType: string) {
    if (!t.lease || !t.plan || !t.contract || !t.record)
      return block(t, "infrastructure retry state incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    const head = await ports.workspace.head(t.lease);
    const expected = t.contract.expectedHeadSha ?? null;
    if (!head || head.branch !== t.plan.branch || expected === null || head.headSha !== expected || t.record.verifiedHeadSha !== expected) {
      return block(t, "workspace is not at the retry head", { terminal: true, trigger: "unsafe_branch_state" });
    }
    const contract: WorkerTaskContract = {
      ...t.contract,
      runId: `${t.intake.taskId}-run-${t.runCount + 1}`,
      // Partial task-owned edits of the interrupted run (validated in scope) may remain dirty.
      allowedDirtyPaths: Array.from(new Set([...(t.contract.allowedDirtyPaths ?? []), ...t.record.changedPaths])).sort(),
    };
    if (t.risk === "red") {
      // Recompute the binding of the retry contract. Unchanged -> the existing
      // approval still authorizes it. Changed (e.g. new task-owned dirty paths)
      // -> the held approval is dropped and a fresh one is requested; it is
      // never reused, and this wait is not a Manager-guided repair cycle.
      const resolved = await ports.approvals.resolve(redRepairCheck(t, contract));
      t.approval.pre_execution = resolved.state;
      if (resolved.state === "rejected") return block(t, "pre_execution approval rejected", { terminal: true, trigger: "approval_rejected" });
      if (resolved.state !== "approved" || !resolved.approval) {
        t.trustedApproval = null;
        t.pendingRetry = { contract: structuredClone(contract), errorType };
        t.approval.pre_execution = "pending";
        return awaitApproval(t, "pre_execution", "approval_required");
      }
      t.trustedApproval = resolved.approval;
    }
    return launchRetry(t, contract, errorType);
  }

  async function launchRetry(t: TaskRecord, contract: WorkerTaskContract, errorType: string) {
    if (!t.lease || !t.plan) return block(t, "infrastructure retry state incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    const head = await ports.workspace.head(t.lease);
    if (!head || head.branch !== t.plan.branch || head.headSha !== contract.expectedHeadSha)
      return block(t, "workspace is not at the retry head", { terminal: true, trigger: "unsafe_branch_state" });
    t.pendingRetry = null;
    t.infraRetries++;
    escalate(t, `infrastructure_failure:${errorType}`, "retry_infrastructure");
    audit(t, "infrastructure_retry_requested", { reason: `transient ${errorType}; retry ${t.infraRetries} of ${maxInfraRetries}` });
    t.status = t.repair.attempt > 0 ? "repair_requested" : "running";
    startRun(t, contract, t.repair.attempt);
  }

  // -------------------------------------------------------- Manager step

  function evidenceFor(t: TaskRecord, phase: "pre_push" | "post_qa" = "post_qa") {
    const plan = t.plan as AssignedBranchPlan;
    const postQaPhase = t.state === "qa_passed" || (t.state === "awaiting_approval" && t.approvalPhase === "post_qa");
    return buildManagerEvidence({
      taskId: t.intake.taskId,
      lineageId: plan.lineageId,
      taskState: phase === "pre_push" ? "running" : t.state,
      worker: t.worker as WorkerKind,
      result: t.lastResult as WorkerResult,
      record: t.record as TrustedRunRecord,
      allowedScope: t.intake.allowedScope ?? t.intake.expectedPaths,
      acceptanceCriteriaIds: t.intake.acceptanceCriteria.map((c) => c.id),
      storedRisk: t.risk,
      approval: postQaPhase ? t.approval.post_qa : t.approval.pre_execution,
      plan,
      pr: phase === "pre_push" ? null : t.pr,
      qa: phase === "pre_push" ? null : t.qa,
      repair: t.repair,
    });
  }

  /** The cycle of the current round whose repair produced the current evidence. */
  function currentCycle(t: TaskRecord): RepairCycleRecord | null {
    const last = t.repairCycles.at(-1);
    return last && last.round === t.humanRound && last.cycle === t.repair.attempt ? last : null;
  }

  /** Previous cycle's diagnosis plus the outcome of the repair that followed it. */
  function previousDiagnosis(t: TaskRecord) {
    const last = currentCycle(t);
    return last ? { diagnosis: last.diagnosis, repairOutcome: repairOutcomeSummary(last) } : null;
  }

  function recordEscalations(t: TaskRecord, v: ManagerValidation) {
    const trigger = v.triggers.join(",") || v.decision;
    for (const intent of v.intents) {
      if (intent === "return_to_worker") escalate(t, trigger, "return_to_worker");
      else if (intent === "replan_branch") escalate(t, trigger, "replan_branch");
      else if (intent === "request_human_approval")
        continue; // recorded by awaitApproval
      else if (intent === "future_deep_review_candidate") escalate(t, trigger, "future_deep_review_candidate"); // marker only
      // stop_task is recorded by block()
    }
  }

  async function evaluate(t: TaskRecord, approvalPhase?: ApprovalPhase, phase: "pre_push" | "post_qa" = "post_qa"): Promise<void> {
    if (!t.plan || !t.lastResult || !t.record || !t.worker) {
      return block(t, "evidence incomplete", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    }
    t.capabilities.add("validator");
    const evidence = evidenceFor(t, phase);
    // Every revalidation of a repaired result is recorded on its cycle (latest
    // wins), before the Manager compares the new failure with that cycle.
    const current = currentCycle(t);
    if (current && current.workerResult) {
      const v = validateEvidence(evidence);
      current.revalidation = { decision: v.decision, failureCode: primaryFailureCode(v), fingerprint: failureFingerprint(v) || null };
    }
    const previous = previousDiagnosis(t);
    const step = managerStep({ evidence, approvalPhase, previousDiagnosis: previous, round: t.humanRound });
    if (!step.ok)
      return block(t, `manager: ${step.reason}`, {
        terminal: true,
        trigger: "task_state_blocked",
      });
    for (const a of step.audit) ports.audit(a);
    if (RANK[step.validation.riskLevel] > RANK[t.risk]) t.risk = step.validation.riskLevel; // risk only escalates
    recordEscalations(t, step.validation);
    return applyStep(t, step, evidence, approvalPhase, phase);
  }

  async function applyStep(t: TaskRecord, step: ManagerStep, evidence: ReturnType<typeof evidenceFor>, approvalPhase: ApprovalPhase | undefined, phase: "pre_push" | "post_qa") {
    const from = t.state;
    const reasons = step.validation.reasonCodes.join(",");
    switch (step.next) {
      case "open_pr":
        if (modeOf(t) === "read_only") return completeReadOnly(t);
        return requestCommitApproval(t);
      case "advance_qa":
        // Accepted with final, passing CI on the exact head: QA is done.
        if (t.state === "qa_running" && t.qa?.status === "passed" && t.qa.headSha === t.receipt?.headSha) {
          move(t, "qa_passed");
          return evaluate(t);
        }
        return block(t, "QA has not passed on the pushed head", {
          terminal: true,
          trigger: "missing_trusted_evidence",
        });
      case "complete_task":
        move(t, "complete", from === "awaiting_approval" ? { approved: true, approvalPhase: "post_qa" } : {});
        return accept(t, from);
      case "request_post_qa_approval":
      case "await_human_approval": {
        if (step.transition) move(t, step.transition);
        const phase: ApprovalPhase = t.state === "awaiting_approval" ? "post_qa" : "pre_execution";
        return awaitApproval(t, phase, step.validation.triggers.join(",") || "approval_required");
      }
      case "dispatch_repair":
        // A stricter orchestration policy may allow fewer cycles than the Manager budget.
        if (step.repairRequest && step.repairRequest.attempt > t.maxRepairAttempts) return escalateHumanDecision(t, step, evidence, phase);
        return startRepair(t, step.repairRequest);
      case "escalate_human_decision":
        return escalateHumanDecision(t, step, evidence, phase);
      case "replan_branch":
        // Work already exists on the branch: no automatic replan after execution.
        return block(t, `replan required: ${reasons}`, {
          terminal: false,
          trigger: reasons,
          action: "replan_branch",
        });
      case "stop": {
        const gated = gateTransition({
          source: {
            taskId: t.intake.taskId,
            fromState: t.state,
            transition: "failed",
          },
          evidence,
          approvalPhase,
        });
        return block(t, `manager stop: ${reasons}`, {
          terminal: gated.ok && gated.transition === "failed",
          trigger: reasons,
        });
      }
    }
  }

  async function startRepair(t: TaskRecord, req: RepairRequest | null) {
    if (!req || !t.lease || !t.baseContract || !t.plan)
      return block(t, "repair request incomplete", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    if (req.attempt > t.maxRepairAttempts) {
      return block(t, "repair cycle outside the orchestration policy", {
        terminal: true,
        trigger: "repeated_repair_failure",
      });
    }
    // Same task lineage, same branch, same worker. Never a fresh task branch.
    if (req.taskId !== t.intake.taskId || req.branch !== t.plan.branch || req.worker !== t.worker) {
      return block(t, "repair request does not match the task lineage", {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
    }
    // Same guards as manager/lifecycle.repairStartIntent (whose promptHash is only known after the adapter starts).
    if (!REPAIRABLE_STATES.includes(t.state))
      return block(t, `cannot repair in state ${t.state}`, {
        terminal: true,
        trigger: "task_state_blocked",
      });
    const head = await ports.workspace.head(t.lease);
    if (!head || head.branch !== req.branch || head.headSha !== req.expectedHeadSha) {
      return block(t, "workspace is not at the repair head", {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
    }
    const runId = `${t.intake.taskId}-run-${t.runCount + 1}`;
    const contract = repairWorkerContract(t.baseContract, req, runId);
    if (!contract.ok)
      return block(t, contract.reason, {
        terminal: true,
        trigger: "unsafe_branch_state",
      });
    if (t.risk === "red") {
      // Every repair plan is a materially new contract (objective = diagnosis /
      // human guidance, dirty paths): it needs its own fresh pre-execution
      // approval. Wait for it instead of blocking; never reuse an older one.
      const resolved = await ports.approvals.resolve(redRepairCheck(t, contract.contract));
      t.approval.pre_execution = resolved.state;
      if (resolved.state === "rejected")
        return block(t, "pre_execution approval rejected", { terminal: true, trigger: "approval_rejected" });
      if (resolved.state !== "approved" || !resolved.approval) {
        t.pendingRepair = { request: structuredClone(req), contract: structuredClone(contract.contract) };
        t.approval.pre_execution = "pending";
        return awaitApproval(t, "pre_execution", "approval_required");
      }
      t.trustedApproval = resolved.approval;
    }
    return launchRepair(t, req, contract.contract);
  }

  function redRepairCheck(t: TaskRecord, contract: WorkerTaskContract) {
    return {
      taskId: t.intake.taskId,
      phase: "pre_execution" as const,
      kind: "start" as const,
      requestedAction: APPROVAL_ACTIONS.pre_execution,
      bindingShaOrActionId: redStartBindingId(contract),
    };
  }

  /** Starts an authorized repair run. Repair history is advanced only when the Worker actually starts. */
  async function launchRepair(t: TaskRecord, req: RepairRequest, contract: WorkerTaskContract) {
    if (!t.lease) return block(t, "repair request incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    const head = await ports.workspace.head(t.lease);
    if (!head || head.branch !== req.branch || head.headSha !== req.expectedHeadSha)
      return block(t, "workspace is not at the repair head", { terminal: true, trigger: "unsafe_branch_state" });
    t.pendingRepair = null;
    t.capabilities.add("repair_loop");
    t.repair = advanceRepairCounters(t.repair, req);
    t.repairCycles.push({ round: t.humanRound, cycle: req.attempt, diagnosis: structuredClone(req.diagnosis), repairRunId: contract.runId, workerResult: null, revalidation: null });
    t.status = "repair_requested";
    audit(t, "repair_requested", { attempt: req.attempt });
    startRun(t, contract, req.attempt);
  }

  /**
   * Two Manager-guided repair cycles completed and the failure persists.
   * Automation stops without failing the task: no further worker run,
   * commit, push or PR happens, and the escalation report names the
   * decision a human must make.
   */
  function escalateHumanDecision(t: TaskRecord, step: ManagerStep, evidence: ReturnType<typeof evidenceFor>, phase: "pre_push" | "post_qa") {
    if (isTerminalStatus(t.status)) return;
    const report = buildHumanEscalationReport({ evidence, validation: step.validation, cycles: t.repairCycles, prNumber: t.pr?.number ?? null, round: t.humanRound });
    t.humanEscalation = report;
    t.humanDecisionRequest = report.decisionRequest;
    t.escalationPhase = phase;
    t.escalationHistory.push(structuredClone(report));
    t.status = "needs_human_decision";
    t.queueReason = null;
    t.blockingReason = `needs_human_decision: ${report.currentBlocker.failureCode} on ${report.currentBlocker.failingCheck} after ${report.cyclesCompleted} Manager-guided repair cycles (${report.fingerprintTrend})`.slice(0, 200);
    escalate(t, "repeated_repair_failure", "request_human_decision");
    // The lease is kept: the uncommitted work must stay intact for a resume.
    audit(t, "human_decision_requested", { reason: `${report.decisionRequest.escalationId}: ${t.blockingReason}` });
  }

  function logHumanDecision(t: TaskRecord, outcome: HumanDecisionLogEntry["outcome"], reason: string, ids: { decisionId: string; escalationId: string } | null) {
    t.humanDecisionLog.push({ decisionId: ids?.decisionId ?? null, escalationId: ids?.escalationId ?? null, outcome, reason: reason.slice(0, 200), at: ports.now() });
    if (t.humanDecisionLog.length > 50) t.humanDecisionLog.shift();
    audit(t, outcome === "accepted" ? "human_decision_accepted" : "human_decision_rejected", { reason: `${outcome}: ${reason}` });
  }

  /**
   * Resume of a needs_human_decision task. The decision is untrusted input:
   * it is normalized, de-duplicated by decisionId (idempotent), bound to the
   * open escalation (task, branch, escalation id, expected HEAD) and to the
   * live workspace, then consumed by the Manager as evidence for a fresh
   * repair plan on the SAME task, branch and worker. It grants no approval:
   * commit/publish, red-risk, merge and deploy gates are untouched.
   */
  async function onHumanDecision(taskId: string, raw: unknown) {
    const t = recs.get(taskId);
    if (!t) return;
    const normalized = normalizeHumanDecision(raw);
    if (!normalized.ok) return logHumanDecision(t, "rejected", normalized.reason, null);
    const d = normalized.decision;
    if (t.consumedHumanDecisionIds.includes(d.decisionId)) return logHumanDecision(t, "duplicate", "decision already consumed; ignored", d);
    if (d.taskId !== taskId) return logHumanDecision(t, "rejected", "human decision belongs to another task", d);
    const request = t.humanDecisionRequest;
    if (t.status !== "needs_human_decision" || !request) return logHumanDecision(t, "rejected", `task is ${t.status}, not awaiting a human decision`, d);
    const bound = checkHumanDecisionBinding(request, d);
    if (!bound.ok) return logHumanDecision(t, "rejected", bound.reason, d);
    if (t.humanRound - 1 >= policy.maxHumanResumes) return logHumanDecision(t, "rejected", "human resume budget exhausted; cancel the task", d);
    if (t.maxRepairAttempts === 0) return logHumanDecision(t, "rejected", "repair cycles are disabled by policy", d);
    if (!t.lease || !t.plan || !t.lastResult || !t.record || !t.worker || !t.escalationPhase)
      return logHumanDecision(t, "rejected", "escalated task state is incomplete", d);
    const head = await ports.workspace.head(t.lease);
    if (!head || head.branch !== t.plan.branch || head.headSha !== request.expectedHeadSha)
      return logHumanDecision(t, "rejected", "workspace no longer matches the escalated branch/HEAD", d);
    const last = t.repairCycles.filter((c) => c.round === t.humanRound).at(-1);
    if (!last) return logHumanDecision(t, "rejected", "no Manager diagnosis to resume from", d);

    // Same trusted evidence the escalation was judged on, with counters reset for the new round.
    const evidence = { ...evidenceFor(t, t.escalationPhase), repair: { attempt: 0, prior: [] } };
    const step = humanDecisionResumeStep({ evidence, request, decision: d, previous: { diagnosis: last.diagnosis, repairOutcome: repairOutcomeSummary(last) } });
    if (!step.ok) return logHumanDecision(t, "rejected", step.reason, d);

    t.consumedHumanDecisionIds.push(d.decisionId);
    for (const a of step.audit) ports.audit(a);
    logHumanDecision(t, "accepted", `resumed as round ${step.human.round}`, d);
    t.humanRound = step.human.round;
    t.repair = { attempt: 0, prior: [] };
    t.humanDecisionRequest = null;
    t.humanEscalation = null;
    t.escalationPhase = null;
    t.blockingReason = null;
    escalate(t, `human_decision:${d.decisionId}`, "return_to_worker");
    return startRepair(t, step.repairRequest);
  }

  // ---------------------------------------------------------- GitHub path

  async function currentCommitApprovalEvidence(t: TaskRecord): Promise<CommitApprovalEvidence | null> {
    if (!t.plan || !t.lease || !t.contract || !t.record || !t.contract.expectedHeadSha || !t.contract.gitMetadataDigest) return null;
    const observed = await ports.workspace.observeCommitState(t.lease);
    if (!observed.ok) return null;
    const changedPaths = Array.from(new Set(t.record.changedPaths)).sort();
    const dirtyPaths = Array.from(new Set(observed.dirtyPaths)).sort();
    const identityPaths = observed.contentIdentities.map((id) => id.path).sort();
    if (
      observed.branch !== t.plan.branch ||
      observed.headSha !== t.contract.expectedHeadSha ||
      observed.gitMetadataDigest !== t.contract.gitMetadataDigest ||
      changedPaths.length === 0 ||
      changedPaths.length !== dirtyPaths.length ||
      changedPaths.some((path, index) => path !== dirtyPaths[index]) ||
      identityPaths.length !== changedPaths.length ||
      identityPaths.some((path, index) => path !== changedPaths[index])
    ) return null;
    return normalizeCommitApprovalEvidence({
      taskId: t.intake.taskId,
      branch: t.plan.branch,
      expectedHeadSha: t.contract.expectedHeadSha,
      changedPaths,
      contentIdentities: observed.contentIdentities,
      gitMetadataDigest: observed.gitMetadataDigest,
      allowedScope: t.intake.allowedScope ?? t.intake.expectedPaths,
      validations: t.record.validations,
      acceptance: t.record.acceptance,
      observedRisk: t.record.observedRisk,
      managerDecision: "accepted",
      action: COMMIT_PUBLISH_ACTION,
      authorization: {
        commit: true,
        normalPush: true,
        openOrReusePr: true,
        merge: false,
        deploy: false,
      },
    });
  }

  /** A read-only task accepted by the Manager completes with no commit, push or PR. */
  async function completeReadOnly(t: TaskRecord) {
    if (!t.lease || !t.record || t.record.changedPaths.length > 0)
      return block(t, "read-only completion state could not be verified", { terminal: true, trigger: "missing_trusted_evidence" });
    const observed = await ports.workspace.observeCommitState(t.lease);
    if (!observed.ok || observed.dirtyPaths.length > 0)
      return block(t, "read-only task modified the workspace", { terminal: true, trigger: "scope_violation" });
    const from = t.state;
    move(t, "complete", { readOnly: true, preExecutionApproved: t.approval.pre_execution === "approved" });
    return accept(t, from);
  }

  async function requestCommitApproval(t: TaskRecord) {
    // Defense in depth: a read-only task can never reach commit/publish.
    if (modeOf(t) === "read_only") return block(t, "read-only task cannot request commit/publish", { terminal: true, trigger: "scope_violation" });
    const evidence = await currentCommitApprovalEvidence(t);
    if (!evidence) {
      return block(t, "commit approval state could not be verified", { terminal: true, trigger: "unsafe_branch_state" });
    }
    t.commitApprovalEvidence = evidence;
    t.approval.commit_publish = "pending";
    move(t, "awaiting_approval");
    return awaitApproval(t, "commit_publish", "approval_required");
  }

  async function commitAndPush(t: TaskRecord, approval: Approval) {
    if (!t.plan || !t.lease || !t.contract || !t.lastResult || !t.record || !t.commitApprovalEvidence) {
      return block(t, "nothing verified to commit", { terminal: true, trigger: "missing_trusted_evidence" });
    }
    t.capabilities.add("github_write");
    t.pendingSideEffect = "commit";
    t.pendingSideEffectId = approval.id;
    persistOrThrow();
    const committed = await ports.workspace.commitValidated({
      plan: t.plan,
      lease: t.lease,
      evidence: t.commitApprovalEvidence,
      approval,
      at: ports.now(),
    });
    if (!committed.ok) {
      return block(t, `trusted commit failed: ${committed.error}`, { terminal: true, trigger: "unsafe_branch_state" });
    }
    t.pendingSideEffect = null;
    t.pendingSideEffectId = null;
    t.lastResult = { ...t.lastResult, headSha: committed.headSha };
    t.record = { ...t.record, verifiedHeadSha: committed.headSha };
    return push(t);
  }

  async function push(t: TaskRecord) {
    if (!t.plan || !t.lastResult || !t.record)
      return block(t, "nothing verified to push", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    t.capabilities.add("github_write");
    const input = pushInputFromWorkerResult(t.plan, t.lastResult);
    if (!input.ok)
      return block(t, `push refused: ${input.reason}`, {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    if (t.record.verifiedHeadSha !== input.localHeadSha)
      return block(t, "worker head is not git-verified", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    const expectedRemoteSha = t.receipt?.headSha ?? input.expectedRemoteSha;
    audit(t, "branch_push_requested");
    t.pendingSideEffect = "push";
    t.pendingSideEffectId = input.localHeadSha;
    persistOrThrow();
    const pushed = await ports.github.pushTaskBranch(t.plan, {
      localHeadSha: input.localHeadSha,
      expectedRemoteSha,
    });
    if (!pushed.ok) {
      const moved = pushed.error === "remote_moved" || pushed.error === "replan_required";
      return block(t, `push failed: ${pushed.error}`, {
        terminal: true,
        trigger: moved ? "stale_base" : "unsafe_branch_state",
        action: moved ? "replan_branch" : "block",
      });
    }
    t.receipt = pushed.receipt;
    t.pendingSideEffect = null;
    t.pendingSideEffectId = null;
    post({ type: "branch_pushed", taskId: t.intake.taskId });
  }

  function resetQa(t: TaskRecord) {
    t.qa = null;
    t.qaPolls = 0;
    t.status = "qa_pending";
    t.nextQaPollDelayMs = policy.qaPoll.baseDelayMs;
    audit(t, "qa_wait");
  }

  async function onBranchPushed(taskId: string) {
    const t = recs.get(taskId);
    if (!t || isTerminalStatus(t.status) || !t.receipt || !t.plan) return;
    if (t.pr) return resetQa(t);
    audit(t, "pr_create_requested");
    t.pendingSideEffect = "pr";
    t.pendingSideEffectId = t.receipt.headSha;
    persistOrThrow();
    const task = t.intake;
    const opened = await ports.github.openPullRequest(
      t.plan,
      t.receipt,
      {
        title: task.title,
        summary: task.summary,
        acceptanceCriteria: task.acceptanceCriteria.map((c) => `${c.id}: ${c.text}`),
      },
      { draft: policy.prDraft },
    );
    if (!opened.ok)
      return block(t, `PR creation failed: ${opened.error}`, {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    // The PR number comes only from the trusted write client.
    t.pr = opened.pr;
    t.pendingSideEffect = null;
    t.pendingSideEffectId = null;
    move(t, "pr_opened");
    post({ type: "pr_opened", taskId });
  }

  function onPrOpened(taskId: string) {
    const t = recs.get(taskId);
    if (!t || isTerminalStatus(t.status) || !t.pr || t.status === "qa_pending") return;
    resetQa(t);
  }

  async function onQaUpdated(taskId: string) {
    const t = recs.get(taskId);
    if (!t || t.status !== "qa_pending" || !t.pr || !t.receipt) return;
    t.capabilities.add("github_qa");
    const qa = await ports.qa.read(t.pr.number);
    t.qaPolls++;
    if (qa.prNumber !== t.pr.number)
      return block(t, "QA decision belongs to another PR", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    if (t.state === "pr_opened") move(t, "qa_running");
    const current = qa.headSha === t.receipt.headSha;
    if (current && qa.status !== "pending") {
      t.qa = qa;
      t.nextQaPollDelayMs = null;
      return evaluate(t);
    }
    const poll = nextPollStep(current ? qa : { ...qa, status: "pending" }, t.qaPolls, policy.qaPoll);
    if (poll.action === "poll") {
      t.nextQaPollDelayMs = poll.delayMs;
      audit(t, "qa_wait", {
        reason: current ? "QA pending" : "QA not yet on pushed head",
      });
      return;
    }
    t.nextQaPollDelayMs = null;
    if (!current)
      return block(t, "QA never reported on the pushed head", {
        terminal: true,
        trigger: "missing_trusted_evidence",
      });
    t.qa = qa;
    return evaluate(t); // still pending after the poll budget: the validator blocks (ci_incomplete)
  }

  // ------------------------------------------------------------ approvals

  async function approvalCheck(t: TaskRecord, phase: ApprovalPhase) {
    if (phase === "commit_publish") {
      const evidence = t.commitApprovalEvidence;
      if (!evidence) return null;
      return {
        taskId: t.intake.taskId,
        phase,
        kind: "commit_publish" as const,
        requestedAction: APPROVAL_ACTIONS.commit_publish,
        bindingShaOrActionId: commitApprovalBinding(evidence),
        evidence,
      };
    }
    if (phase === "post_qa") {
      const head = t.receipt?.headSha;
      if (!head) return null;
      return {
        taskId: t.intake.taskId,
        phase,
        kind: "merge" as const,
        requestedAction: APPROVAL_ACTIONS.post_qa,
        bindingShaOrActionId: head,
      };
    }
    // A parked red-risk repair is bound to its own exact new contract.
    if (t.pendingRepair) return { ...redRepairCheck(t, t.pendingRepair.contract), startEvidence: startEvidence(t, t.pendingRepair.contract, true) };
    if (t.pendingRetry) return { ...redRepairCheck(t, t.pendingRetry.contract), startEvidence: startEvidence(t, t.pendingRetry.contract, true) };
    let branch = t.plan?.branch;
    if (!branch) {
      // The pre-execution binding covers the deterministic task contract and
      // branch name, not repository HEAD. Avoid a Git/repository read merely
      // to display or decide an approval; dispatch later plans against the
      // real base and re-checks this exact contract through approvalAuthorizes.
      const bindingPlan = planBranch(
        {
          taskId: t.intake.taskId,
          category: t.intake.category,
          title: t.intake.title,
          expectedPaths: t.intake.expectedPaths,
          baseBranch: BASE_BRANCH,
          baseSha: "0".repeat(40),
          lineage: t.intake.lineage,
        },
        { active: [], highConflictPaths: policy.highConflictPaths },
      );
      if (bindingPlan.decision === "queue" || bindingPlan.decision === "reject") return null;
      branch = bindingPlan.branch;
    }
    const contract: WorkerTaskContract = { ...baseContract(t), branch };
    return {
      taskId: t.intake.taskId,
      phase,
      kind: "start" as const,
      requestedAction: APPROVAL_ACTIONS.pre_execution,
      bindingShaOrActionId: redStartBindingId(contract),
      startEvidence: startEvidence(t, contract, false),
    };
  }

  /** Structured description of exactly what a pre-execution approval would authorize. */
  function startEvidence(t: TaskRecord, contract: WorkerTaskContract, repair: boolean): StartApprovalEvidence {
    return {
      objectiveSummary: (t.intake.goal?.interpretedObjective ?? t.intake.summary ?? t.intake.title).slice(0, 400),
      category: contract.category,
      actions: Array.from(new Set(contract.actions.map((a) => a.kind))).sort(),
      allowedScope: [...contract.allowedScope].sort(),
      riskReasons: [...t.intake.classification.risk.reasons].slice(0, 12),
      repair,
      mode: modeOf(t),
    };
  }

  async function onApproval(taskId: string, phase: ApprovalPhase) {
    const t = recs.get(taskId);
    if (!t || t.status !== "needs_human_approval" || t.approvalPhase !== phase) return;
    const check = await approvalCheck(t, phase);
    if (!check) return;
    const resolved = await ports.approvals.resolve(check);
    t.approval[phase] = resolved.state;
    if (resolved.state === "rejected") {
      t.approval[phase] = "rejected";
      return block(t, `${phase} approval rejected`, {
        terminal: true,
        trigger: "approval_rejected",
      });
    }
    if (resolved.state !== "approved" || !resolved.approval) {
      // Notification only: forged, stale, wrong-kind/action/SHA and expired
      // approvals leave the task at the human gate.
      return;
    }
    if (phase === "commit_publish") {
      const current = await currentCommitApprovalEvidence(t);
      if (
        !current ||
        !t.commitApprovalEvidence ||
        commitApprovalBinding(current) !== commitApprovalBinding(t.commitApprovalEvidence)
      ) {
        return block(t, "commit approval became stale after trusted state changed", {
          terminal: true,
          trigger: "unsafe_branch_state",
        });
      }
      t.approval.commit_publish = "approved";
      t.approvalPhase = null;
      t.approvalRequestedAt = null;
      const resumeState = t.pr ? "qa_running" : "running";
      move(t, resumeState, { approved: true, approvalPhase: "commit_publish" });
      t.status = "running";
      return commitAndPush(t, resolved.approval);
    }
    t.trustedApproval = resolved.approval;
    t.approvalPhase = null;
    t.approvalRequestedAt = null;
    if (phase === "pre_execution" && t.pendingRepair) {
      // Fresh approval of exactly this repair plan: resume the same repair.
      t.approval.pre_execution = "approved";
      const { request, contract } = t.pendingRepair;
      return launchRepair(t, request, contract);
    }
    if (phase === "pre_execution" && t.pendingRetry) {
      // Fresh approval of exactly the changed retry contract: resume the same retry.
      t.approval.pre_execution = "approved";
      const { contract, errorType } = t.pendingRetry;
      return launchRetry(t, contract, errorType);
    }
    if (t.state === "awaiting_approval" && phase === "pre_execution") {
      move(t, "queued", { approved: true, approvalPhase: "pre_execution" });
      t.status = "queued";
      audit(t, "task_queued", {
        from: "awaiting_approval",
        to: "queued",
        reason: "pre-execution approval granted",
      });
      post({ type: "scheduler_tick" });
      return;
    }
    t.status = t.state === "awaiting_approval" ? "needs_human_approval" : "running";
    return evaluate(t, phase === "post_qa" ? "post_qa" : undefined);
  }

  // ------------------------------------------------------------ dispatcher

  async function handle(e: OrchestrationEvent) {
    switch (e.type) {
      case "task_created":
        return intake(e.task);
      case "scheduler_tick":
      case "runtime_status_updated":
      case "dependency_completed":
      case "workspace_available":
        return tick();
      case "worker_completed":
      case "worker_failed":
      case "repair_completed":
        return onRunDone(e.taskId, e.runId);
      case "branch_pushed":
        return onBranchPushed(e.taskId);
      case "pr_opened":
        return onPrOpened(e.taskId);
      case "qa_updated":
        return onQaUpdated(e.taskId);
      case "approval_granted":
        return onApproval(e.taskId, e.phase);
      case "approval_rejected":
        return onApproval(e.taskId, e.phase);
      case "human_decision_submitted":
        return onHumanDecision(e.taskId, e.decision);
      case "review_retry":
        return onReviewRetry(e.taskId);
    }
  }

  function eventTaskId(e: OrchestrationEvent): string | null {
    if (e.type === "task_created") return typeof e.task?.taskId === "string" ? e.task.taskId : null;
    return "taskId" in e && e.type !== "dependency_completed" ? e.taskId : null;
  }

  async function drain() {
    try {
      while (queue.length > 0) {
        const e = queue.shift() as OrchestrationEvent;
        try {
          await handle(e);
          try {
            persistOrThrow();
          } catch {
            persistenceFailed = true;
            const id = eventTaskId(e);
            const t = id ? recs.get(id) : undefined;
            if (t) failPersistence(t);
          }
        } catch (err) {
          // Fail closed: an unexpected error blocks the affected task instead of retrying.
          const id = eventTaskId(e);
          const t = id ? recs.get(id) : undefined;
          if (t) block(t, `orchestration error (${err instanceof Error ? err.name : "unknown"})`, { terminal: true, trigger: "task_state_blocked" });
        }
      }
    } finally {
      running = false;
      draining = null;
    }
  }

  function startDrain() {
    running = true;
    draining = drain();
  }

  function post(event: OrchestrationEvent) {
    queue.push(event);
    if (!running) startDrain();
  }

  function restorePlan(saved: PersistedTaskRecord): AssignedBranchPlan | null {
    if (!saved.plan) return null;
    const prior = saved.plan;
    const existing =
      prior.decision === "reuse_branch"
        ? {
            name: prior.branch,
            headSha: prior.headSha,
            baseSha: prior.baseSha,
            lineageId: prior.lineageId,
            prNumber: saved.pr?.number ?? prior.prNumber,
            prState: saved.pr ? ("open" as const) : null,
            changedPaths: prior.expectedPaths,
            workerRunning: false,
          }
        : null;
    const planned = planBranch(
      {
        taskId: saved.intake.taskId,
        category: saved.intake.category,
        title: saved.intake.title,
        expectedPaths: saved.intake.expectedPaths,
        baseBranch: BASE_BRANCH,
        baseSha: prior.baseSha,
        lineage: saved.intake.lineage,
        existingBranch: existing,
        allowReuse: existing !== null,
      },
      { active: [], highConflictPaths: policy.highConflictPaths },
    );
    if (planned.decision === "queue" || planned.decision === "reject" || planned.branch !== prior.branch || planned.baseSha !== prior.baseSha) {
      throw new Error("[scheduler] persisted branch plan cannot be revalidated");
    }
    return planned;
  }

  function restoreTask(saved: PersistedTaskRecord): TaskRecord {
    const reason = validateIntake(saved.intake, recs);
    if (reason) throw new Error(`[scheduler] persisted intake rejected: ${reason}`);
    if (saved.pr && saved.prState !== "open") throw new Error("[scheduler] persisted PR is not open");
    const plan = restorePlan(saved);
    let lease: WorkspaceLease | null = null;
    if (plan && !isTerminalStatus(saved.status)) {
      const acquired = ports.leases.acquire({
        workspaceId: saved.intake.workspaceId,
        taskId: saved.intake.taskId,
        lineageId: plan.lineageId,
        branch: plan.branch,
      });
      if (!acquired.ok) throw new Error("[scheduler] persisted workspace lease cannot be reacquired");
      lease = acquired.lease;
    }
    return {
      intake: structuredClone(saved.intake),
      seq: saved.seq,
      lineageId: saved.lineageId,
      priority: structuredClone(saved.priority),
      risk: saved.risk,
      worker: saved.worker,
      state: saved.state,
      status: saved.status,
      branchPlanState: saved.branchPlanState,
      plan,
      lease,
      baseContract: saved.baseContract ? structuredClone(saved.baseContract) : null,
      contract: saved.contract ? structuredClone(saved.contract) : null,
      runId: saved.runId,
      runCount: saved.runCount,
      workerRunning: saved.workerRunning,
      workerExecutions: saved.workerExecutions,
      maxRepairAttempts: saved.maxRepairAttempts,
      lastResult: saved.lastResult ? structuredClone(saved.lastResult) : null,
      record: saved.record ? structuredClone(saved.record) : null,
      repair: structuredClone(saved.repair),
      repairCycles: structuredClone(saved.repairCycles ?? []),
      infraRetries: saved.infrastructureRetries ?? 0,
      humanEscalation: saved.humanEscalation ? structuredClone(saved.humanEscalation) : null,
      humanRound: saved.humanRound ?? 1,
      humanDecisionRequest: saved.humanDecisionRequest ? structuredClone(saved.humanDecisionRequest) : null,
      escalationPhase: saved.escalationPhase ?? null,
      humanDecisionLog: structuredClone(saved.humanDecisionLog ?? []),
      consumedHumanDecisionIds: [...(saved.consumedHumanDecisionIds ?? [])],
      escalationHistory: structuredClone(saved.escalationHistory ?? []),
      pendingRepair: saved.pendingRepair ? structuredClone(saved.pendingRepair) : null,
      pendingRetry: saved.pendingRetry ? structuredClone(saved.pendingRetry) : null,
      replans: saved.replans,
      receipt: saved.receipt ? structuredClone(saved.receipt) : null,
      pr: saved.pr ? structuredClone(saved.pr) : null,
      qa: saved.qa ? structuredClone(saved.qa) : null,
      qaPolls: saved.qaPolls,
      nextQaPollDelayMs: saved.nextQaPollDelayMs,
      approval: structuredClone(saved.approval),
      approvalPhase: saved.approvalPhase,
      queueReason: saved.queueReason,
      blockingReason: saved.blockingReason,
      escalations: structuredClone(saved.escalations),
      capabilities: new Set(saved.capabilities),
      pendingSideEffect: saved.pendingSideEffect,
      pendingSideEffectId: saved.pendingSideEffectId,
      trustedApproval: null,
      approvalRequestedAt: saved.approvalRequestedAt ?? null,
      // The checkpoint sanitizer redacts any "authorization" key; that field is a fixed literal
      // (commit/push/PR yes, merge/deploy no), so it is restored as exactly that, never widened.
      commitApprovalEvidence: saved.commitApprovalEvidence
        ? { ...structuredClone(saved.commitApprovalEvidence), authorization: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false } }
        : null,
      paused: saved.paused === true,
      pendingReview: saved.pendingReview === true,
      reviewRetries: saved.reviewRetries ?? 0,
    };
  }

  async function resume() {
    if (resumed) return;
    resumed = true;
    if (!ports.persistence) return;
    const checkpoint = ports.persistence.load();
    if (!checkpoint) return;
    if (recs.size > 0) throw new Error("[scheduler] cannot resume into a non-empty loop");
    running = true;
    try {
      seq = checkpoint.sequence;
      for (const saved of [...checkpoint.tasks].sort((a, b) => a.seq - b.seq)) {
        const t = restoreTask(saved);
        recs.set(t.intake.taskId, t);
      }
      for (const t of Array.from(recs.values()).sort((a, b) => a.seq - b.seq)) {
        if (isTerminalStatus(t.status) || t.status === "needs_human_approval" || t.status === "needs_human_decision" || t.status === "qa_pending") continue;
        if (t.pendingReview) {
          // Re-arm bounded review retries for the same finished run; never re-run the Worker or re-judge stale evidence.
          t.reviewRetries = 0;
          post({ type: "review_retry", taskId: t.intake.taskId });
          continue;
        }
        if (t.workerRunning || t.pendingSideEffect !== null) {
          block(t, `restart found indeterminate ${t.pendingSideEffect ?? "worker"} side effect; refusing to repeat it`, {
            terminal: true,
            trigger: "missing_trusted_evidence",
          });
          continue;
        }
        if (t.receipt && !t.pr && t.plan) {
          // Reissue a trusted receipt by verifying the already-pushed exact
          // head. The write client skips the transport push when it matches.
          const verified = await ports.github.pushTaskBranch(t.plan, {
            localHeadSha: t.receipt.headSha,
            expectedRemoteSha: t.receipt.headSha,
          });
          if (!verified.ok) {
            block(t, `resume could not verify pushed branch: ${verified.error}`, { terminal: true, trigger: "missing_trusted_evidence" });
            continue;
          }
          t.receipt = verified.receipt;
          await onBranchPushed(t.intake.taskId);
          continue;
        }
        if (!t.receipt && t.lastResult && t.record) {
          await evaluate(t, undefined, t.pr ? "pre_push" : "post_qa");
        }
      }
      persistOrThrow();
    } catch {
      persistenceFailed = true;
      throw new Error("[scheduler] resume failed closed");
    } finally {
      running = false;
      if (queue.length > 0) startDrain();
    }
    post({ type: "scheduler_tick" });
  }

  async function settleEvents() {
    for (let i = 0; i < 100_000; i++) {
      if (running) {
        await draining;
        continue;
      }
      if (queue.length > 0) {
        startDrain();
        continue;
      }
      // Let worker runs that already finished post their completion events.
      // Outstanding runs are awaited only by the explicit waitForWorkers mode.
      for (let k = 0; k < 8 && queue.length === 0; k++) await Promise.resolve();
      if (queue.length === 0 && !running) return;
    }
    throw new Error("[scheduler] loop did not settle");
  }

  return {
    post,
    policy,
    async settle(options = {}) {
      do {
        await settleEvents();
        if (!options.waitForWorkers || workerCompletions.size === 0) return;
        await Promise.all(Array.from(workerCompletions));
      } while (true);
    },
    task: (id) => {
      const t = recs.get(id);
      return t ? snapshot(t) : null;
    },
    tasks: () =>
      Array.from(recs.values())
        .sort((a, b) => a.seq - b.seq)
        .map(snapshot),
    lastSchedule: () => structuredClone(last),
    rejectedIntakes: () => structuredClone(rejected),
    resume,
    pause(taskId) {
      const t = recs.get(taskId);
      if (!t) return { ok: false, reason: "task not found" };
      if (isTerminalStatus(t.status) || isTerminalState(t.state)) return { ok: false, reason: "task is terminal" };
      if (t.workerRunning) return { ok: false, reason: "task has a running worker" };
      t.paused = true;
      t.queueReason = "paused by operator";
      persistOrThrow();
      return { ok: true };
    },
    cancel(taskId) {
      const t = recs.get(taskId);
      if (!t) return { ok: false, cancellationRequested: false, reason: "task not found" };
      if (isTerminalStatus(t.status) || isTerminalState(t.state)) return { ok: false, cancellationRequested: false, reason: "task is terminal" };
      const cancellationRequested = t.workerRunning && t.runId !== null;
      if (cancellationRequested) cancels.get(t.runId!)?.("task cancellation requested");
      const freed = t.lease?.workspaceId ?? null;
      move(t, "cancelled");
      t.status = "blocked";
      t.blockingReason = "cancelled by operator";
      t.paused = false;
      releaseLease(t);
      persistOrThrow();
      post({ type: "dependency_completed", taskId });
      if (freed) post({ type: "workspace_available", workspaceId: freed });
      return { ok: true, cancellationRequested };
    },
    async pendingApproval(taskId) {
      const t = recs.get(taskId);
      if (
        !t ||
        t.status !== "needs_human_approval" ||
        !t.approvalPhase ||
        !t.approvalRequestedAt
      )
        return null;
      const check = await approvalCheck(t, t.approvalPhase);
      return check
        ? { ...check, risk: t.risk, requestedAt: t.approvalRequestedAt }
        : null;
    },
  };
}
