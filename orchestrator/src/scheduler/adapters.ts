import type { RepoRef, RequiredCheck, GitHubReadClient } from "../github/types";
import { inspectPullRequestQa } from "../github/client";
import { DEFAULT_REQUIRED_CHECKS } from "../github/types";
import { BASE_BRANCH } from "../branches/types";
import { prepareAssignedWorkspace, checkWorkerPreconditions, type WorkspaceDeps } from "../githubWrite/workspace";
import type { ApprovalRepository } from "../store/repositories";
import { approvalAuthorizes } from "../store/repositories";
import type { Approval, IsoTimestamp } from "../store/types";
import type { GitInspector, WorkerAdapter, WorkerResult, WorkerTaskContract } from "../workers/types";
import { selectWorkerAdapter } from "../workers/workerAdapter";
import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import type { ApprovalPort, EvidencePort, QaPort, RepoStatePort, TrustedRunRecord, WorkerPort, WorkspacePort } from "./types";

/** Production workspace bridge; all branch/lease policy remains in githubWrite/workspace. */
export function createWorkspacePort(deps: WorkspaceDeps): WorkspacePort {
  return {
    prepare(input) {
      return prepareAssignedWorkspace({ plan: input.plan, lease: input.lease, creation: input.creation }, deps);
    },
    async checkPreconditions(input) {
      const status = await deps.git.status();
      return checkWorkerPreconditions({
        ...input,
        status,
        leases: deps.leases,
      });
    },
    async head(lease) {
      if (!deps.leases.holds(lease)) return null;
      const status = await deps.git.status();
      return { branch: status.branch, headSha: status.headSha };
    },
  };
}

/** Production worker-registry bridge; exact selection fails closed with no substitution. */
export function createWorkerPort(input: { claude: WorkerAdapter; codex?: WorkerAdapter; now: () => IsoTimestamp }): WorkerPort {
  return {
    start(kind, contract, approval) {
      const adapter = selectWorkerAdapter(kind, {
        claude: input.claude,
        codex: input.codex,
      });
      if (!adapter) throw new Error(`[scheduler] worker ${kind} has no executable adapter`);
      return adapter.start({
        contract,
        redApproval: approval ?? null,
        now: input.now(),
      });
    },
  };
}

/** Read-only QA bridge; exact-head filtering and polling decisions remain in github/qa. */
export function createQaPort(client: GitHubReadClient, repo: RepoRef, required: readonly RequiredCheck[] = DEFAULT_REQUIRED_CHECKS): QaPort {
  return {
    read: async (prNumber) => (await inspectPullRequestQa(client, repo, prNumber, required)).decision,
  };
}

/** Minimal read bridge for the branch planner's current main SHA. */
export function createRepoStatePort(
  reader: {
    getBranchHead(repo: RepoRef, branch: string): Promise<string | null>;
  },
  repo: RepoRef,
): RepoStatePort {
  return {
    async mainHeadSha() {
      const sha = await reader.getBranchHead(repo, BASE_BRANCH);
      if (!sha) throw new Error("[scheduler] main head is unavailable");
      return sha;
    },
  };
}

/**
 * Trusted git/result bridge. Acceptance outcomes are supplied by the existing
 * validation/evidence collector; this adapter does not invent acceptance
 * policy from worker prose.
 */
export function createEvidencePort(input: { git: GitInspector; validations(contract: WorkerTaskContract, result: WorkerResult): readonly ValidationEvidence[]; acceptance(contract: WorkerTaskContract, result: WorkerResult): readonly AcceptanceEvidence[] }): EvidencePort {
  return {
    async record({ contract, result }): Promise<TrustedRunRecord> {
      const before = contract.expectedHeadSha;
      if (!before) throw new Error("[scheduler] evidence requires the worker start SHA");
      const [status, changedPaths] = await Promise.all([input.git.status(), input.git.changedPathsSince(before)]);
      if (status.branch !== contract.branch || status.headSha !== result.headSha) {
        throw new Error("[scheduler] worker result does not match trusted git state");
      }
      return {
        changedPaths,
        validations: input.validations(contract, result).map((v) => ({ ...v })),
        acceptance: input.acceptance(contract, result).map((a) => ({ ...a })),
        verifiedHeadSha: status.headSha,
        observedRisk: result.riskObserved.level,
      };
    },
  };
}

function validApprovalTimestamp(a: Approval, at: IsoTimestamp): boolean {
  const created = Date.parse(a.createdAt);
  const decided = a.decidedAt === null ? Number.NaN : Date.parse(a.decidedAt);
  const current = Date.parse(at);
  return Number.isFinite(created) && Number.isFinite(decided) && Number.isFinite(current) && created <= decided && decided <= current;
}

/** Trusted approval bridge. Events are notifications; only repository rows authorize. */
export function createApprovalPort(repository: ApprovalRepository, now: () => IsoTimestamp): ApprovalPort {
  return {
    async resolve(check) {
      const at = now();
      const candidates = repository
        .listByTask(check.taskId)
        .filter((a) => a.kind === check.kind && a.requestedAction === check.requestedAction && a.bindingShaOrActionId === check.bindingShaOrActionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      for (const approval of candidates) {
        if (approval.status === "rejected")
          return {
            state: "rejected",
            approval: null,
            reason: "stored approval was rejected",
          };
        if (approval.status === "expired")
          return {
            state: "expired",
            approval: null,
            reason: "stored approval is expired",
          };
        if (approval.status === "pending") continue;
        if (!validApprovalTimestamp(approval, at)) continue;
        const authorized = approvalAuthorizes(approval, {
          taskId: check.taskId,
          kind: check.kind,
          bindingShaOrActionId: check.bindingShaOrActionId,
          at,
        });
        if (authorized.ok)
          return {
            state: "approved",
            approval,
            reason: "stored approval authorizes this action",
          };
      }
      return {
        state: candidates.some((a) => a.status === "pending") ? "pending" : "none",
        approval: null,
        reason: "no stored approval authorizes this action",
      };
    },
  };
}
