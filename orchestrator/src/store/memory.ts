import { validateTransition } from "../domain/taskState";
import type { RiskLevel, TaskState } from "../domain/types";
import type {
  ApprovalRepository,
  AuditRepository,
  TaskRepository,
  TaskRunRepository,
  TaskTransitionContext,
} from "./repositories";
import { sanitizeMetadata } from "./sanitize";
import { APPROVAL_KINDS, AUDIT_ACTORS } from "./types";
import type {
  Approval,
  ApprovalDecision,
  AuditEvent,
  IsoTimestamp,
  NewApproval,
  NewAuditEvent,
  NewTask,
  NewTaskRun,
  Task,
  TaskPatch,
  TaskRun,
  TaskRunPatch,
} from "./types";

/**
 * In-memory reference repositories — for tests and local domain development
 * only. No filesystem, network, DB, env, or process access. Every value
 * crossing the boundary is deep-cloned so callers cannot mutate stored state.
 * Time comes from the injected clock, keeping behavior deterministic.
 */

export type Clock = () => IsoTimestamp;

const clone = <T>(value: T): T => structuredClone(value);

const PROMPT_HASH_RE = /^[0-9a-f]{64}$/;
const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const TASK_PATCH_KEYS = new Set<string>([
  "normalizedSummary",
  "category",
  "riskLevel",
  "riskReasons",
  "routedWorker",
  "fallbackUsed",
  "branch",
  "prNumber",
  "retries",
  "deadlineAt",
]);
const RUN_PATCH_KEYS = new Set<string>(["endedAt", "exitStatus", "headSha", "summary"]);

function assertPatchKeys(kind: string, patch: object, allowed: Set<string>): void {
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`[store] ${kind} field "${key}" cannot be updated`);
  }
}

const RISK_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

/** riskLevel may only escalate; a downgrade could bypass red approval gates. */
function assertRiskNotDowngraded(current: RiskLevel | null, next: unknown): void {
  if (typeof next !== "string" || !Object.hasOwn(RISK_RANK, next)) {
    throw new Error(`[store] task.riskLevel must be one of green/yellow/red`);
  }
  if (current !== null && RISK_RANK[next as RiskLevel] < RISK_RANK[current]) {
    throw new Error(`[store] task.riskLevel cannot be downgraded from ${current} to ${next}`);
  }
}

