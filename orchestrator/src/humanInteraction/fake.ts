import { createFakeGatewayAudit, createFakeRateLimiter, createInMemoryGatewayDecisionRepository, createInMemoryHumanDecisionRepository, createInMemoryInterpretationRepository } from "../gateway/fake";
import type { IntentPlanner, OwnerNoticeComposer } from "../planning/types";
import type { ReadOnlyInspector } from "../planning/ownerQuestion";
import { createManagerApprovalRequirementReader, createManagerHumanDecisionReader, createManagerLoopGatewayEvents, createManagerRetrySourcePort } from "../gateway/integration";
import { createAgentGatewayService } from "../gateway/service";
import type { AgentGatewayService, GatewayControlEventPort } from "../gateway/types";
import type { AgentRuntimeService, AgentTaskStatus } from "../intake/types";
import type { HumanDecisionInput } from "../manager/types";
import type { ManagerLoop } from "../scheduler/loop";
import type { ApprovalRepository, AuditRepository } from "../store/repositories";
import { createRepositoryJournal } from "../persistence/journal";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createManagerLoopRuntimePort } from "../intake/runtime";
import { createAgentRuntimeService } from "../intake/service";
import { createInMemoryTaskRepository, createInMemoryTaskRunRepository } from "../store/memory";
import { createHumanOwnerSession, type HumanOwnerSession } from "./auth";
import { createAuditHumanInteractionLedger, type AuditHumanInteractionLedger } from "./ledger";
import { createHumanInteractionService, type HumanInteractionService } from "./service";
import type { HumanInteractionTransport, HumanNotice } from "./types";

export interface RecordingTransport extends HumanInteractionTransport {
  sent: { notice: HumanNotice; deliveryRef: string }[];
  failNext: number;
}

export function createRecordingTransport(firstRef = 100): RecordingTransport {
  let next = firstRef;
  const t: RecordingTransport = {
    sent: [],
    failNext: 0,
    async deliver(notice) {
      if (t.failNext > 0) {
        t.failNext--;
        throw new Error("transport unavailable");
      }
      const deliveryRef = String(next++);
      t.sent.push({ notice: structuredClone(notice), deliveryRef });
      return { deliveryRef };
    },
  };
  return t;
}

/**
 * Test composition of the human-interaction service over a Manager Loop and
 * the real Gateway. The runtime facade reads status from the loop snapshot
 * and cancels through the loop, as the live runtime service does.
 */
