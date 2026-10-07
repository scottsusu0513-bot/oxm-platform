import { isTerminalState } from "../domain/taskState";
import type { AgentRuntimeService, TaskIntakeRequest } from "../intake/types";
import type { ApprovalRepository } from "../store/repositories";
import { isDangerousValue, REDACTED } from "../store/sanitize";
import { fingerprintRequest } from "../intake/normalize";
import { MAX_HUMAN_GUIDANCE_LENGTH, type HumanDecisionInput } from "../manager/types";
import { isValidEscalationId } from "../domain/types";
import type { IsoTimestamp } from "../store/types";
import { COMMIT_PUBLISH_ACTION, normalizeCommitApprovalEvidence, type CommitApprovalEvidence } from "../workers/prompt";
import { authenticateAndAuthorize } from "./auth";
import {
  approvalDecisionFingerprint,
  assertCurrentBinding,
  bindingReference,
  invalid,
  safeString,
  strictObject,
  validateApprovalDecisionRequest,
} from "./approval";
import { GatewayError } from "./errors";
import type {
  AgentGatewayService,
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  ApprovalDecisionValue,
  AuthContext,
  GatewayAuditSink,
  GatewayAuthenticator,
  GatewayCapability,
  GatewayControlEventPort,
  GatewayDecisionRepository,
  GatewayExpiryPolicy,
  GatewayHumanDecisionRepository,
  HumanDecisionOutcomeView,
  HumanDecisionRequirementReader,
  HumanDecisionStatusResponse,
  HumanDecisionSubmitResponse,
  PendingHumanDecisionView,
  SubmitHumanDecisionRequest,
  TrustedHumanDecisionRequirement,
  GatewayRateAction,
  GatewayRateLimiter,
  GatewayTaskStatus,
  PendingApprovalRequirement,
  ApprovalRequirementReader,
  SubmitTaskRequest,
  TaskMutationRequest,
  TaskRequest,
} from "./types";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_EXPIRY: GatewayExpiryPolicy = Object.freeze({
  maxRequestAgeMs: 24 * 60 * 60 * 1000,
  approvalLifetimeMs: 60 * 60 * 1000,
});

export interface GatewayDependencies {
  authenticator: GatewayAuthenticator;
  runtime: AgentRuntimeService;
  approvals: ApprovalRepository;
  approvalRequirements: ApprovalRequirementReader;
  decisions: GatewayDecisionRepository;
  events: GatewayControlEventPort;
  rateLimiter: GatewayRateLimiter;
  audit: GatewayAuditSink;
  now: () => IsoTimestamp;
  expiryPolicy?: Partial<GatewayExpiryPolicy>;
  /** Trusted escalation state; without it the human-decision actions are unavailable (fail closed). */
  humanDecisionRequirements?: HumanDecisionRequirementReader;
  humanDecisionSubmissions?: GatewayHumanDecisionRepository;
}

const ESCALATION_ID = /^([A-Za-z0-9][A-Za-z0-9._:-]{0,63})\.hd\.([1-9][0-9]{0,3})$/;

/** Only escalationId, idempotencyKey and guidance are caller-controlled. */
function humanDecisionRequest(value: unknown): SubmitHumanDecisionRequest {
  const input = strictObject(value, ["escalationId", "idempotencyKey", "guidance"]);
  if (typeof input.escalationId !== "string" || !ESCALATION_ID.test(input.escalationId) || !isValidEscalationId(input.escalationId))
    invalid("escalationId is malformed");
  if (!SAFE_KEY.test(String(input.idempotencyKey ?? ""))) invalid("idempotencyKey is malformed");
  if (typeof input.guidance !== "string") invalid("guidance is malformed");
  const guidance = input.guidance.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (guidance.length < 1 || guidance.length > MAX_HUMAN_GUIDANCE_LENGTH) invalid("guidance is malformed");
  if (isDangerousValue(guidance)) invalid("guidance looks like a credential or secret; remove it and resubmit");
  return { escalationId: input.escalationId, idempotencyKey: String(input.idempotencyKey), guidance };
}

function shortText(value: string, max = 320): string {
  return sanitizeSummary(value)?.slice(0, max) ?? "";
}

