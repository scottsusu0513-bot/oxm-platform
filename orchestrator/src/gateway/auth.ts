import { isValidPrincipalId } from "../domain/types";
import { GatewayError } from "./errors";
import type {
  AuthContext,
  GatewayAuditSink,
  GatewayAuthenticationInput,
  GatewayAuthenticator,
  GatewayCapability,
} from "./types";

export async function authenticateAndAuthorize(input: {
  authenticator: GatewayAuthenticator;
  authentication: GatewayAuthenticationInput;
  /** One capability, or any one of several (kind-scoped alternatives). */
  capability: GatewayCapability | readonly GatewayCapability[];
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
    !isValidPrincipalId(principal.principalId) ||
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
  const required = typeof input.capability === "string" ? [input.capability] : input.capability;
  if (!required.some((c) => principal.capabilities.includes(c))) {
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
