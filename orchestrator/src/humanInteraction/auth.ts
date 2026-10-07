import { isValidPrincipalId } from "../domain/types";
import type { AuthContext, GatewayAuthenticationInput, GatewayAuthenticator, GatewayCapability } from "../gateway/types";

/**
 * Exactly what the human owner may do through a human-interaction transport
 * (least privilege): interpret a message / submit a task through the normal
 * Task Intake Gateway, read status, give guidance, cancel, and decide ONLY
 * red-risk pre-execution ("start") and commit/publish approvals through the
 * Approval Gateway. There is no generic approval capability, so a future
 * approval kind (e.g. merge) cannot be decided through this session even if
 * transport code were wrong; pause, merge and deploy do not exist at all.
 */
export const HUMAN_OWNER_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  "task:interpret",
  "task:submit",
  "task:read",
  "task:cancel",
  "approval:read",
  "approval:grant:start",
  "approval:grant:commit_publish",
  "approval:reject:start",
  "approval:reject:commit_publish",
  "human_decision:read",
  "human_decision:submit",
]);

export interface HumanOwnerSession {
  /** In-process, unforgeable credential object (never serialized, never a string token). */
  readonly credentials: object;
  readonly authenticator: GatewayAuthenticator;
  /** Fresh authentication input for one Gateway call. */
  authentication(): GatewayAuthenticationInput;
}

/**
 * The owner allowlist is enforced by the transport before any call reaches
 * this session; the session only proves "this call came from the in-process
 * human-interaction service" to the Gateway.
 */
export function createHumanOwnerSession(input: { principalId: string; source: string; now: () => string }): HumanOwnerSession {
  if (!isValidPrincipalId(input.principalId)) throw new Error("[human-interaction] invalid owner principal id");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.source)) throw new Error("[human-interaction] invalid source");
  const credentials = Object.freeze({});
  let sequence = 0;
  const bootId = Date.now().toString(36);
  return {
    credentials,
    authenticator: {
      async verify(auth): Promise<AuthContext> {
        if (auth.credentials !== credentials) throw new Error("invalid credential");
        return {
          principalId: input.principalId,
          principalType: "operator",
          authenticated: true,
          roles: ["human_owner"],
          capabilities: [...HUMAN_OWNER_CAPABILITIES],
          requestId: auth.requestId,
          source: input.source,
          authenticatedAt: input.now(),
        };
      },
    },
    authentication: () => ({ credentials, requestId: `${input.source}-${bootId}-${++sequence}`, source: input.source }),
  };
}

/** Routes the owner session's credential to its authenticator and everything else to the fallback. */
export function combineAuthenticators(owner: HumanOwnerSession, fallback: GatewayAuthenticator): GatewayAuthenticator {
  return {
    verify: (auth) => (auth.credentials === owner.credentials ? owner.authenticator.verify(auth) : fallback.verify(auth)),
  };
}
