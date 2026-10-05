import { normalizePathSet } from "../branches/overlap";
import { TASK_CATEGORIES, RISK_LEVELS, WORKER_KINDS } from "../domain/types";
import { PRIORITY_CLASSES, PRIORITY_SIGNALS } from "../scheduler/types";
import { isDangerousValue } from "../store/sanitize";
import { REQUIRED_VALIDATIONS } from "../workers/types";
import {
  INTAKE_LIMITS,
  type PreparedIntake,
  type TaskIntakeRequest,
  type ValidationResult,
} from "./types";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE = /^[a-z][a-z0-9_-]{0,39}$/;
const PRODUCT_AREA = /^[a-z][a-z0-9_-]{0,63}$/;
const REQUEST_KEYS = new Set([
  "requestId",
  "idempotencyKey",
  "userInstruction",
  "title",
  "priority",
  "expectedScopeHint",
  "productAreaHint",
  "categoryHint",
  "riskHint",
  "workerPreference",
  "acceptanceCriteria",
  "requiredValidations",
  "source",
  "submittedAt",
  "prioritySignals",
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable non-cryptographic identity; no secret material leaves intake. */
export function fingerprintRequest(value: unknown): string {
  const text = canonical(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export function normalizeObjective(input: string): string {
  return input
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function inferredTitle(instruction: string): string {
  const first = instruction.split("\n", 1)[0].replace(/^[-#*\s]+/, "");
  return (
    (first.length > INTAKE_LIMITS.title
      ? `${first.slice(0, INTAKE_LIMITS.title - 1)}…`
      : first) || "Engineering task"
  );
}

export function validateAndNormalizeRequest(
  request: TaskIntakeRequest
): ValidationResult {
  const rawId = request?.idempotencyKey ?? request?.requestId ?? "";
  const requestId =
    typeof request?.requestId === "string" && request.requestId
      ? request.requestId
      : String(rawId).slice(0, INTAKE_LIMITS.idempotencyKey);
  const reject = (reasonCode: string, reason: string): ValidationResult => ({
    ok: false,
    reasonCode,
    reason,
    requestId,
  });
  if (!request || typeof request !== "object")
    return reject("invalid_request", "request must be an object");
  const unknown = Object.keys(request).filter(key => !REQUEST_KEYS.has(key));
  if (unknown.length)
    return reject(
      "unknown_field",
      `unsupported request field: ${unknown.sort()[0]}`
    );
  if (!SAFE_KEY.test(rawId))
    return reject(
      "invalid_idempotency_key",
      "a safe requestId or idempotencyKey is required"
    );
  if (request.requestId !== undefined && !SAFE_KEY.test(request.requestId))
    return reject("invalid_request_id", "requestId is malformed");
  if (typeof request.userInstruction !== "string")
    return reject("invalid_instruction", "userInstruction must be a string");
  const instruction = normalizeObjective(request.userInstruction);
  if (!instruction || instruction.length > INTAKE_LIMITS.instruction)
    return reject(
      "invalid_instruction",
      `userInstruction must be 1-${INTAKE_LIMITS.instruction} characters`
    );
  if (
    isDangerousValue(instruction) ||
    /\b(?:password|token|secret|api[_ -]?key)\s*[:=]\s*\S+/i.test(instruction)
  )
    return reject(
      "secret_detected",
      "request appears to contain a raw credential"
    );
  if (
    !request.source ||
    !SOURCE.test(request.source.type) ||
    !SAFE_KEY.test(request.source.requesterId)
  )
    return reject(
      "invalid_source",
      "source type and opaque requesterId are required"
    );
  if (
    Object.keys(request.source).some(
      key => !["type", "requesterId", "reference"].includes(key)
    )
  )
    return reject("invalid_source", "source contains an unsupported field");
  if (
    request.source.reference !== undefined &&
    (typeof request.source.reference !== "string" ||
      request.source.reference.length > INTAKE_LIMITS.sourceReference)
  )
    return reject("invalid_source", "source reference is too long");
  if (Number.isNaN(Date.parse(request.submittedAt)))
    return reject("invalid_timestamp", "submittedAt must be an ISO timestamp");
  if (
    request.title !== undefined &&
    (typeof request.title !== "string" ||
      !request.title.trim() ||
      request.title.length > INTAKE_LIMITS.title)
  )
    return reject(
      "invalid_title",
      `title must be 1-${INTAKE_LIMITS.title} characters`
    );
  if (
    request.categoryHint !== undefined &&
    !TASK_CATEGORIES.includes(request.categoryHint)
  )
    return reject("invalid_category", "categoryHint is unsupported");
  if (request.riskHint !== undefined && !RISK_LEVELS.includes(request.riskHint))
    return reject("invalid_risk", "riskHint is unsupported");
  if (
    request.workerPreference !== undefined &&
    !WORKER_KINDS.includes(request.workerPreference)
  )
    return reject("invalid_worker", "workerPreference is unsupported");
  if (
    request.priority !== undefined &&
    !PRIORITY_CLASSES.includes(request.priority)
  )
    return reject("invalid_priority", "priority is unsupported");
  if (
    request.prioritySignals !== undefined &&
    !Array.isArray(request.prioritySignals)
  )
    return reject(
      "invalid_priority_signal",
      "prioritySignals must be an array"
    );
  if ((request.prioritySignals ?? []).some(s => !PRIORITY_SIGNALS.includes(s)))
    return reject(
      "invalid_priority_signal",
      "prioritySignals contains an unsupported value"
    );
  if (
    request.acceptanceCriteria !== undefined &&
    !Array.isArray(request.acceptanceCriteria)
  )
    return reject("invalid_acceptance", "acceptanceCriteria must be an array");
  if ((request.acceptanceCriteria?.length ?? 0) > INTAKE_LIMITS.criteria)
    return reject("invalid_acceptance", "too many acceptance criteria");
  const criteria = (request.acceptanceCriteria ?? []).map(c =>
    typeof c === "string" ? normalizeObjective(c) : ""
  );
  if (
    criteria.some(
      c => !c || c.length > INTAKE_LIMITS.criterion || isDangerousValue(c)
    )
  )
    return reject(
      "invalid_acceptance",
      "acceptance criteria must be short, non-secret outcome statements"
    );
  if (
    criteria.some(c =>
      /\b(useEffect|function|class|method)\b|\b[A-Za-z0-9_-]+\.(?:tsx?|jsx?|py)\b/.test(
        c
      )
    )
  )
    return reject(
      "implementation_acceptance",
      "acceptance criteria must describe observable outcomes, not implementation steps"
    );
  if (
    request.requiredValidations !== undefined &&
    !Array.isArray(request.requiredValidations)
  )
    return reject("invalid_validation", "requiredValidations must be an array");
  if (
    (request.requiredValidations ?? []).some(
      v => !REQUIRED_VALIDATIONS.includes(v)
    )
  )
    return reject(
      "invalid_validation",
      "requiredValidations contains an unsupported value"
    );
  if (
    request.expectedScopeHint !== undefined &&
    !Array.isArray(request.expectedScopeHint)
  )
    return reject("invalid_scope", "expectedScopeHint must be an array");
  if ((request.expectedScopeHint?.length ?? 0) > INTAKE_LIMITS.scopePaths)
    return reject("invalid_scope", "too many expected scope paths");
  if (
    request.productAreaHint !== undefined &&
    !PRODUCT_AREA.test(request.productAreaHint)
  )
    return reject("invalid_product_area", "productAreaHint is malformed");
  const paths = normalizePathSet(request.expectedScopeHint ?? []);
  if (!paths.ok) return reject("unsafe_scope", paths.reason);
  const title = normalizeObjective(request.title ?? inferredTitle(instruction));
  const acceptanceCriteria = (
    criteria.length
      ? criteria
      : [`The requested outcome is observable: ${title}`]
  ).map((text, i) => ({ id: `AC-${i + 1}`, text }));
  const requiredValidations = Array.from(
    new Set(request.requiredValidations ?? REQUIRED_VALIDATIONS)
  );
  const prioritySignals = Array.from(new Set(request.prioritySignals ?? []));
  const value: PreparedIntake = {
    requestId: request.requestId ?? rawId,
    idempotencyKey: rawId,
    fingerprint: "",
    instruction,
    title,
    source: { ...request.source },
    submittedAt: new Date(request.submittedAt).toISOString(),
    categoryHint: request.categoryHint,
    riskHint: request.riskHint,
    workerPreference: request.workerPreference,
    requestedPriority: request.priority,
    prioritySignals,
    acceptanceCriteria,
    requiredValidations,
    expectedScopeHint: paths.paths,
    productAreaHint: request.productAreaHint,
  };
  value.fingerprint = fingerprintRequest({
    instruction: value.instruction,
    title: value.title,
    source: value.source,
    categoryHint: value.categoryHint,
    riskHint: value.riskHint,
    workerPreference: value.workerPreference,
    requestedPriority: value.requestedPriority,
    prioritySignals: value.prioritySignals,
    acceptanceCriteria: value.acceptanceCriteria,
    requiredValidations: value.requiredValidations,
    expectedScopeHint: value.expectedScopeHint,
    productAreaHint: value.productAreaHint,
  });
  return { ok: true, value };
}
