import type { RepoRef, RequiredCheck, GitHubReadClient } from "../github/types";
import { inspectPullRequestQa } from "../github/client";
import { DEFAULT_REQUIRED_CHECKS } from "../github/types";
import { BASE_BRANCH } from "../branches/types";
import { resolveTaskBaseSha, type CommitRelation, type RuntimeBaseline } from "../branches/taskBase";
import { prepareAssignedWorkspace, checkWorkerPreconditions, commitValidatedChanges, observeCommitState, refreshGitMetadataBinding, type WorkspaceDeps } from "../githubWrite/workspace";
import type { ApprovalRepository } from "../store/repositories";
import { approvalAuthorizes } from "../store/repositories";
import type { Approval, IsoTimestamp } from "../store/types";
import type { GitInspector, WorkerAdapter, WorkerResult, WorkerTaskContract } from "../workers/types";
import { opaqueGitMetadataSnapshot, type GitMetadataSnapshot } from "../workers/gitIntegrity";
import { gitMetadataEvidence, laterGitMetadataDrift, combineGitMetadataEvidence, type GitMetadataEvidence } from "../workers/gitMetadataPolicy";
import { selectWorkerAdapter } from "../workers/workerAdapter";
import { isPathInScope } from "../workers/prompt";
import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import type { ApprovalPort, EvidencePort, QaPort, RepoStatePort, TrustedRunRecord, WorkerPort, WorkspacePort } from "./types";