export function createHumanInteractionHarness(input: {
  loop: ManagerLoop;
  approvals: ApprovalRepository;
  audit: AuditRepository;
  now: () => string;
  transport?: RecordingTransport;
  /** When set, Gateway idempotency repositories are journaled into `audit` (restart tests). */
  durableGateway?: boolean;
  /** Trusted task id generator for intake (defaults to a deterministic sequence). */
  nextTaskId?: () => string;
  /** Trusted planning layer for natural-language intake (absent = planner unavailable). */
  planner?: IntentPlanner;
  /** Manager's proactive notice for a terminal task state (absent = unavailable: declared fallback). */
  noticeComposer?: OwnerNoticeComposer;
  /** Manager read-only inspection for owner questions without 「任務：」 (absent = unavailable). */
  inspector?: ReadOnlyInspector;
  /** Production behavior: never fall back to legacy non-GPT intake. */
  managerRequired?: boolean;
  idPrefix?: string;
}): {
  gateway: AgentGatewayService;
  service: HumanInteractionService;
  ledger: AuditHumanInteractionLedger;
  transport: RecordingTransport;
  owner: HumanOwnerSession;
  emitted: { taskId: string; decision: HumanDecisionInput }[];
  approvalEvents: { taskId: string; decision: string }[];
  cancelCalls: string[];
} {
  const prefix = input.idPrefix ?? "boot1";
  let id = 0;
  let taskSeq = 0;
  const nextId = () => `${prefix}-${++id}`;
  const transport = input.transport ?? createRecordingTransport();
  const owner = createHumanOwnerSession({ principalId: "telegram-owner", source: "telegram", now: input.now });
  const emitted: { taskId: string; decision: HumanDecisionInput }[] = [];
  const approvalEvents: { taskId: string; decision: string }[] = [];
  const cancelCalls: string[] = [];
  const loopEvents = createManagerLoopGatewayEvents(input.loop);
  const events: GatewayControlEventPort = {
    ...loopEvents,
    humanDecisionSubmitted(taskId, decision) {
      emitted.push({ taskId, decision: structuredClone(decision) });
      loopEvents.humanDecisionSubmitted(taskId, decision);
    },
    reEvaluateApproval(taskId, phase, decision) {
      approvalEvents.push({ taskId, decision });
      loopEvents.reEvaluateApproval(taskId, phase, decision);
    },
  };
  const status = (taskId: string) => {
    const snap = input.loop.task(taskId);
    if (!snap) return null;
    return {
      taskId,
      orchestrationStatus: snap.status,
      taskState: snap.state,
      priority: snap.priority.priority,
      risk: snap.risk,
      assignedWorker: snap.worker,
      branch: snap.branch,
      headSha: snap.headSha,
      prNumber: snap.prNumber,
      prState: snap.prNumber ? "open" : null,
      qaState: snap.qaStatus,
      repairAttempt: snap.repair.attempt,
      waitReason: snap.blockingReason ?? snap.queueReason,
      approval: { required: snap.status === "needs_human_approval" },
      createdAt: input.now(),
      updatedAt: input.now(),
    } as unknown as AgentTaskStatus;
  };
  const journal = input.durableGateway ? createRepositoryJournal({ audit: input.audit, nextId, now: input.now, streamTaskId: "gateway-journal" }) : null;
  const durable = <T extends object>(name: string, repo: T, methods: readonly (keyof T & string)[]): T => (journal ? journal.wrap(name, repo, methods) : repo);
  const clock = journal ? journal.clock : input.now;
  const decisions = durable("decisions", createInMemoryGatewayDecisionRepository(), ["create", "markEventEmitted"]);
  const submissions = durable("submissions", createInMemoryHumanDecisionRepository(), ["create", "markEventEmitted"]);
  const interpretations = durable("interpretations", createInMemoryInterpretationRepository(), ["create"]);
  const intakeRecords = durable("intakeRecords", createInMemoryIntakeRepository(), ["create", "update"]);
  // The real Task Intake runtime service: goals become normal intake tasks with trusted ids.
  const intakeService = createAgentRuntimeService({
    tasks: durable("tasks", createInMemoryTaskRepository(clock), ["create", "update", "transition"]),
    runs: durable("runs", createInMemoryTaskRunRepository(clock), ["create", "update"]),
    approvals: input.approvals,
    audit: input.audit,
    intakeRecords,
    scheduler: createManagerLoopRuntimePort(input.loop),
    workerAvailability: () => ({ claude: "available", codex: "available" }),
    nextTaskId: input.nextTaskId ?? (() => `${prefix}-task-${++taskSeq}`),
    nextAuditId: nextId,
    now: input.now,
  });
  journal?.replay();
  // Tasks created directly in the simulation (not through intake) fall back to the loop snapshot.
  const runtime: AgentRuntimeService = {
    submitTask: (request) => intakeService.submitTask(request),
    getTaskStatus: (taskId) => intakeService.getTaskStatus(taskId) ?? status(taskId),
    pauseTask: (taskId) => intakeService.pauseTask(taskId),
    cancelTask(taskId) {
      cancelCalls.push(taskId);
      if (intakeService.getTaskStatus(taskId)) return intakeService.cancelTask(taskId);
      input.loop.cancel(taskId);
      return status(taskId);
    },
  };
  const gateway = createAgentGatewayService({
    authenticator: owner.authenticator,
    runtime,
    approvals: input.approvals,
    approvalRequirements: createManagerApprovalRequirementReader(input.loop),
    decisions,
    events,
    rateLimiter: createFakeRateLimiter(),
    audit: createFakeGatewayAudit(),
    now: input.now,
    humanDecisionRequirements: createManagerHumanDecisionReader(input.loop, () => null),
    humanDecisionSubmissions: submissions,
    ...(input.planner ? { intentPlanner: input.planner } : {}),
    ...(input.noticeComposer ? { ownerNoticeComposer: input.noticeComposer } : {}),
    ...(input.inspector ? { readOnlyInspector: input.inspector } : {}),
    interpretations,
    retrySources: createManagerRetrySourcePort(input.loop, (key) => intakeRecords.getByKey(key)?.taskId ?? null),
    taskDirectory: () =>
      input.loop
        .tasks()
        .reverse()
        .map((t) => ({ taskId: t.taskId, title: t.title, status: t.status, mode: t.mode, retryOf: t.retryOf })),
  });
  const ledger = createAuditHumanInteractionLedger({ audit: input.audit, nextId, now: input.now });
  const service = createHumanInteractionService({
    gateway,
    authentication: owner.authentication,
    directory: {
      activeTaskIds: () => input.loop.tasks().filter((t) => t.status !== "accepted" && t.status !== "blocked").map((t) => t.taskId),
      allTaskIds: () => input.loop.tasks().map((t) => t.taskId),
    },
    ledger,
    transport,
    now: input.now,
    ...(input.managerRequired ? { managerRequired: true } : {}),
  });
  return { gateway, service, ledger, transport, owner, emitted, approvalEvents, cancelCalls };
}
