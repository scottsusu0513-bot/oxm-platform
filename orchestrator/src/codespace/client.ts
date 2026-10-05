import type {
  CodespaceClient,
  CodespaceIdentity,
  CodespaceObservation,
  RepositoryBinding,
} from "./types";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const PART = /^[A-Za-z0-9_.-]{1,100}$/;
const sameRepo = (a: RepositoryBinding, b: RepositoryBinding) =>
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.repository.toLowerCase() === b.repository.toLowerCase();

export function validateCodespaceIdentity(
  identity: CodespaceIdentity
): { ok: true } | { ok: false; reason: string } {
  if (!NAME.test(identity.codespaceName))
    return { ok: false, reason: "invalid configured codespace name" };
  for (const repo of [
    identity.repository,
    identity.expectedRepository,
    identity.sourceRepository,
  ])
    if (!PART.test(repo.owner) || !PART.test(repo.repository))
      return { ok: false, reason: "invalid repository binding" };
  if (
    !sameRepo(identity.repository, identity.expectedRepository) ||
    !sameRepo(identity.sourceRepository, identity.expectedRepository)
  )
    return {
      ok: false,
      reason: "codespace repository binding does not match expected repository",
    };
  if (identity.expectedBranch !== "main")
    return { ok: false, reason: "expected source branch must be main" };
  if (
    identity.workspacePath &&
    (!identity.workspacePath.startsWith("/workspaces/") ||
      identity.workspacePath.includes(".."))
  )
    return { ok: false, reason: "unsafe workspace path" };
  return { ok: true };
}

/** Production boundary: transport is fixed to one configured target and exposes status/start/stop only. */
export interface FixedCodespaceTransport {
  status(codespaceName: string): Promise<CodespaceObservation>;
  start(codespaceName: string, idempotencyKey: string): Promise<void>;
  stop(codespaceName: string, idempotencyKey: string): Promise<void>;
}

export function createFixedCodespaceClient(
  identity: CodespaceIdentity,
  transport: FixedCodespaceTransport
): CodespaceClient {
  const valid = validateCodespaceIdentity(identity);
  if (!valid.ok) throw new Error(`[codespace] ${valid.reason}`);
  return Object.freeze({
    async getStatus() {
      const observation = await transport.status(identity.codespaceName);
      if (
        observation.codespaceName !== identity.codespaceName ||
        !sameRepo(observation.repository, identity.expectedRepository)
      )
        throw new Error("[codespace] trusted status target mismatch");
      return structuredClone(observation);
    },
    start: (key: string) => transport.start(identity.codespaceName, key),
    stop: (key: string) => transport.stop(identity.codespaceName, key),
  });
}