function pendingView(r: TrustedHumanDecisionRequirement): PendingHumanDecisionView {
  return {
    escalationId: r.request.escalationId,
    taskId: r.request.taskId,
    round: r.request.round,
    cyclesCompleted: r.cyclesCompleted,
    whyNeeded: shortText(r.whyNeeded),
    currentBlocker: {
      failureCode: shortText(r.currentBlocker.failureCode, 80),
      failingCheck: shortText(r.currentBlocker.failingCheck, 80),
      expected: shortText(r.currentBlocker.expected),
      actual: shortText(r.currentBlocker.actual),
    },
    managerRecommendation: shortText(r.managerRecommendation),
    inputRequested: shortText(r.inputRequested),
    fingerprintTrend: r.fingerprintTrend,
    grantsApproval: false,
  };
}

function outcomeView(o: { decisionId: string | null; escalationId: string | null; outcome: string; reason: string; at: IsoTimestamp }): HumanDecisionOutcomeView {
  const stale = o.outcome === "rejected" && /stale|not awaiting|HEAD|another task|branch does not match|no longer matches/.test(o.reason);
  return {
    decisionId: o.decisionId,
    escalationId: o.escalationId,
    outcome: o.outcome === "accepted" ? "accepted" : o.outcome === "duplicate" ? "duplicate" : stale ? "stale" : "rejected",
    reason: shortText(o.reason, 200),
    at: o.at,
  };
}

function taskRequest(value: unknown): TaskRequest {
  const input = strictObject(value, ["taskId"]);
  if (!SAFE_KEY.test(String(input.taskId ?? ""))) invalid("taskId is malformed");
  return { taskId: String(input.taskId) };
}

function taskMutationRequest(value: unknown): TaskMutationRequest {
  const input = strictObject(value, ["taskId", "idempotencyKey"]);
  if (!SAFE_KEY.test(String(input.taskId ?? ""))) invalid("taskId is malformed");
  if (!SAFE_KEY.test(String(input.idempotencyKey ?? "")))
    invalid("idempotencyKey is malformed");
  return {
    taskId: String(input.taskId),
    idempotencyKey: String(input.idempotencyKey),
  };
}

function stringArray(
  value: unknown,
  field: string,
  maximum: number,
  itemMaximum: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum)
    invalid(`${field} is malformed`);
  return value.map((item) => safeString(item, field, itemMaximum));
}

function submitRequest(value: unknown): SubmitTaskRequest {
  const input = strictObject(value, [
    "idempotencyKey",
    "userInstruction",
    "title",
    "priority",
    "expectedScopeHint",
    "productAreaHint",
    "workerPreference",
    "acceptanceCriteria",
    "requiredValidations",
  ]);
  if (!SAFE_KEY.test(String(input.idempotencyKey ?? "")))
    invalid("idempotencyKey is malformed");
  const userInstruction = safeString(input.userInstruction, "userInstruction", 8_000);
  const title =
    input.title === undefined ? undefined : safeString(input.title, "title", 160);
  const priority = input.priority;
  if (
    priority !== undefined &&
    priority !== "critical" &&
    priority !== "high" &&
    priority !== "normal" &&
    priority !== "low"
  )
    invalid("priority is unsupported");
  const workerPreference = input.workerPreference;
  if (
    workerPreference !== undefined &&
    workerPreference !== "claude" &&
    workerPreference !== "codex"
  )
    invalid("workerPreference is unsupported");
  const requiredValidations = input.requiredValidations;
  if (
    requiredValidations !== undefined &&
    (!Array.isArray(requiredValidations) ||
      requiredValidations.length > 2 ||
      requiredValidations.some(
        (v) => v !== "tests" && v !== "typecheck" && v !== "smoke",
      ))
  )
    invalid("requiredValidations is malformed");
  return {
    idempotencyKey: String(input.idempotencyKey),
    userInstruction,
    title,
    priority: priority as SubmitTaskRequest["priority"],
    expectedScopeHint: stringArray(input.expectedScopeHint, "expectedScopeHint", 30, 240),
    productAreaHint:
      input.productAreaHint === undefined
        ? undefined
        : safeString(input.productAreaHint, "productAreaHint", 64),
    workerPreference: workerPreference as SubmitTaskRequest["workerPreference"],
    acceptanceCriteria: stringArray(
      input.acceptanceCriteria,
      "acceptanceCriteria",
      20,
      500,
    ),
    requiredValidations:
      requiredValidations as SubmitTaskRequest["requiredValidations"],
  };
}

