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
} from "./types";

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

export function createFakeGatewayEvents(): GatewayControlEventPort & {
  events: { type: string; taskId: string; phase?: string; decision?: string }[];
} {
  const events: { type: string; taskId: string; phase?: string; decision?: string }[] = [];
  return {
    events,
    taskSubmitted: (taskId) => events.push({ type: "task_submitted", taskId }),
    taskPauseRequested: (taskId) => events.push({ type: "task_pause_requested", taskId }),
    taskCancelRequested: (taskId) => events.push({ type: "task_cancel_requested", taskId }),
    reEvaluateApproval: (taskId, phase, decision) =>
      events.push({ type: "task_re_evaluate_requested", taskId, phase, decision }),
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
