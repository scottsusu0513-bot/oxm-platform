import type {
  CodespaceClient,
  CodespaceIdentity,
  CodespaceObservation,
  TrustedCodespaceStatus,
} from "./types";

export const FAKE_CODESPACE_IDENTITY: CodespaceIdentity = Object.freeze({
  codespaceName: "oxm-platform-dev",
  repository: { owner: "oxm", repository: "oxm-platform" },
  expectedRepository: { owner: "oxm", repository: "oxm-platform" },
  sourceRepository: { owner: "oxm", repository: "oxm-platform" },
  expectedBranch: "main",
  workspacePath: "/workspaces/oxm-platform",
});

export function createFakeCodespaceClient(
  initial: TrustedCodespaceStatus = "stopped",
  identity: CodespaceIdentity = FAKE_CODESPACE_IDENTITY
) {
  let status = initial;
  let now = "2026-10-05T12:00:00.000Z";
  let failStarts = 0;
  let failStops = 0;
  let failStatuses = 0;
  const calls: string[] = [];
  const client: CodespaceClient = {
    async getStatus(): Promise<CodespaceObservation> {
      calls.push("status");
      if (failStatuses-- > 0) throw new Error("sanitized status failure");
      return {
        status,
        observedAt: now,
        repository: identity.repository,
        codespaceName: identity.codespaceName,
      };
    },
    async start(key) {
      calls.push(`start:${key}`);
      if (failStarts-- > 0) throw new Error("sanitized start failure");
      status = "starting";
    },
    async stop(key) {
      calls.push(`stop:${key}`);
      if (failStops-- > 0) throw new Error("sanitized stop failure");
      status = "stopping";
    },
  };
  return {
    client,
    calls,
    status: () => status,
    setStatus: (next: TrustedCodespaceStatus) => {
      status = next;
    },
    setNow: (next: string) => {
      now = next;
    },
    failNextStarts: (count = 1) => {
      failStarts = count;
    },
    failNextStops: (count = 1) => {
      failStops = count;
    },
    failNextStatuses: (count = 1) => {
      failStatuses = count;
    },
  };
}