function externalStatus(status: NonNullable<ReturnType<AgentRuntimeService["getTaskStatus"]>>): GatewayTaskStatus {
  return {
    taskId: status.taskId,
    status: status.orchestrationStatus,
    taskState: status.taskState,
    priority: status.priority,
    risk: status.risk,
    assignedWorker: status.assignedWorker,
    branch: status.branch,
    headSha: status.headSha,
    prNumber: status.prNumber,
    prState: status.prState,
    qaState: status.qaState,
    repairAttempt: status.repairAttempt,
    waitReason: sanitizeSummary(status.waitReason),
    approvalRequired: status.approval.required,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
  };
}

function sanitizeSummary(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return isDangerousValue(normalized) ? REDACTED : normalized.slice(0, 240);
}

function sanitizeCommitEvidence(value: CommitApprovalEvidence | undefined): CommitApprovalEvidence | undefined {
  if (!value) return undefined;
  const safeList = (items: readonly string[], max: number) =>
    Array.isArray(items) && items.length > 0 && items.length <= max &&
    items.every((item) => typeof item === "string" && item.length > 0 && item.length <= 400 && !/[\u0000-\u001f\u007f]/.test(item) && !isDangerousValue(item));
  if (
    !SAFE_KEY.test(value.taskId) ||
    typeof value.branch !== "string" || value.branch.length > 240 || /[\u0000-\u001f\u007f]/.test(value.branch) ||
    !/^[0-9a-f]{40}$/.test(value.expectedHeadSha) ||
    !safeList(value.changedPaths, 200) || !safeList(value.allowedScope, 200) ||
    !/^[0-9a-f]{64}$/.test(value.gitMetadataDigest) ||
    !Array.isArray(value.contentIdentities) || value.contentIdentities.length !== new Set(value.changedPaths).size ||
    value.contentIdentities.some((id) => !id || !value.changedPaths.includes(id.path) || !["100644", "100755", "120000", "absent"].includes(id.mode) || (id.mode === "absent" ? id.blob !== null : typeof id.blob !== "string" || !/^[0-9a-f]{40}$/.test(id.blob))) ||
    !Array.isArray(value.validations) || value.validations.length > 50 ||
    value.validations.some((v) => !v || typeof v.name !== "string" || v.name.length > 100 || /[\u0000-\u001f\u007f]/.test(v.name) || isDangerousValue(v.name) || typeof v.requested !== "boolean" || typeof v.executed !== "boolean" || typeof v.trusted !== "boolean" || !["passed", "failed", "skipped", "missing"].includes(v.status)) ||
    !Array.isArray(value.acceptance) || value.acceptance.length > 50 ||
    value.acceptance.some((a) => !a || !SAFE_KEY.test(a.criterionId) || !["satisfied", "failed", "unknown"].includes(a.status) || !["validation", "ci_check", "scope", "human", "worker_report"].includes(a.evidenceType) || (a.reference !== null && (typeof a.reference !== "string" || a.reference.length > 100 || /[\u0000-\u001f\u007f]/.test(a.reference) || isDangerousValue(a.reference)))) ||
    !["green", "yellow", "red"].includes(value.observedRisk) ||
    value.managerDecision !== "accepted" ||
    value.action !== COMMIT_PUBLISH_ACTION ||
    value.authorization?.commit !== true || value.authorization.normalPush !== true || value.authorization.openOrReusePr !== true || value.authorization.merge !== false || value.authorization.deploy !== false
  ) throw new GatewayError("unavailable", "commit approval evidence is malformed", 503);
  return normalizeCommitApprovalEvidence(value);
}

