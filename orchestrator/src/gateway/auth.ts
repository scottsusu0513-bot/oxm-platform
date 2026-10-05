import { GatewayError } from "./errors";
import type {
  AuthContext,
  GatewayAuditSink,
  GatewayAuthenticationInput,
  GatewayAuthenticator,
  GatewayCapability,
} from "./types";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function authenticateAndAuthorize(input: {
  authenticator: GatewayAuthenticator;
  authentication: GatewayAuthenticationInput;
  capability: GatewayCapability;
  audit: GatewayAuditSink;
  action: string;
}): Promise<AuthContext> {
  let principal: AuthContext;
  try {
    principal = await input.authenticator.verify(input.authentication);
  } catch {
    input.audit.record({
      event: "gateway_auth_failed",
      requestId: input.authentication.requestId,
      action: input.action,
      outcome: "rejected",
      reasonCode: "unauthenticated",
    });
    throw new GatewayError("unauthenticated", "authentication failed", 401);
  }
  if (
    !principal.authenticated ||
    !SAFE_ID.test(principal.principalId) ||
    principal.requestId !== input.authentication.requestId ||
    Number.isNaN(Date.parse(principal.authenticatedAt))
  ) {
    input.audit.record({
      event: "gateway_auth_failed",
      requestId: input.authentication.requestId,
      action: input.action,
      outcome: "rejected",
      reasonCode: "unauthenticated",
    });
    throw new GatewayError("unauthenticated", "authentication failed", 401);
  }
  if (!principal.capabilities.includes(input.capability)) {
    input.audit.record({
      event: "gateway_forbidden",
      principalId: principal.principalId,
      requestId: principal.requestId,
      action: input.action,
      outcome: "rejected",
      reasonCode: "forbidden",
    });
    throw new GatewayError("forbidden", "principal lacks the required capability", 403);
  }
  return principal;
}
