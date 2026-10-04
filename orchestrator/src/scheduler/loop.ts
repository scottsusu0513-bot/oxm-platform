import { planBranch } from "../branches/planner";
import { BASE_BRANCH, type ActiveWork, type AssignedBranchPlan } from "../branches/types";
import { isValidBranchTaskId } from "../branches/naming";
import { normalizePathSet } from "../branches/overlap";
import { assertTransition, isTerminalState, type ApprovalPhase, type TransitionContext } from "../domain/taskState";
import { TASK_CATEGORIES, type RiskLevel, type TaskState, type WorkerKind } from "../domain/types";
import { DEFAULT_POLL_POLICY, nextPollStep } from "../github/qa";
import type { QaDecision } from "../github/types";
import { assignWorkerBranch, pushInputFromWorkerResult } from "../githubWrite/flow";
import type { WorkspaceLease } from "../githubWrite/lease";
import type { PushReceipt, TrustedPullRequest } from "../githubWrite/types";
import { DEFAULT_MAX_REPAIR_ATTEMPTS, managerBudget } from "../manager/budget";
import { managerStep, type ManagerStep } from "../manager/lifecycle";
import { advanceRepairCounters, repairWorkerContract } from "../manager/repair";
import { gateTransition } from "../manager/sequencing";
import type { ApprovalEvidenceState, ManagerValidation, RepairCounters } from "../manager/types";
import { REPAIRABLE_STATES } from "../manager/validator";
import type { WorkerResult, WorkerTaskContract } from "../workers/types";
import { redStartBindingId } from "../workers/prompt";
import type { Approval } from "../store/types";
import { findDependencyCycle } from "./dependencies";
import { buildManagerEvidence } from "./evidence";
import { orchestrationAudit, type OrchestrationAuditEvent } from "./events";
import { assessPriority } from "./priority";
import { decideSchedule } from "./scheduler";
import {
  CAPABILITIES,
  TERMINAL_ORCHESTRATION_STATUSES,
  type BranchPlanState,
  type Capability,
  type EscalationAction,
  type EscalationRecord,
  type OrchestrationEvent,
  type OrchestrationPolicy,
  type OrchestrationPorts,
  type OrchestrationStatus,
  type PriorityAssessment,
  type PersistedTaskRecord,
  type ScheduleDecision,
  type SchedulerTaskView,
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
 *     needs_repair: same task / branch / worker, bounded attempts
 *     accepted (no PR): safe push -> open PR -> QA
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
  maxReplans: 1,
  executableWorkers: Object.freeze(["claude"]) as readonly WorkerKind[],
  prDraft: false,
  qaPoll: DEFAULT_POLL_POLICY,
  deepReviewEnabled: false as const,
  llmCallBudget: null,
});

/** Only Claude is executable in this phase, whatever the policy lists. */
const EXECUTABLE_THIS_PHASE: readonly WorkerKind[] = ["claude"];

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

export const APPROVAL_ACTIONS = {
  pre_execution: "start",
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
  pendingSideEffect: "worker" | "push" | "pr" | null;
  pendingSideEffectId: string | null;
  trustedApproval: Approval | null;
}