function sanitizeRequirement(
  value: PendingApprovalRequirement | null,
  taskId: string,
): PendingApprovalRequirement | null {
  if (value === null) return null;
  if (
    value.taskId !== taskId ||
    !SAFE_KEY.test(value.taskId) ||
    !SAFE_KEY.test(value.approvalRequestId) ||
    (value.kind !== "start" && value.kind !== "commit_publish" && value.kind !== "merge" && value.kind !== "execute_red_action") ||
    (value.phase !== "pre_execution" && value.phase !== "commit_publish" && value.phase !== "post_qa") ||
    (value.risk !== "green" && value.risk !== "yellow" && value.risk !== "red") ||
    value.status !== "pending" ||
    typeof value.action !== "string" ||
    value.action.length < 1 ||
    value.action.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(value.action) ||
    typeof value.bindingTarget !== "string" ||
    value.bindingTarget.length < 1 ||
    value.bindingTarget.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value.bindingTarget) ||
    typeof value.reasonSummary !== "string" ||
    (value.phase === "commit_publish") !== Boolean(value.commitEvidence) ||
    Number.isNaN(Date.parse(value.requestedAt)) ||
    Number.isNaN(Date.parse(value.expiresAt))
  )
    throw new GatewayError("unavailable", "approval requirement is malformed", 503);
  return {
    approvalRequestId: value.approvalRequestId,
    taskId: value.taskId,
    kind: value.kind,
    phase: value.phase,
    risk: value.risk,
    action: value.action,
    bindingTarget: value.bindingTarget,
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    status: "pending",
    // Never relay provider prose: the external surface needs only a short,
    // structured explanation and must not become a raw-log/prompt channel.
    reasonSummary: `${value.phase} approval required for ${value.action}`,
    ...(value.commitEvidence ? { commitEvidence: sanitizeCommitEvidence(value.commitEvidence) } : {}),
  };
}

/** Every bound field comes from trusted Manager state; only guidance and the session identity come from the caller. */
function trustedDecision(current: TrustedHumanDecisionRequirement, decisionId: string, guidance: string, principalId: string): HumanDecisionInput {
  return {
    decisionId,
    escalationId: current.request.escalationId,
    taskId: current.request.taskId,
    branch: current.request.branch,
    expectedHeadSha: current.request.expectedHeadSha,
    kind: "continue_with_guidance",
    guidance,
    decidedBy: principalId,
  };
}

