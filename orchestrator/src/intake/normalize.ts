import { normalizePathSet } from "../branches/overlap";
import { TASK_CATEGORIES, TASK_CREATING_INTENTS, RISK_LEVELS, WORKER_KINDS, modeForIntent, type TaskGoal, type TaskMode } from "../domain/types";
import { PRIORITY_CLASSES, PRIORITY_SIGNALS } from "../scheduler/types";
import { isDangerousValue } from "../store/sanitize";
import { REQUIRED_VALIDATIONS } from "../workers/types";
import { validatePlannerGoal } from "../planning/structured";
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
  "goal",
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

/** Criteria every interpreted goal of this intent carries regardless of the planner. */
const FIXED_GOAL_CRITERIA: Readonly<Record<TaskGoal["intent"], readonly string[]>> = {
  investigate_or_answer: [
    "The owner's question is answered directly",
    "The answer is supported by cited repository evidence (file paths)",
    "Uncertainty and unverified assumptions are stated explicitly",
  ],
  audit_or_review: [
    "Every requested area was actually inspected",
    "Each finding is supported by cited repository evidence (file paths)",
    "Uncertainty and unverified assumptions are stated explicitly",
  ],
  change_code: ["Existing behaviour outside the requested change is preserved"],
  audit_and_fix: [
    "Every requested audit area was inspected and each finding is reported with cited repository evidence",
    "Every code change corresponds to a reported, evidence-backed finding; no unrelated code is changed",
    "Each supported finding within the requested scope is fixed",
  ],
};

function checkGoal(value: unknown): { ok: true; goal: TaskGoal; criteria: string[]; riskObservations: string[] } | { ok: false; reason: string } {
  const g = value as Record<string, unknown> | null;
  if (!g || typeof g !== "object" || Array.isArray(g)) return { ok: false, reason: "goal must be an object" };
  if (Object.keys(g).some((k) => !["intent", "originalRequest", "interpretedObjective", "criteria", "riskObservations", "workArea", "group"].includes(k))) return { ok: false, reason: "goal contains an unsupported field" };
  const group = g.group as { id?: unknown; parts?: unknown } | undefined;
  if (
    group !== undefined &&
    (!group ||
      typeof group !== "object" ||
      typeof group.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(group.id) ||
      !Array.isArray(group.parts) ||
      group.parts.length < 2 ||
      group.parts.length > 4 ||
      !group.parts.every((p) => p && typeof p === "object" && (p.area === "programming" || p.area === "visual") && typeof p.objective === "string" && p.objective.length <= 2_000 && !isDangerousValue(p.objective)) ||
      !group.parts.some((p: { area: string }) => p.area === g.workArea))
  )
    return { ok: false, reason: "goal group is malformed" };
  if (g.workArea !== undefined && g.workArea !== "programming" && g.workArea !== "visual") return { ok: false, reason: "goal work area is unsupported" };
  if (!(TASK_CREATING_INTENTS as readonly string[]).includes(String(g.intent))) return { ok: false, reason: "goal intent does not create a task" };
  // The owner's own words keep the raw-input checks; planner-derived fields use the structured planner validator.
  const originalRequest = typeof g.originalRequest === "string" ? normalizeObjective(g.originalRequest) : "";
  if (!originalRequest || originalRequest.length > 2_000 || isDangerousValue(originalRequest)) return { ok: false, reason: "goal original request is missing, too long, or credential-like" };
  const planned = validatePlannerGoal({ interpretedObjective: g.interpretedObjective, criteria: g.criteria, riskObservations: g.riskObservations ?? [] });
  if (!planned.ok) return { ok: false, reason: `goal ${planned.reason}` };
  return {
    ok: true,
    goal: {
      intent: g.intent as TaskGoal["intent"],
      originalRequest,
      interpretedObjective: planned.interpretedObjective,
      ...(g.workArea ? { workArea: g.workArea as "programming" | "visual" } : {}),
      ...(group ? { group: { id: group.id as string, parts: (group.parts as { area: "programming" | "visual"; objective: string }[]).map((p) => ({ area: p.area, objective: p.objective })) } } : {}),
    },
    criteria: planned.criteria,
    riskObservations: planned.riskObservations,
  };
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
  let mode: TaskMode = "change";
  let goal: TaskGoal | undefined;
  let riskObservations: string[] = [];
  let acceptanceCriteria: PreparedIntake["acceptanceCriteria"];
  if (request.goal !== undefined) {
    const g = checkGoal(request.goal);
    if (!g.ok) return reject("invalid_goal", g.reason);
    if (criteria.length) return reject("invalid_goal", "an interpreted goal carries its own criteria");
    mode = modeForIntent(g.goal.intent);
    goal = { intent: g.goal.intent, originalRequest: g.goal.originalRequest, interpretedObjective: g.goal.interpretedObjective, ...(g.goal.workArea ? { workArea: g.goal.workArea } : {}), ...(g.goal.group ? { group: g.goal.group } : {}) };
    riskObservations = g.riskObservations;
    // Planner criteria first, then fixed criteria the planner can never drop or weaken.
    acceptanceCriteria = [
      ...g.criteria.map((text) => ({ text, kind: "goal" as const })),
      ...FIXED_GOAL_CRITERIA[g.goal.intent].map((text) => ({ text, kind: "goal" as const })),
      { text: "All required validations pass on the final working tree", kind: "technical" as const },
    ].map((c, i) => ({ id: `AC-${i + 1}`, ...c }));
  } else {
    acceptanceCriteria = (
      criteria.length
        ? criteria
        : [`The requested outcome is observable: ${title}`]
    ).map((text, i) => ({ id: `AC-${i + 1}`, text }));
  }
  if (mode === "read_only" && request.requiredValidations !== undefined)
    return reject("invalid_validation", "read-only tasks use the fixed read-only validation set");
  const requiredValidations = Array.from(
    new Set(mode === "read_only" ? (["typecheck"] as const) : (request.requiredValidations ?? REQUIRED_VALIDATIONS))
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
    mode,
    ...(goal ? { goal } : {}),
    ...(riskObservations.length ? { riskObservations } : {}),
  };
  value.fingerprint = fingerprintRequest({
    mode: value.mode,
    goal: value.goal ?? null,
    riskObservations: value.riskObservations ?? [],
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