/** Production workspace bridge; all branch/lease policy remains in githubWrite/workspace. */
export function createWorkspacePort(deps: WorkspaceDeps): WorkspacePort {
  // Trusted component snapshot of each lease's current Git binding (in memory: after a restart a
  // moved digest cannot be re-bound and fails closed).
  const bindings = new Map<string, GitMetadataSnapshot>();
  return {
    async prepare(input) {
      const result = await prepareAssignedWorkspace({ plan: input.plan, lease: input.lease, creation: input.creation, ...(input.allowedScope ? { allowedScope: input.allowedScope } : {}) }, deps);
      if (result.ok && deps.git.metadataSnapshot) {
        const snapshot = await deps.git.metadataSnapshot().catch(() => null);
        if (snapshot?.digest === result.prepared.gitMetadataDigest) bindings.set(result.prepared.leaseId, snapshot);
        else bindings.delete(result.prepared.leaseId);
      }
      return result;
    },
    async rebindGitMetadata(input) {
      const result = await refreshGitMetadataBinding({ lease: input.lease, contract: input.contract, prior: bindings.get(input.lease.leaseId) ?? null }, deps);
      if (result.ok) bindings.set(input.lease.leaseId, result.snapshot);
      return result.ok ? { ok: true, gitMetadataDigest: result.gitMetadataDigest, evidence: result.evidence } : result;
    },
    async checkPreconditions(input) {
      const status = await deps.git.status();
      const metadataDigest = await deps.git.metadataDigest();
      return checkWorkerPreconditions({
        ...input,
        status,
        metadataDigest,
        leases: deps.leases,
      });
    },
    async head(lease) {
      if (!deps.leases.holds(lease)) return null;
      const status = await deps.git.status();
      return { branch: status.branch, headSha: status.headSha };
    },
    observeCommitState(lease) {
      return observeCommitState(lease, deps);
    },
    commitValidated(input) {
      return commitValidatedChanges(input, deps);
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

/**
 * Read bridge for the branch planner's task base: the main head, or the runtime
 * baseline when the read-only compare shows it strictly ahead of main.
 */
export function createRepoStatePort(
  reader: {
    getBranchHead(repo: RepoRef, branch: string): Promise<string | null>;
    compareCommits?(repo: RepoRef, baseSha: string, headSha: string): Promise<CommitRelation | null>;
  },
  repo: RepoRef,
  baseline: RuntimeBaseline | null = null,
): RepoStatePort {
  return {
    async taskBaseSha() {
      const mainSha = await reader.getBranchHead(repo, BASE_BRANCH);
      if (!mainSha) throw new Error("[scheduler] main head is unavailable");
      const needsCompare = baseline !== null && baseline.sha !== mainSha;
      if (needsCompare && !reader.compareCommits) throw new Error("[scheduler] runtime baseline cannot be compared with main");
      const relation = needsCompare ? await reader.compareCommits!(repo, mainSha, baseline.sha) : null;
      return resolveTaskBaseSha({ mainSha, baseline, relation });
    },
  };
}

/**
 * Trusted git/result bridge. Acceptance outcomes are supplied by the existing
 * validation/evidence collector; this adapter does not invent acceptance
 * policy from worker prose.
 */
/** Typed evidence-recorder failure: the code (never only Error.name) reaches the fallback audit. */
export type EvidenceRecordErrorCode = "missing_start_sha" | "git_read_failed" | "branch_mismatch" | "head_mismatch" | "missing_metadata_baseline" | "git_metadata_violation";
export class EvidenceRecordError extends Error {
  override readonly name = "EvidenceRecordError";
  constructor(
    readonly code: EvidenceRecordErrorCode,
    message: string,
    readonly gitMetadata?: GitMetadataEvidence,
  ) {
    super(message);
  }
}

export function createEvidencePort(input: { git: GitInspector; validations(contract: WorkerTaskContract, result: WorkerResult): readonly ValidationEvidence[]; acceptance(contract: WorkerTaskContract, result: WorkerResult): readonly AcceptanceEvidence[] }): EvidencePort {
  return {
    async record({ contract, result }): Promise<TrustedRunRecord> {
      const before = contract.expectedHeadSha;
      if (!before) throw new EvidenceRecordError("missing_start_sha", "[scheduler] evidence requires the worker start SHA");
      let status: Awaited<ReturnType<GitInspector["status"]>>;
      let changedPaths: string[];
      try {
        [status, changedPaths] = await Promise.all([input.git.status(), input.git.changedPathsSince(before)]);
      } catch (err) {
        throw new EvidenceRecordError("git_read_failed", `[scheduler] trusted git state unreadable (${err instanceof Error ? err.name : "unknown"})`);
      }
      if (status.branch !== contract.branch) throw new EvidenceRecordError("branch_mismatch", "[scheduler] workspace is not on the task branch");
      if (status.headSha !== before || status.headSha !== result.headSha) throw new EvidenceRecordError("head_mismatch", "[scheduler] worker result does not match trusted git state");
      if (!contract.gitMetadataDigest) throw new EvidenceRecordError("missing_metadata_baseline", "[scheduler] contract has no Git metadata baseline");
      // Re-verified before the Manager sees any evidence, by component (workers/gitMetadataPolicy.ts).
      const gitMetadata = await recordGitMetadata(input.git, contract.gitMetadataDigest, result.gitMetadata);
      if (gitMetadata?.workerViolation) throw new EvidenceRecordError("git_metadata_violation", `[scheduler] worker Git metadata violation: ${gitMetadata.summary}`, gitMetadata);
      const { owned, foreign } = splitTaskOwnedDelta(changedPaths, contract, result);
      return {
        changedPaths: owned,
        ...(foreign.length ? { foreignPaths: foreign } : {}),
        validations: input.validations(contract, result).map((v) => ({ ...v })),
        acceptance: input.acceptance(contract, result).map((a) => ({ ...a })),
        verifiedHeadSha: status.headSha,
        observedRisk: result.riskObserved.level,
        ...(gitMetadata ? { gitMetadata } : {}),
      };
    },
  };
}

/**
 * Current Git metadata vs the prepared baseline, explained by component. The run's own (adapter)
 * evidence covers the Worker window; anything that moved since is later drift, never the Worker's.
 * null: nothing changed at all. Throws only when Git metadata is unreadable.
 */
async function recordGitMetadata(git: GitInspector, baseline: string, run: GitMetadataEvidence | undefined): Promise<GitMetadataEvidence | null> {
  let now;
  try {
    now = git.metadataSnapshot ? await git.metadataSnapshot() : opaqueGitMetadataSnapshot(await git.metadataDigest());
  } catch (err) {
    throw new EvidenceRecordError("git_read_failed", `[scheduler] Git metadata unreadable (${err instanceof Error ? err.name : "unknown"})`, run);
  }
  if (!run) return now.digest === baseline ? null : gitMetadataEvidence(opaqueGitMetadataSnapshot(baseline), now, "after_worker_run");
  if (now.digest === run.afterDigest && Object.entries(run.components).every(([id, d]) => now.components.find((c) => c.id === id)?.digest === d)) return run;
  // The run's evidence started from the Worker-start snapshot; publication binds to the prepared baseline.
  const merged = combineGitMetadataEvidence(run, laterGitMetadataDrift(run, now));
  return { ...merged, beforeDigest: baseline, publicationTrust: merged.workerViolation ? "blocked" : now.digest === baseline ? "trusted" : merged.publicationTrust === "trusted" ? "refresh_required" : merged.publicationTrust };
}

/**
 * Task-owned part of the Git-observed delta. In-scope paths are the task's (the Worker preflight
 * refuses to start with unrelated dirty paths inside the scope). Out-of-scope paths are the
 * task's only when the trusted Worker adapter attributed them to this execution (it lists a
 * genuine scope violation in filesChanged); everything else is shared-workspace state that is
 * not the Worker's: excluded from the task delta, never committed, reported to the owner.
 */
export function splitTaskOwnedDelta(changedPaths: readonly string[], contract: Partial<Pick<WorkerTaskContract, "allowedScope">>, result: Partial<Pick<WorkerResult, "filesChanged">>): { owned: string[]; foreign: string[] } {
  const paths = Array.from(new Set(changedPaths)).sort();
  const scope = contract.allowedScope ?? [];
  // Without a scope nothing can be attributed away: every change stays the task's (the validator
  // then fails closed on the undefined scope). Never hide a change from the scope check.
  if (scope.length === 0) return { owned: paths, foreign: [] };
  const attributed = new Set(result.filesChanged ?? []);
  const owned: string[] = [];
  const foreign: string[] = [];
  for (const p of paths) (isPathInScope(p, scope) || attributed.has(p) ? owned : foreign).push(p);
  return { owned, foreign };
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
