import { normalizePathSet } from "../branches/overlap";
import { classifyTask } from "../domain/risk";
import { isTerminalState } from "../domain/taskState";
import type { TaskIntake } from "../scheduler/types";
import { createIntakeAuditor } from "./audit";
import { classifyIntake } from "./classify";
import { validateAndNormalizeRequest } from "./normalize";
import { seedPriority } from "./priority";
import { seedRisk } from "./risk";
import { seedRouting } from "./routing";
import { buildTaskStatus } from "./status";
import type {
  AgentRuntimeService,
  IntakeCapability,
  IntakeDependencies,
  IntakeResult,
  PersistedIntakeRecord,
  PreparedIntake,
  TaskIntakeRequest,
} from "./types";

const CATEGORY_SCOPE = {
  ui: ["client/"],
  css: ["client/"],
  layout: ["client/"],
  visual_polish: ["client/"],
  frontend_styling: ["client/"],
  backend: ["server/"],
  business_logic: ["server/"],
  database: ["drizzle/", "server/"],
  auth: ["server/"],
  security: ["server/"],
  bug_fix: ["client/", "server/"],
  architecture: ["orchestrator/"],
  general_coding: ["client/", "server/"],
} as const;
const PRODUCT_SCOPE: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    frontend: ["client/"],
    backend: ["server/"],
    database: ["drizzle/", "server/"],
    orchestration: ["orchestrator/"],
  });

function resolveScope(
  input: PreparedIntake,
  category: keyof typeof CATEGORY_SCOPE
) {
  if (input.expectedScopeHint.length)
    return { paths: input.expectedScopeHint, state: "provided" as const };
  const mapped = normalizePathSet(
    (input.productAreaHint && PRODUCT_SCOPE[input.productAreaHint]) ||
      CATEGORY_SCOPE[category]
  );
  return mapped.ok
    ? { paths: mapped.paths, state: "derived" as const }
    : { paths: [], state: "unresolved" as const };
}

function unsupportedReason(text: string): string | null {
  if (/\b(merge|approve)\s+(the\s+)?(?:pull request|pr)\b/i.test(text))
    return "intake cannot merge or approve pull requests";
  if (
    /\b(grant|enable)\s+(?:all|arbitrary)\s+(?:tools?|permissions?)\b/i.test(
      text
    )
  )
    return "user input cannot grant tool permissions";
  return null;
}

