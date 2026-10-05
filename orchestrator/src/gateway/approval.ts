import type { ApprovalPhase } from "../domain/taskState";
import type { ApprovalKind } from "../store/types";
import { fingerprintRequest } from "../intake/normalize";
import { GatewayError } from "./errors";
import type {
  ApprovalDecisionRequest,
  PendingApprovalRequirement,
} from "./types";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function approvalDecisionFingerprint(
  request: ApprovalDecisionRequest,
  decision: "approved" | "rejected",
): string {
  return fingerprintRequest({
    approvalRequestId: request.approvalRequestId,
    taskId: request.taskId,
    kind: request.kind,
    phase: request.phase,
    action: request.action,
    bindingTarget: request.bindingTarget,
    decision,
  });
}

export function bindingReference(binding: string): string {
  return `ref:${fingerprintRequest(binding)}`;
}

export function assertCurrentBinding(
  request: ApprovalDecisionRequest,
  current: PendingApprovalRequirement,
): void {
  if (
    request.taskId !== current.taskId ||
    request.approvalRequestId !== current.approvalRequestId ||
    request.kind !== current.kind ||
    request.phase !== current.phase ||
    request.action !== current.action ||
    request.bindingTarget !== current.bindingTarget
  ) {
    throw new GatewayError(
      "stale_binding",
      "approval request no longer matches the current protected action",
      409,
    );
  }
}

export function validateApprovalDecisionRequest(
  value: unknown,
): ApprovalDecisionRequest {
  const input = strictObject(value, [
    "taskId",
    "idempotencyKey",
    "approvalRequestId",
    "kind",
    "phase",
    "action",
    "bindingTarget",
  ]);
  for (const key of ["taskId", "idempotencyKey", "approvalRequestId"] as const) {
    if (!SAFE_KEY.test(String(input[key] ?? ""))) invalid(`${key} is malformed`);
  }
  const kind = input.kind;
  if (kind !== "start" && kind !== "merge" && kind !== "execute_red_action")
    invalid("kind is unsupported");
  const phase = input.phase;
  if (phase !== "pre_execution" && phase !== "post_qa")
    invalid("phase is unsupported");
  const action = safeString(input.action, "action", 120);
  const bindingTarget = safeString(input.bindingTarget, "bindingTarget", 256);
  return {
    taskId: String(input.taskId),
    idempotencyKey: String(input.idempotencyKey),
    approvalRequestId: String(input.approvalRequestId),
    kind: kind as ApprovalKind,
    phase: phase as ApprovalPhase,
    action,
    bindingTarget,
  };
}

export function strictObject(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("request must be an object");
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) invalid(`unsupported request field: ${extra}`);
  return input;
}

export function safeString(value: unknown, field: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    invalid(`${field} is malformed`);
  return value;
}

export function invalid(message: string): never {
  throw new GatewayError("invalid_request", message, 400);
}