function assertNonEmpty(field: string, value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[store] ${field} is required`);
  }
}

function assertTimestamp(field: string, value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`[store] ${field} must be an ISO timestamp`);
}

export function createInMemoryTaskRepository(now: Clock): TaskRepository {
  const rows = new Map<string, Task>();

  const getOrThrow = (id: string): Task => {
    const row = rows.get(id);
    if (!row) throw new Error(`[store] task ${id} not found`);
    return row;
  };

  return {
    create(input: NewTask): Task {
      assertNonEmpty("task.id", input.id);
      assertNonEmpty("task.source", input.source);
      assertNonEmpty("task.requesterId", input.requesterId);
      if (rows.has(input.id)) throw new Error(`[store] task ${input.id} already exists`);
      if (input.deadlineAt) assertTimestamp("task.deadlineAt", input.deadlineAt);
      const at = now();
      const task: Task = {
        id: input.id,
        source: input.source,
        requesterId: input.requesterId,
        rawText: input.rawText,
        normalizedSummary: null,
        category: null,
        riskLevel: null,
        riskReasons: [],
        routedWorker: null,
        fallbackUsed: false,
        state: "received",
        branch: null,
        prNumber: null,
        retries: 0,
        deadlineAt: input.deadlineAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      rows.set(task.id, clone(task));
      return clone(task);
    },

    get(id: string): Task | null {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    update(id: string, patch: TaskPatch): Task {
      const row = getOrThrow(id);
      assertPatchKeys("task", patch, TASK_PATCH_KEYS);
      if (patch.retries !== undefined && (!Number.isInteger(patch.retries) || patch.retries < 0)) {
        throw new Error("[store] task.retries must be a non-negative integer");
      }
      if (patch.deadlineAt) assertTimestamp("task.deadlineAt", patch.deadlineAt);
      if (Object.hasOwn(patch, "riskLevel")) assertRiskNotDowngraded(row.riskLevel, patch.riskLevel);
      const next: Task = { ...row, ...clone(patch), updatedAt: now() };
      rows.set(id, next);
      return clone(next);
    },

    transition(id: string, to: TaskState, ctx: TaskTransitionContext = {}): Task {
      const row = getOrThrow(id);
      const abort = to === "failed" || to === "cancelled";
      if (row.riskLevel === null && !abort) {
        throw new Error(`[store] task ${id} has no riskLevel; classify before transitioning`);
      }
      // Unclassified tasks may only abort; treat them as red (most restrictive).
      const riskLevel = row.riskLevel ?? "red";
      const result = validateTransition(row.state, to, { ...ctx, riskLevel });
      if (!result.ok) throw new Error(`[taskState] ${result.reason}`);
      const next: Task = { ...row, state: to, updatedAt: now() };
      rows.set(id, next);
      return clone(next);
    },
  };
}

export function createInMemoryTaskRunRepository(now: Clock): TaskRunRepository {
  const rows = new Map<string, TaskRun>();

  return {
    create(input: NewTaskRun): TaskRun {
      assertNonEmpty("run.id", input.id);
      assertNonEmpty("run.taskId", input.taskId);
      assertNonEmpty("run.model", input.model);
      if (!PROMPT_HASH_RE.test(input.promptHash)) {
        throw new Error("[store] run.promptHash must be a lowercase hex SHA-256 (never the prompt itself)");
      }
      if (rows.has(input.id)) throw new Error(`[store] run ${input.id} already exists`);
      const run: TaskRun = {
        id: input.id,
        taskId: input.taskId,
        worker: input.worker,
        model: input.model,
        codespaceName: input.codespaceName ?? null,
        promptHash: input.promptHash,
        startedAt: now(),
        endedAt: null,
        exitStatus: null,
        headSha: null,
        summary: null,
      };
      rows.set(run.id, clone(run));
      return clone(run);
    },

    get(id: string): TaskRun | null {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    update(id: string, patch: TaskRunPatch): TaskRun {
      const row = rows.get(id);
      if (!row) throw new Error(`[store] run ${id} not found`);
      assertPatchKeys("run", patch, RUN_PATCH_KEYS);
      if (patch.headSha && !GIT_SHA_RE.test(patch.headSha)) {
        throw new Error("[store] run.headSha must be a full git SHA");
      }
      if (patch.endedAt) assertTimestamp("run.endedAt", patch.endedAt);
      const next: TaskRun = { ...row, ...clone(patch) };
      rows.set(id, next);
      return clone(next);
    },

    listByTask(taskId: string): TaskRun[] {
      return Array.from(rows.values()).filter((r) => r.taskId === taskId).map(clone);
    },
  };
}

export function createInMemoryApprovalRepository(now: Clock): ApprovalRepository {
  const rows = new Map<string, Approval>();

  const getPendingOrThrow = (id: string): Approval => {
    const row = rows.get(id);
    if (!row) throw new Error(`[store] approval ${id} not found`);
    if (row.status !== "pending") throw new Error(`[store] approval ${id} is already ${row.status}`);
    return row;
  };

  return {
    create(input: NewApproval): Approval {
      assertNonEmpty("approval.id", input.id);
      assertNonEmpty("approval.taskId", input.taskId);
      assertNonEmpty("approval.requestedAction", input.requestedAction);
      assertNonEmpty("approval.bindingShaOrActionId", input.bindingShaOrActionId);
      assertTimestamp("approval.expiresAt", input.expiresAt);
      if (!APPROVAL_KINDS.includes(input.kind)) throw new Error(`[store] invalid approval kind ${String(input.kind)}`);
      if (input.kind === "merge" && !GIT_SHA_RE.test(input.bindingShaOrActionId)) {
        throw new Error("[store] merge approval must bind to a full git SHA");
      }
      if (rows.has(input.id)) throw new Error(`[store] approval ${input.id} already exists`);
      const approval: Approval = {
        id: input.id,
        taskId: input.taskId,
        kind: input.kind,
        requestedAction: input.requestedAction,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        channel: null,
        expiresAt: input.expiresAt,
        bindingShaOrActionId: input.bindingShaOrActionId,
        createdAt: now(),
      };
      rows.set(approval.id, clone(approval));
      return clone(approval);
    },

    get(id: string): Approval | null {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    decide(id: string, decision: ApprovalDecision): Approval {
      const row = getPendingOrThrow(id);
      if (decision.status !== "approved" && decision.status !== "rejected") {
        throw new Error(`[store] invalid approval decision ${String(decision.status)}`);
      }
      assertNonEmpty("approval.decidedBy", decision.decidedBy);
      assertNonEmpty("approval.channel", decision.channel);
      const at = now();
      if (Date.parse(at) >= Date.parse(row.expiresAt)) {
        throw new Error(`[store] approval ${id} has expired`);
      }
      const next: Approval = {
        ...row,
        status: decision.status,
        decidedBy: decision.decidedBy,
        decidedAt: at,
        channel: decision.channel,
      };
      rows.set(id, next);
      return clone(next);
    },

    expire(id: string): Approval {
      const next: Approval = { ...getPendingOrThrow(id), status: "expired" };
      rows.set(id, next);
      return clone(next);
    },

    listByTask(taskId: string): Approval[] {
      return Array.from(rows.values()).filter((a) => a.taskId === taskId).map(clone);
    },
  };
}

/**
 * Append-only by construction: the event log lives in this closure and the
 * returned object exposes only append() and list().
 */
export function createInMemoryAuditRepository(now: Clock): AuditRepository {
  const events: AuditEvent[] = [];
  const ids = new Set<string>();

  return Object.freeze({
    append(input: NewAuditEvent): AuditEvent {
      assertNonEmpty("audit.id", input.id);
      assertNonEmpty("audit.taskId", input.taskId);
      assertNonEmpty("audit.event", input.event);
      if (!AUDIT_ACTORS.includes(input.actor)) throw new Error(`[store] invalid audit actor ${String(input.actor)}`);
      if (ids.has(input.id)) throw new Error(`[store] audit event ${input.id} already exists`);
      const event: AuditEvent = {
        id: input.id,
        taskId: input.taskId,
        actor: input.actor,
        event: input.event,
        fromState: input.fromState ?? null,
        toState: input.toState ?? null,
        metadata: sanitizeMetadata(input.metadata),
        createdAt: now(),
      };
      ids.add(event.id);
      events.push(event);
      return clone(event);
    },

    list(filter: { taskId?: string } = {}): AuditEvent[] {
      return events.filter((e) => filter.taskId === undefined || e.taskId === filter.taskId).map(clone);
    },
  });
}

export interface MemoryStore {
  tasks: TaskRepository;
  runs: TaskRunRepository;
  approvals: ApprovalRepository;
  audit: AuditRepository;
}

export function createMemoryStore(now: Clock): MemoryStore {
  return {
    tasks: createInMemoryTaskRepository(now),
    runs: createInMemoryTaskRunRepository(now),
    approvals: createInMemoryApprovalRepository(now),
    audit: createInMemoryAuditRepository(now),
  };
}