export interface ManagerLoop {
  /** Enqueues an event; processing is serialized. */
  post(event: OrchestrationEvent): void;
  /** Resolves once the loop is idle (no queued event; finished worker runs have posted). */
  settle(): Promise<void>;
  task(taskId: string): TaskSnapshot | null;
  tasks(): TaskSnapshot[];
  lastSchedule(): ScheduleDecision[];
  rejectedIntakes(): { taskId: string; reason: string }[];
  /** Loads the latest checkpoint once and deterministically resumes safe pending work. */
  resume(): Promise<void>;
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
      replans: t.replans,
      receipt: t.receipt ? structuredClone(t.receipt) : null,
      pr: t.pr ? structuredClone(t.pr) : null,
      prState: t.pr ? "open" : null,
      qa,
      qaPolls: t.qaPolls,
      nextQaPollDelayMs: t.nextQaPollDelayMs,
      approval: structuredClone(t.approval),
      approvalPhase: t.approvalPhase,
      queueReason: t.queueReason,
      blockingReason: t.blockingReason,
      escalations: structuredClone(t.escalations),
      capabilities: capabilityList(t),
      pendingSideEffect: t.pendingSideEffect,
      pendingSideEffectId: t.pendingSideEffectId,
    };
  }

  function persistOrThrow() {
    if (!ports.persistence || persistenceFailed) return;
    ports.persistence.save({
      version: 1,
      sequence: seq,
      tasks: Array.from(recs.values()).sort((a, b) => a.seq - b.seq).map(persistedRecord),
    });
  }

  // ---------------------------------------------------------------- helpers

  const isTerminalStatus = (s: OrchestrationStatus) => TERMINAL_ORCHESTRATION_STATUSES.includes(s);
  const maxWorkerExecutions = (t: TaskRecord) => 1 + t.maxRepairAttempts;
  const capabilityList = (t: TaskRecord) => CAPABILITIES.filter((c) => t.capabilities.has(c));

  function audit(t: TaskRecord, event: OrchestrationAuditEvent, extra: { from?: TaskState | null; to?: TaskState | null; attempt?: number; reason?: string | null; dependencyIds?: readonly string[] } = {}) {
    ports.audit(
      orchestrationAudit(event, extra.from ?? t.state, extra.to ?? null, {
        taskId: t.intake.taskId,
        priority: t.priority.priority,
        worker: t.worker,
        branch: t.plan?.branch ?? null,
        headSha: t.receipt?.headSha ?? t.record?.verifiedHeadSha ?? null,
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
      repair: t.repair,
      replans: t.replans,
      prNumber: t.pr?.number ?? null,
      headSha: t.receipt?.headSha ?? null,
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
    audit(t, "manager_blocked", { from, to: t.state === from ? null : t.state, reason });
    post({ type: "dependency_completed", taskId: t.intake.taskId });
    if (freed) post({ type: "workspace_available", workspaceId: freed });
  }

  function failPersistence(t: TaskRecord) {
    if (!isTerminalStatus(t.status)) {
      block(t, "orchestration persistence failed", { terminal: true, trigger: "missing_trusted_evidence" });
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
    escalate(t, trigger, "request_human_approval");
    audit(t, "human_approval_requested", { reason: `${phase} approval required` });
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
      rejected.push({ taskId: String((task as { taskId?: unknown })?.taskId ?? "").slice(0, 64), reason });
      return;
    }
    const graph = new Map<string, readonly string[]>(Array.from(recs.values()).map((r) => [r.intake.taskId, r.intake.dependsOn ?? []]));
    graph.set(task.taskId, task.dependsOn ?? []);
    const cycle = findDependencyCycle(graph);
    if (cycle) {
      rejected.push({ taskId: task.taskId, reason: `dependency cycle: ${cycle.join(" -> ")}` });
      return;
    }
    const risk = task.classification.risk.level;
    const t: TaskRecord = {
      intake: structuredClone(task),
      seq: ++seq,
      lineageId: task.lineage?.rootTaskId ?? task.taskId,
      priority: assessPriority({ signals: task.prioritySignals, requested: task.requestedPriority }),
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
      replans: 0,
      receipt: null,
      pr: null,
      qa: null,
      qaPolls: 0,
      nextQaPollDelayMs: null,
      approval: { pre_execution: "none", post_qa: "none" },
      approvalPhase: null,
      queueReason: null,
      blockingReason: null,
      escalations: [],
      capabilities: new Set<Capability>(["scheduler"]),
      pendingSideEffect: null,
      pendingSideEffectId: null,
      trustedApproval: null,
    };
    if ((task.dependsOn ?? []).length > 0) t.capabilities.add("dependency_resolver");
    recs.set(task.taskId, t);
    if (risk === "red") {
      move(t, "awaiting_approval");
      awaitApproval(t, "pre_execution", "approval_required");
    } else {
      move(t, "queued");
      audit(t, "task_queued", { from: "routed", to: "queued", reason: "accepted for scheduling" });
    }
    post({ type: "scheduler_tick" });
  }

  // ------------------------------------------------------------ scheduling

  async function tick() {
    const decisions = decideSchedule({
      tasks: Array.from(recs.values()).map(view),
      workspaceHolder: (id) => ports.leases.current(id)?.taskId ?? null,
      policy: { maxConcurrentTasks: policy.maxConcurrentTasks, executableWorkers: policy.executableWorkers, highConflictPaths: policy.highConflictPaths },
    });
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
        case "wait_dependency":
          setWaiting(t, "waiting_dependency", d, "dependency_wait");
          break;
        case "wait_branch_conflict":
          setWaiting(t, "waiting_branch_conflict", d, "conflict_wait", { trigger: "branch_conflict", action: "wait" });
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
      block(t, `replan budget exhausted (${reason})`, { terminal: true, trigger: "stale_base", action: "block" });
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
      setWaiting(t, "waiting_branch_conflict", { reason: plan.reasons.join("; "), waitingOn: plan.blockedBy.map((b) => b.taskId) }, "conflict_wait", {
        trigger: "branch_conflict",
        action: "wait",
      });
      return;
    }
    if (plan.decision === "reject") {
      t.branchPlanState = "rejected";
      block(t, `branch plan rejected: ${plan.reasons.join("; ")}`, { terminal: true, trigger: "unsafe_branch_state" });
      return;
    }
    t.plan = plan;
    t.branchPlanState = "assigned";

    t.capabilities.add("workspace_lease");
    const lease = ports.leases.acquire({ workspaceId: task.workspaceId, taskId: task.taskId, lineageId: plan.lineageId, branch: plan.branch });
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
        return block(t, `branch creation failed: ${created.error}`, { terminal: true, trigger: "unsafe_branch_state" });
      }
      creation = created.creation;
    }
    const prepared = await ports.workspace.prepare({ plan, lease: t.lease, creation });
    if (!prepared.ok) return block(t, `workspace preparation failed: ${prepared.error}`, { terminal: true, trigger: "unsafe_branch_state" });

    const assigned = assignWorkerBranch(baseContract(t), plan);
    if (!assigned.ok) return block(t, assigned.reason, { terminal: true, trigger: "unsafe_branch_state" });
    const pre = await ports.workspace.checkPreconditions({ prepared: prepared.prepared, plan, contract: assigned.contract, lease: t.lease });
    if (!pre.ok) return block(t, `worker preconditions failed: ${pre.reason}`, { terminal: true, trigger: "unsafe_branch_state" });
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
    // Hard cap independent of the validator: no path can exceed 1 + maxRepairAttempts runs.
    if (t.workerExecutions >= maxWorkerExecutions(t)) {
      return block(t, "worker execution budget exhausted", { terminal: true, trigger: "repeated_repair_failure" });
    }
    if (!t.worker || !policy.executableWorkers.includes(t.worker)) {
      return block(t, `worker ${t.worker ?? "none"} is not executable`, { terminal: true, trigger: "worker_unavailable" });
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
    const taskId = t.intake.taskId;
    void handle.result.then(
      (result) => {
        results.set(runId, result);
        post({ type: attempt > 0 ? "repair_completed" : result.status === "success" ? "worker_completed" : "worker_failed", taskId, runId });
      },
      () => post({ type: "worker_failed", taskId, runId }),
    );
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
    if (!result || !t.lease || !t.plan || !t.contract) return block(t, "worker run produced no trusted result", { terminal: true, trigger: "missing_trusted_evidence" });
    t.lastResult = result;
    audit(t, t.repair.attempt > 0 ? "repair_completed" : "worker_completed");

    const record = await ports.evidence.record({ taskId, runId, contract: t.contract, result, lease: t.lease });
    t.record = record;

    // With an open PR, validate the repaired local result as a pre-push
    // artifact. CI is deliberately absent here because this exact head is not
    // on GitHub yet; post-QA validation below still requires exact-head CI.
    return evaluate(t, undefined, t.pr ? "pre_push" : "post_qa");
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

  function recordEscalations(t: TaskRecord, v: ManagerValidation) {
    const trigger = v.triggers.join(",") || v.decision;
    for (const intent of v.intents) {
      if (intent === "return_to_worker") escalate(t, trigger, "return_to_worker");
      else if (intent === "replan_branch") escalate(t, trigger, "replan_branch");
      else if (intent === "request_human_approval") continue; // recorded by awaitApproval
      else if (intent === "future_deep_review_candidate") escalate(t, trigger, "future_deep_review_candidate"); // marker only
      // stop_task is recorded by block()
    }
  }

  async function evaluate(t: TaskRecord, approvalPhase?: ApprovalPhase, phase: "pre_push" | "post_qa" = "post_qa"): Promise<void> {
    if (!t.plan || !t.lastResult || !t.record || !t.worker) {
      return block(t, "evidence incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    }
    t.capabilities.add("validator");
    const evidence = evidenceFor(t, phase);
    const step = managerStep({ evidence, approvalPhase });
    if (!step.ok) return block(t, `manager: ${step.reason}`, { terminal: true, trigger: "task_state_blocked" });
    for (const a of step.audit) ports.audit(a);
    if (RANK[step.validation.riskLevel] > RANK[t.risk]) t.risk = step.validation.riskLevel; // risk only escalates
    recordEscalations(t, step.validation);
    return applyStep(t, step, evidence, approvalPhase);
  }

  async function applyStep(t: TaskRecord, step: ManagerStep, evidence: ReturnType<typeof evidenceFor>, approvalPhase?: ApprovalPhase) {
    const from = t.state;
    const reasons = step.validation.reasonCodes.join(",");
    switch (step.next) {
      case "open_pr":
        return push(t);
      case "advance_qa":
        // Accepted with final, passing CI on the exact head: QA is done.
        if (t.state === "qa_running" && t.qa?.status === "passed" && t.qa.headSha === t.receipt?.headSha) {
          move(t, "qa_passed");
          return evaluate(t);
        }
        return block(t, "QA has not passed on the pushed head", { terminal: true, trigger: "missing_trusted_evidence" });
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
        return startRepair(t, step);
      case "replan_branch":
        // Work already exists on the branch: no automatic replan after execution.
        return block(t, `replan required: ${reasons}`, { terminal: false, trigger: reasons, action: "replan_branch" });
      case "stop": {
        const gated = gateTransition({ source: { taskId: t.intake.taskId, fromState: t.state, transition: "failed" }, evidence, approvalPhase });
        return block(t, `manager stop: ${reasons}`, { terminal: gated.ok && gated.transition === "failed", trigger: reasons });
      }
    }
  }

  async function startRepair(t: TaskRecord, step: ManagerStep) {
    const req = step.repairRequest;
    if (!req || !t.lease || !t.baseContract || !t.plan) return block(t, "repair request incomplete", { terminal: true, trigger: "missing_trusted_evidence" });
    if (req.attempt > t.maxRepairAttempts) {
      return block(t, "orchestration repair budget exhausted", { terminal: true, trigger: "repeated_repair_failure" });
    }
    // Same task lineage, same branch, same worker. Never a fresh task branch.
    if (req.taskId !== t.intake.taskId || req.branch !== t.plan.branch || req.worker !== t.worker) {
      return block(t, "repair request does not match the task lineage", { terminal: true, trigger: "unsafe_branch_state" });
    }
    // Same guards as manager/lifecycle.repairStartIntent (whose promptHash is only known after the adapter starts).
    if (!REPAIRABLE_STATES.includes(t.state)) return block(t, `cannot repair in state ${t.state}`, { terminal: true, trigger: "task_state_blocked" });
    const head = await ports.workspace.head(t.lease);
    if (!head || head.branch !== req.branch || head.headSha !== req.expectedHeadSha) {
      return block(t, "workspace is not at the repair head", { terminal: true, trigger: "unsafe_branch_state" });
    }
    const runId = `${t.intake.taskId}-run-${t.runCount + 1}`;
    const contract = repairWorkerContract(t.baseContract, req, runId);
    if (!contract.ok) return block(t, contract.reason, { terminal: true, trigger: "unsafe_branch_state" });
    if (!(await authorizeWorkerContract(t, contract.contract))) return;
    t.capabilities.add("repair_loop");
    t.repair = advanceRepairCounters(t.repair, req);
    t.status = "repair_requested";
    audit(t, "repair_requested", { attempt: req.attempt });
    startRun(t, contract.contract, req.attempt);
  }

  // ---------------------------------------------------------- GitHub path

  async function push(t: TaskRecord) {
    if (!t.plan || !t.lastResult || !t.record) return block(t, "nothing verified to push", { terminal: true, trigger: "missing_trusted_evidence" });
    t.capabilities.add("github_write");
    const input = pushInputFromWorkerResult(t.plan, t.lastResult);
    if (!input.ok) return block(t, `push refused: ${input.reason}`, { terminal: true, trigger: "missing_trusted_evidence" });
    if (t.record.verifiedHeadSha !== input.localHeadSha) return block(t, "worker head is not git-verified", { terminal: true, trigger: "missing_trusted_evidence" });
    const expectedRemoteSha = t.receipt?.headSha ?? input.expectedRemoteSha;
    audit(t, "branch_push_requested");
    t.pendingSideEffect = "push";
    t.pendingSideEffectId = input.localHeadSha;
    persistOrThrow();
    const pushed = await ports.github.pushTaskBranch(t.plan, { localHeadSha: input.localHeadSha, expectedRemoteSha });
    if (!pushed.ok) {
      const moved = pushed.error === "remote_moved" || pushed.error === "replan_required";
      return block(t, `push failed: ${pushed.error}`, { terminal: true, trigger: moved ? "stale_base" : "unsafe_branch_state", action: moved ? "replan_branch" : "block" });
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
      { title: task.title, summary: task.summary, acceptanceCriteria: task.acceptanceCriteria.map((c) => `${c.id}: ${c.text}`) },
      { draft: policy.prDraft },
    );
    if (!opened.ok) return block(t, `PR creation failed: ${opened.error}`, { terminal: true, trigger: "missing_trusted_evidence" });
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
    if (qa.prNumber !== t.pr.number) return block(t, "QA decision belongs to another PR", { terminal: true, trigger: "missing_trusted_evidence" });
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
      audit(t, "qa_wait", { reason: current ? "QA pending" : "QA not yet on pushed head" });
      return;
    }
    t.nextQaPollDelayMs = null;
    if (!current) return block(t, "QA never reported on the pushed head", { terminal: true, trigger: "missing_trusted_evidence" });
    t.qa = qa;
    return evaluate(t); // still pending after the poll budget: the validator blocks (ci_incomplete)
  }

  // ------------------------------------------------------------ approvals

  async function approvalCheck(t: TaskRecord, phase: ApprovalPhase) {
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
    let branch = t.plan?.branch;
    if (!branch) {
      const bindingPlan = planBranch(
        {
          taskId: t.intake.taskId,
          category: t.intake.category,
          title: t.intake.title,
          expectedPaths: t.intake.expectedPaths,
          baseBranch: BASE_BRANCH,
          baseSha: await ports.repo.mainHeadSha(),
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
      return block(t, `${phase} approval rejected`, { terminal: true, trigger: "approval_rejected" });
    }
    if (resolved.state !== "approved" || !resolved.approval) {
      // Notification only: forged, stale, wrong-kind/action/SHA and expired
      // approvals leave the task at the human gate.
      return;
    }
    t.trustedApproval = resolved.approval;
    t.approvalPhase = null;
    if (t.state === "awaiting_approval" && phase === "pre_execution") {
      move(t, "queued", { approved: true, approvalPhase: "pre_execution" });
      t.status = "queued";
      audit(t, "task_queued", { from: "awaiting_approval", to: "queued", reason: "pre-execution approval granted" });
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
    const existing = prior.decision === "reuse_branch"
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
        if (isTerminalStatus(t.status) || t.status === "needs_human_approval" || t.status === "qa_pending") continue;
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

  return {
    post,
    policy,
    async settle() {
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
        // Outstanding runs are not awaited: they post their own events later.
        for (let k = 0; k < 8 && queue.length === 0; k++) await Promise.resolve();
        if (queue.length === 0 && !running) return;
      }
      throw new Error("[scheduler] loop did not settle");
    },
    task: (id) => {
      const t = recs.get(id);
      return t ? snapshot(t) : null;
    },
    tasks: () => Array.from(recs.values()).sort((a, b) => a.seq - b.seq).map(snapshot),
    lastSchedule: () => structuredClone(last),
    rejectedIntakes: () => structuredClone(rejected),
    resume,
  };
}
