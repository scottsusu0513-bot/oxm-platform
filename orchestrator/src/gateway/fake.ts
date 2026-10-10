import type { IsoTimestamp } from "../store/types";
import type {
  AuthContext,
  GatewayAuditEvent,
  GatewayAuditSink,
  GatewayAuthenticator,
  GatewayCapability,
  GatewayControlEventPort,
  GatewayDecisionRepository,
  GatewayRateAction,
  GatewayRateLimiter,
  PersistedGatewayDecision,
  GatewayHumanDecisionRepository,
  PersistedHumanDecisionSubmission,
  GatewayInterpretationRepository,
  PersistedInterpretation,
} from "./types";
import type { HumanDecisionInput } from "../manager/types";
import type { ReplayDuplicatePolicy } from "../persistence/journal";

export function createFakeAuthenticator(
  principals: Readonly<Record<string, Omit<AuthContext, "requestId">>>,
): GatewayAuthenticator {
  return {
    async verify(input) {
      const token =
        input.credentials && typeof input.credentials === "object"
          ? (input.credentials as { token?: unknown }).token
          : null;
      const principal = typeof token === "string" ? principals[token] : null;
      if (!principal) throw new Error("invalid credential");
      return { ...structuredClone(principal), requestId: input.requestId };
    },
  };
}

export function fakePrincipal(input: {
  principalId: string;
  capabilities: readonly GatewayCapability[];
  now?: IsoTimestamp;
}): Omit<AuthContext, "requestId"> {
  return {
    principalId: input.principalId,
    principalType: "operator",
    authenticated: true,
    roles: [],
    capabilities: [...input.capabilities],
    source: "test",
    authenticatedAt: input.now ?? "2026-10-05T00:00:00.000Z",
  };
}

export function createInMemoryGatewayDecisionRepository(
  initial: readonly PersistedGatewayDecision[] = [],
): GatewayDecisionRepository {
  const rows = new Map(initial.map((row) => [row.idempotencyKey, structuredClone(row)]));
  return {
    get(key) {
      const row = rows.get(key);
      return row ? structuredClone(row) : null;
    },
    create(record) {
      if (rows.has(record.idempotencyKey))
        throw new Error("gateway decision idempotency key already exists");
      rows.set(record.idempotencyKey, structuredClone(record));
      return structuredClone(record);
    },
    markEventEmitted(key) {
      const row = rows.get(key);
      if (!row) throw new Error("gateway decision not found");
      const next = { ...row, eventEmitted: true };
      rows.set(key, next);
      return structuredClone(next);
    },
  };
}

export function createFakeGatewayAudit(): GatewayAuditSink & {
  events: GatewayAuditEvent[];
} {
  const events: GatewayAuditEvent[] = [];
  return {
    events,
    record(event) {
      events.push(structuredClone(event));
    },
  };
}

export function createInMemoryHumanDecisionRepository(): GatewayHumanDecisionRepository {
  const rows = new Map<string, PersistedHumanDecisionSubmission>();
  return {
    get: (key) => (rows.has(key) ? structuredClone(rows.get(key)!) : null),
    create(record) {
      if (rows.has(record.idempotencyKey)) throw new Error("human decision idempotency key already exists");
      rows.set(record.idempotencyKey, structuredClone(record));
      return structuredClone(record);
    },
    markEventEmitted(key) {
      const row = rows.get(key);
      if (!row) throw new Error("human decision submission not found");
      const next = { ...row, eventEmitted: true };
      rows.set(key, next);
      return structuredClone(next);
    },
  };
}

export function createFakeGatewayEvents(): GatewayControlEventPort & {
  events: { type: string; taskId: string; phase?: string; decision?: string; humanDecision?: HumanDecisionInput }[];
} {
  const events: { type: string; taskId: string; phase?: string; decision?: string; humanDecision?: HumanDecisionInput }[] = [];
  return {
    events,
    taskSubmitted: (taskId) => events.push({ type: "task_submitted", taskId }),
    taskPauseRequested: (taskId) => events.push({ type: "task_pause_requested", taskId }),
    taskCancelRequested: (taskId) => events.push({ type: "task_cancel_requested", taskId }),
    reEvaluateApproval: (taskId, phase, decision) =>
      events.push({ type: "task_re_evaluate_requested", taskId, phase, decision }),
    humanDecisionSubmitted: (taskId, humanDecision) =>
      events.push({ type: "human_decision_submitted", taskId, humanDecision: structuredClone(humanDecision) }),
    publishRevisionRequested: (taskId, humanDecision) =>
      events.push({ type: "publish_revision_requested", taskId, humanDecision: structuredClone(humanDecision) }),
  };
}

export function createFakeRateLimiter(
  denied: readonly GatewayRateAction[] = [],
): GatewayRateLimiter {
  return {
    consume(input) {
      return denied.includes(input.action)
        ? { allowed: false, retryAfterSeconds: 60 }
        : { allowed: true };
    },
  };
}

export function createInMemoryInterpretationRepository(): GatewayInterpretationRepository {
  const rows = new Map<string, PersistedInterpretation>();
  return {
    get: (id) => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    create(record) {
      if (rows.has(record.interpretationId)) throw new Error("interpretation already exists");
      rows.set(record.interpretationId, structuredClone(record));
      return structuredClone(record);
    },
  };
}

/**
 * Replay policy for historical duplicate interpretation creates (two runtimes
 * once wrote one journal). Only the runtime-local `createdAt` is excluded: the
 * message identity (fingerprint, principal, request) and the decision must match.
 */
export const INTERPRETATION_REPLAY_DUPLICATE_POLICY: ReplayDuplicatePolicy<GatewayInterpretationRepository> = {
  method: "create",
  keyOf(args) {
    const record = args[0] as { interpretationId?: unknown } | null | undefined;
    return args.length === 1 && record && typeof record === "object" && typeof record.interpretationId === "string" && record.interpretationId ? record.interpretationId : null;
  },
  existing: (repo, key) => repo.get(key),
  ignoredFields: ["createdAt"],
};
