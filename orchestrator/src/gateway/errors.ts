export const GATEWAY_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "invalid_request",
  "not_found",
  "conflict",
  "stale_binding",
  "approval_not_required",
  "approval_expired",
  "idempotency_conflict",
  "rate_limited",
  "unavailable",
  "internal_error",
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function safeGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError
    ? error
    : new GatewayError("internal_error", "gateway request failed", 500);
}