export function createAgentGatewayService(deps: GatewayDependencies): AgentGatewayService {
  const expiry = { ...DEFAULT_EXPIRY, ...deps.expiryPolicy };

  async function principal(
    call: { authentication: Parameters<GatewayAuthenticator["verify"]>[0] },
    capability: GatewayCapability,
    rateAction: GatewayRateAction,
    action: string,
  ): Promise<AuthContext> {
    deps.audit.record({
      event: "gateway_request_received",
      requestId: call.authentication.requestId,
      action,
      outcome: "received",
    });
    const auth = await authenticateAndAuthorize({
      authenticator: deps.authenticator,
      authentication: call.authentication,
      capability,
      audit: deps.audit,
      action,
    });
    let rate: ReturnType<GatewayRateLimiter["consume"]>;
    try {
      rate = deps.rateLimiter.consume({
        principalId: auth.principalId,
        action: rateAction,
        requestId: auth.requestId,
      });
    } catch {
      throw new GatewayError("unavailable", "abuse guard unavailable", 503);
    }
    if (!rate.allowed) {
      deps.audit.record({
        event: "gateway_rate_limited",
        principalId: auth.principalId,
        requestId: auth.requestId,
        action,
        outcome: "rejected",
        reasonCode: "rate_limited",
      });
      throw new GatewayError(
        "rate_limited",
        "request rate limit exceeded",
        429,
        rate.retryAfterSeconds,
      );
    }
    return auth;
  }

  function readStatus(taskId: string): GatewayTaskStatus {
    const status = deps.runtime.getTaskStatus(taskId);
    if (!status) throw new GatewayError("not_found", "task not found", 404);
    return externalStatus(status);
  }

  async function decide(
    call: Parameters<AgentGatewayService["approveTask"]>[0],
    decision: ApprovalDecisionValue,
  ): Promise<ApprovalDecisionResponse> {
    const capability = decision === "approved" ? "approval:grant" : "approval:reject";
    const auth = await principal(call, capability, "approval_mutate", `approval_${decision}`);
    const request = validateApprovalDecisionRequest(call.request);
    const fingerprint = approvalDecisionFingerprint(request, decision);
    const existingDecision = deps.decisions.get(request.idempotencyKey);
    if (existingDecision) {
      if (existingDecision.fingerprint !== fingerprint)
        throw new GatewayError(
          "idempotency_conflict",
          "idempotency key is bound to a different approval decision",
          409,
        );
      const approval = deps.approvals.get(existingDecision.approvalId);
      if (!approval)
        throw new GatewayError("unavailable", "approval decision is unavailable", 503);
      if (!existingDecision.eventEmitted) {
        deps.events.reEvaluateApproval(request.taskId, request.phase, decision);
        deps.decisions.markEventEmitted(request.idempotencyKey);
      }
      return {
        taskId: approval.taskId,
        approvalId: approval.id,
        decision,
        status: approval.status,
        duplicate: true,
      };
    }

    const status = deps.runtime.getTaskStatus(request.taskId);
    if (!status) throw new GatewayError("not_found", "task not found", 404);
    if (isTerminalState(status.taskState))
      throw new GatewayError("conflict", "task is terminal", 409);
    const current = sanitizeRequirement(
      await deps.approvalRequirements.current(request.taskId),
      request.taskId,
    );
    if (!current)
      throw new GatewayError(
        "approval_not_required",
        "task has no pending approval requirement",
        409,
      );
    try {
      assertCurrentBinding(request, current);
    } catch (error) {
      deps.audit.record({
        event: "approval_stale_rejected",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: decision,
        outcome: "rejected",
        reasonCode: "stale_binding",
        approvalKind: request.kind,
        approvalPhase: request.phase,
        bindingReference: bindingReference(request.bindingTarget),
      });
      throw error;
    }
    const now = Date.parse(deps.now());
    const requestedAt = Date.parse(current.requestedAt);
    const requirementExpiry = Date.parse(current.expiresAt);
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(requestedAt) ||
      !Number.isFinite(requirementExpiry) ||
      now >= requirementExpiry ||
      now - requestedAt > expiry.maxRequestAgeMs
    )
      throw new GatewayError(
        "approval_expired",
        "approval request has expired",
        409,
      );

    let approval = deps.approvals.get(current.approvalRequestId);
    if (approval) {
      if (
        approval.taskId !== current.taskId ||
        approval.kind !== current.kind ||
        approval.requestedAction !== current.action ||
        approval.bindingShaOrActionId !== current.bindingTarget
      )
        throw new GatewayError("conflict", "approval identity is already in use", 409);
      if (approval.status !== "pending") {
        const same = approval.status === decision;
        if (!same)
          throw new GatewayError("conflict", "approval already has another decision", 409);
      }
    } else {
      const expiresAt = new Date(
        Math.min(requirementExpiry, now + expiry.approvalLifetimeMs),
      ).toISOString();
      approval = deps.approvals.create({
        id: current.approvalRequestId,
        taskId: current.taskId,
        kind: current.kind,
        requestedAction: current.action,
        bindingShaOrActionId: current.bindingTarget,
        expiresAt,
      });
    }
    if (approval.status === "pending") {
      try {
        approval = deps.approvals.decide(approval.id, {
          status: decision,
          decidedBy: auth.principalId,
          channel: auth.source,
        });
      } catch {
        throw new GatewayError("approval_expired", "approval request has expired", 409);
      }
    }
    try {
      deps.decisions.create({
        idempotencyKey: request.idempotencyKey,
        fingerprint,
        approvalId: approval.id,
        taskId: request.taskId,
        decision,
        eventEmitted: false,
        createdAt: deps.now(),
      });
    } catch {
      // Another identical request may have crossed the async requirement
      // read. Re-read the durable key and resolve deterministically.
      const concurrent = deps.decisions.get(request.idempotencyKey);
      if (!concurrent || concurrent.fingerprint !== fingerprint)
        throw new GatewayError(
          "idempotency_conflict",
          "idempotency key is bound to a different approval decision",
          409,
        );
      const concurrentApproval = deps.approvals.get(concurrent.approvalId);
      if (!concurrentApproval)
        throw new GatewayError("unavailable", "approval decision is unavailable", 503);
      if (!concurrent.eventEmitted) {
        deps.events.reEvaluateApproval(request.taskId, request.phase, decision);
        deps.decisions.markEventEmitted(request.idempotencyKey);
      }
      return {
        taskId: concurrentApproval.taskId,
        approvalId: concurrentApproval.id,
        decision,
        status: concurrentApproval.status,
        duplicate: true,
      };
    }
    deps.events.reEvaluateApproval(request.taskId, request.phase, decision);
    deps.decisions.markEventEmitted(request.idempotencyKey);
    deps.audit.record({
      event: decision === "approved" ? "approval_granted" : "approval_rejected",
      principalId: auth.principalId,
      taskId: request.taskId,
      requestId: auth.requestId,
      action: request.action,
      outcome: decision,
      approvalKind: request.kind,
      approvalPhase: request.phase,
      bindingReference: bindingReference(request.bindingTarget),
    });
    return {
      taskId: request.taskId,
      approvalId: approval.id,
      decision,
      status: approval.status,
      duplicate: false,
    };
  }

  return {
    async submitTask(call) {
      const auth = await principal(call, "task:submit", "task_submit", "submit_task");
      const request = submitRequest(call.request);
      const intake: TaskIntakeRequest = {
        ...request,
        requestId: auth.requestId,
        source: {
          type: "gateway",
          requesterId: auth.principalId,
          reference: auth.source,
        },
        submittedAt: deps.now(),
      };
      deps.audit.record({
        event: "task_submit_requested",
        principalId: auth.principalId,
        requestId: auth.requestId,
        action: "submit_task",
        outcome: "requested",
      });
      const result = await deps.runtime.submitTask(intake);
      if (result.outcome === "needs_clarification")
        throw new GatewayError("invalid_request", "task needs clarification", 400);
      if (result.outcome === "rejected") {
        const code = result.reasonCode === "idempotency_conflict"
          ? "idempotency_conflict"
          : "invalid_request";
        throw new GatewayError(
          code,
          result.reason,
          code === "idempotency_conflict" ? 409 : 400,
        );
      }
      return {
        taskId: result.taskId,
        status: externalStatus(result.status),
        duplicate: result.outcome === "duplicate",
      };
    },

    async getTaskStatus(call) {
      const auth = await principal(call, "task:read", "task_read", "get_task_status");
      const request = taskRequest(call.request);
      const status = readStatus(request.taskId);
      deps.audit.record({
        event: "task_status_read",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: "get_task_status",
        outcome: "found",
      });
      return status;
    },

    async pauseTask(call) {
      const auth = await principal(call, "task:pause", "task_pause", "pause_task");
      const request = taskMutationRequest(call.request);
      readStatus(request.taskId);
      const status = deps.runtime.pauseTask(request.taskId);
      if (!status) throw new GatewayError("not_found", "task not found", 404);
      deps.events.taskPauseRequested(request.taskId);
      deps.audit.record({
        event: "task_pause_requested",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: "pause_task",
        outcome: "requested",
      });
      return externalStatus(status);
    },

    async cancelTask(call) {
      const auth = await principal(call, "task:cancel", "task_cancel", "cancel_task");
      const request = taskMutationRequest(call.request);
      readStatus(request.taskId);
      const status = deps.runtime.cancelTask(request.taskId);
      if (!status) throw new GatewayError("not_found", "task not found", 404);
      deps.events.taskCancelRequested(request.taskId);
      deps.audit.record({
        event: "task_cancel_requested",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: "cancel_task",
        outcome: "requested",
      });
      return externalStatus(status);
    },

    async getPendingApproval(call) {
      const auth = await principal(call, "approval:read", "approval_read", "get_pending_approval");
      const request = taskRequest(call.request);
      const status = deps.runtime.getTaskStatus(request.taskId);
      if (!status) throw new GatewayError("not_found", "task not found", 404);
      const current = sanitizeRequirement(
        await deps.approvalRequirements.current(request.taskId),
        request.taskId,
      );
      deps.audit.record({
        event: "approval_viewed",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: "get_pending_approval",
        outcome: current ? "pending" : "none",
        approvalKind: current?.kind,
        approvalPhase: current?.phase,
        bindingReference: current
          ? bindingReference(current.bindingTarget)
          : undefined,
      });
      if (current) return { result: "pending", approval: current };
      return {
        result: status.approval.required ? "none" : "not_required",
        taskId: request.taskId,
      };
    },

    approveTask: (call) => decide(call, "approved"),
    rejectTask: (call) => decide(call, "rejected"),

    async getHumanDecision(call): Promise<HumanDecisionStatusResponse> {
      const auth = await principal(call, "human_decision:read", "human_decision_read", "get_human_decision");
      const request = taskRequest(call.request);
      const reader = deps.humanDecisionRequirements;
      if (!reader) throw new GatewayError("unavailable", "human decisions are unavailable", 503);
      if (!deps.runtime.getTaskStatus(request.taskId)) throw new GatewayError("not_found", "task not found", 404);
      const current = reader.current(request.taskId);
      if (current && current.request.taskId !== request.taskId) throw new GatewayError("unavailable", "human decision requirement is malformed", 503);
      const last = reader.outcomes(request.taskId).at(-1) ?? null;
      deps.audit.record({
        event: "human_decision_viewed",
        principalId: auth.principalId,
        taskId: request.taskId,
        requestId: auth.requestId,
        action: "get_human_decision",
        outcome: current ? "pending" : "none",
      });
      return { taskId: request.taskId, pending: current ? pendingView(current) : null, lastOutcome: last ? outcomeView(last) : null };
    },

    async submitHumanDecision(call): Promise<HumanDecisionSubmitResponse> {
      const auth = await principal(call, "human_decision:submit", "human_decision_mutate", "submit_human_decision");
      const reject = (code: GatewayError["code"], message: string, status: number, reasonCode: string, taskId?: string): never => {
        deps.audit.record({ event: "human_decision_rejected", principalId: auth.principalId, taskId, requestId: auth.requestId, action: "submit_human_decision", outcome: "rejected", reasonCode });
        throw new GatewayError(code, message, status);
      };
      // A decision must come from a person, never from a service credential.
      if (auth.principalType === "service") reject("forbidden", "human decisions require a human principal", 403, "service_principal");
      const reader = deps.humanDecisionRequirements;
      const submissions = deps.humanDecisionSubmissions;
      if (!reader || !submissions) throw new GatewayError("unavailable", "human decisions are unavailable", 503);
      const request = humanDecisionRequest(call.request);
      const taskId = (ESCALATION_ID.exec(request.escalationId) as RegExpExecArray)[1];
      const fingerprint = fingerprintRequest({ principalId: auth.principalId, escalationId: request.escalationId, guidance: request.guidance });
      const decisionId = `hd-${fingerprintRequest({ principalId: auth.principalId, idempotencyKey: request.idempotencyKey })}`;

      const existing = submissions.get(request.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.principalId !== auth.principalId)
          reject("idempotency_conflict", "idempotency key is bound to a different human decision", 409, "idempotency_conflict", existing.taskId);
        // Duplicate delivery: never a second event once one was emitted.
        if (!existing.eventEmitted) {
          const current = reader.current(existing.taskId);
          if (current && current.request.escalationId === existing.escalationId) {
            deps.events.humanDecisionSubmitted(existing.taskId, trustedDecision(current, existing.decisionId, request.guidance, auth.principalId));
          }
          submissions.markEventEmitted(request.idempotencyKey);
        }
        return { taskId: existing.taskId, escalationId: existing.escalationId, decisionId: existing.decisionId, result: "submitted", duplicate: true };
      }

      const status = deps.runtime.getTaskStatus(taskId);
      if (!status) reject("not_found", "escalation not found", 404, "unknown_escalation");
      const current = reader.current(taskId);
      if (!current || isTerminalState((status as NonNullable<typeof status>).taskState))
        reject("conflict", "escalation is closed or no human decision is pending", 409, "escalation_closed", taskId);
      const open = current as TrustedHumanDecisionRequirement;
      if (open.request.taskId !== taskId) throw new GatewayError("unavailable", "human decision requirement is malformed", 503);
      if (open.request.escalationId !== request.escalationId)
        reject("stale_binding", "escalation is stale; a newer human decision request is open", 409, "stale_escalation", taskId);
      // Only the task's requester or an operator may decide.
      if (auth.principalType !== "operator" && (open.requesterId === null || open.requesterId !== auth.principalId))
        reject("forbidden", "principal may not decide this escalation", 403, "wrong_user", taskId);

      try {
        submissions.create({ idempotencyKey: request.idempotencyKey, fingerprint, principalId: auth.principalId, taskId, escalationId: request.escalationId, decisionId, eventEmitted: false, createdAt: deps.now() });
      } catch {
        const concurrent = submissions.get(request.idempotencyKey);
        if (!concurrent || concurrent.fingerprint !== fingerprint)
          reject("idempotency_conflict", "idempotency key is bound to a different human decision", 409, "idempotency_conflict", taskId);
        return { taskId, escalationId: request.escalationId, decisionId, result: "submitted", duplicate: true };
      }
      deps.events.humanDecisionSubmitted(taskId, trustedDecision(open, decisionId, request.guidance, auth.principalId));
      submissions.markEventEmitted(request.idempotencyKey);
      deps.audit.record({
        event: "human_decision_submitted",
        principalId: auth.principalId,
        taskId,
        requestId: auth.requestId,
        action: "submit_human_decision",
        outcome: "submitted",
        bindingReference: bindingReference(request.escalationId),
      });
      return { taskId, escalationId: request.escalationId, decisionId, result: "submitted", duplicate: false };
    },
  };
}

export type { PendingApprovalRequirement, ApprovalDecisionRequest };