export function createAgentRuntimeService(
  deps: IntakeDependencies
): AgentRuntimeService {
  const audit = createIntakeAuditor({
    audit: deps.audit,
    nextId: deps.nextAuditId,
  });
  const status = (taskId: string) => {
    const task = deps.tasks.get(taskId);
    const intake = deps.intakeRecords.getByTask(taskId);
    return task && intake
      ? buildTaskStatus({
          task,
          intake,
          scheduler: deps.scheduler,
          runs: deps.runs,
          approvals: deps.approvals,
          audit: deps.audit,
        })
      : null;
  };

  async function submitTask(request: TaskIntakeRequest): Promise<IntakeResult> {
    const checked = validateAndNormalizeRequest(request);
    const auditId = checked.ok
      ? checked.value.requestId
      : checked.requestId || "intake-rejected";
    if (!checked.ok) {
      audit("intake_rejected", {
        taskId: auditId,
        requestId: checked.requestId,
        reasonCodes: [checked.reasonCode],
        sourceType: request?.source?.type,
      });
      return {
        outcome: "rejected",
        reasonCode: checked.reasonCode,
        reason: checked.reason,
        requestId: checked.requestId,
      };
    }
    const input = checked.value;
    audit("intake_received", {
      taskId: input.requestId,
      requestId: input.requestId,
      sourceType: input.source.type,
    });
    const existing = deps.intakeRecords.getByKey(input.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== input.fingerprint) {
        audit("idempotency_conflict", {
          taskId: existing.taskId,
          requestId: input.requestId,
          reasonCodes: ["payload_changed"],
          sourceType: input.source.type,
        });
        return {
          outcome: "rejected",
          reasonCode: "idempotency_conflict",
          reason:
            "idempotency key is already bound to a materially different request",
          requestId: input.requestId,
        };
      }
      const current = status(existing.taskId);
      if (!current)
        return {
          outcome: "rejected",
          reasonCode: "persistence_inconsistent",
          reason: "idempotency binding has no task",
          requestId: input.requestId,
        };
      audit("duplicate_request", {
        taskId: existing.taskId,
        requestId: input.requestId,
        sourceType: input.source.type,
      });
      return { outcome: "duplicate", taskId: existing.taskId, status: current };
    }
    const unsupported = unsupportedReason(input.instruction);
    if (unsupported) {
      audit("intake_rejected", {
        taskId: input.requestId,
        requestId: input.requestId,
        reasonCodes: ["unsupported_capability"],
        sourceType: input.source.type,
      });
      return {
        outcome: "rejected",
        reasonCode: "unsupported_capability",
        reason: unsupported,
        requestId: input.requestId,
      };
    }
    const classification = await classifyIntake(input, deps.llmClassifier);
    if (classification.clarificationRequired || !classification.executable) {
      audit("clarification_required", {
        taskId: input.requestId,
        requestId: input.requestId,
        reasonCodes: classification.clarificationReasons,
        sourceType: input.source.type,
        classificationPath: classification.path,
        llmClassifierCalls: classification.llmClassifierCalls,
      });
      return {
        outcome: "needs_clarification",
        reasons: classification.clarificationReasons,
        requestId: input.requestId,
      };
    }
    // classifyIntake is the only awaited intake step. Re-check the durable key
    // after it so concurrent submissions cannot both create work.
    const concurrent = deps.intakeRecords.getByKey(input.idempotencyKey);
    if (concurrent) {
      if (concurrent.requestFingerprint !== input.fingerprint) {
        audit("idempotency_conflict", {
          taskId: concurrent.taskId,
          requestId: input.requestId,
          reasonCodes: ["payload_changed"],
          sourceType: input.source.type,
        });
        return {
          outcome: "rejected",
          reasonCode: "idempotency_conflict",
          reason:
            "idempotency key is already bound to a materially different request",
          requestId: input.requestId,
        };
      }
      const current = status(concurrent.taskId);
      if (!current)
        return {
          outcome: "rejected",
          reasonCode: "persistence_inconsistent",
          reason: "idempotency binding has no task",
          requestId: input.requestId,
        };
      audit("duplicate_request", {
        taskId: concurrent.taskId,
        requestId: input.requestId,
        sourceType: input.source.type,
      });
      return {
        outcome: "duplicate",
        taskId: concurrent.taskId,
        status: current,
      };
    }
    const taskId = deps.nextTaskId();
    const scope = resolveScope(input, classification.category);
    const risk = seedRisk(taskId, classification, scope.paths);
    const priority = seedPriority(input, classification);
    const routing = seedRouting(
      taskId,
      classification,
      risk,
      deps.workerAvailability()
    );
    const capabilities: IntakeCapability[] = [
      "validation",
      "normalization",
      "deterministic_classifier",
    ];
    if (classification.path === "llm_fallback")
      capabilities.push("llm_classifier");
    capabilities.push(
      "risk_policy",
      "priority_policy",
      "routing_policy",
      "scope_policy",
      "task_store",
      "scheduler_enqueue"
    );
    deps.tasks.create({
      id: taskId,
      source: input.source.type,
      requesterId: input.source.requesterId,
      rawText: input.instruction,
      title: input.title,
      requestId: input.requestId,
      priority: priority.priority,
      acceptanceCriteria: input.acceptanceCriteria,
      requiredValidations: input.requiredValidations,
      expectedScope: scope.paths,
      expectedScopeState: scope.state,
      classificationPath: classification.path,
      llmClassifierCalls: classification.llmClassifierCalls,
      activatedIntakeCapabilities: capabilities,
    });
    deps.tasks.update(taskId, {
      normalizedSummary: input.title,
      category: classification.category,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      routedWorker: routing.worker,
      fallbackUsed: routing.isFallback,
    });
    deps.tasks.transition(taskId, "classified");
    deps.tasks.transition(taskId, "routed");
    deps.tasks.transition(
      taskId,
      risk.requiresApproval ? "awaiting_approval" : "queued"
    );
    const now = deps.now();
    const record: PersistedIntakeRecord = {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.fingerprint,
      taskId,
      requestId: input.requestId,
      title: input.title,
      objective: input.instruction,
      priority: priority.priority,
      preferredWorker: routing.primary,
      fallbackEligible: routing.primary === "claude",
      acceptanceCriteria: input.acceptanceCriteria,
      requiredValidations: input.requiredValidations,
      expectedScope: scope.paths,
      expectedScopeState: scope.state,
      classificationPath: classification.path,
      llmClassifierCalls: classification.llmClassifierCalls,
      activatedIntakeCapabilities: capabilities,
      controlState: "active",
      enqueued: false,
      createdAt: now,
      updatedAt: now,
    };
    deps.intakeRecords.create(record);
    audit("task_created", {
      taskId,
      requestId: input.requestId,
      category: classification.category,
      risk: risk.level,
      priority: priority.priority,
      worker: routing.worker,
      sourceType: input.source.type,
      classificationPath: classification.path,
      llmClassifierCalls: classification.llmClassifierCalls,
      activatedIntakeCapabilities: capabilities,
    });
    const loopIntake: TaskIntake = {
      taskId,
      title: input.title,
      category: classification.category,
      actions: classification.actions,
      classification: {
        ...classifyTask({
          id: taskId,
          category: classification.category,
          actions: classification.actions,
          changedPaths: scope.paths,
        }),
        risk,
      },
      routing,
      expectedPaths: scope.paths,
      allowedScope: scope.paths,
      objective: input.instruction,
      summary: input.title,
      acceptanceCriteria: input.acceptanceCriteria,
      requiredValidations: input.requiredValidations,
      workspaceId: "default",
      prioritySignals: classification.prioritySignals,
      requestedPriority: input.requestedPriority,
    };
    deps.scheduler.enqueue(loopIntake);
    deps.intakeRecords.update(taskId, {
      enqueued: true,
      updatedAt: deps.now(),
    });
    audit("task_enqueued", {
      taskId,
      requestId: input.requestId,
      category: classification.category,
      risk: risk.level,
      priority: priority.priority,
      worker: routing.worker,
      sourceType: input.source.type,
    });
    return { outcome: "accepted", taskId, status: status(taskId)! };
  }

  return {
    submitTask,
    getTaskStatus(taskId) {
      return status(taskId);
    },
    pauseTask(taskId) {
      const task = deps.tasks.get(taskId);
      const record = deps.intakeRecords.getByTask(taskId);
      if (!task || !record || isTerminalState(task.state))
        return status(taskId);
      const result = deps.scheduler.pause(taskId);
      if (result.ok) {
        deps.intakeRecords.update(taskId, {
          controlState: "paused",
          updatedAt: deps.now(),
        });
        audit("task_paused", {
          taskId,
          requestId: record.requestId,
          reasonCodes: ["operator_request"],
        });
      }
      return status(taskId);
    },
    cancelTask(taskId) {
      const task = deps.tasks.get(taskId);
      const record = deps.intakeRecords.getByTask(taskId);
      if (!task || !record || isTerminalState(task.state))
        return status(taskId);
      const result = deps.scheduler.cancel(taskId);
      if (result.ok) {
        try {
          deps.tasks.transition(taskId, "cancelled");
        } catch {
          /* scheduler may own the concurrent terminal transition */
        }
        deps.intakeRecords.update(taskId, {
          controlState: "cancel_requested",
          updatedAt: deps.now(),
        });
        audit("task_cancel_requested", {
          taskId,
          requestId: record.requestId,
          reasonCodes: ["operator_request"],
          cancellationRequested: result.cancellationRequested,
        });
      }
      return status(taskId);
    },
  };
}
