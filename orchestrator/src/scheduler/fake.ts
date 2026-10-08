import { semanticAcceptance } from "../planning/goalAcceptance";
import type { GoalReviewer } from "../planning/types";
import { isPlannerApproved } from "../branches/planner";
import { classifyTask } from "../domain/risk";
import { routeTask } from "../domain/routing";
import type { TaskAction, TaskCategory, WorkerAvailability, WorkerKind } from "../domain/types";
import { evaluateQa } from "../github/qa";
import {
  DEFAULT_REQUIRED_CHECKS,
  type CheckObservation,
  type QaDecision,
} from "../github/types";
import { createGitHubWriteClient } from "../githubWrite/client";
import { createFakeRemote, type FakeRemote } from "../githubWrite/fake";
import { createWorkspaceLeaseRegistry, type WorkspaceLease } from "../githubWrite/lease";
import type { PreparedWorkspace } from "../githubWrite/workspace";
import { COMMIT_PUBLISH_ACTION, commitApprovalBinding, normalizeCommitApprovalEvidence } from "../workers/prompt";
import { gitBlobId, sameContentIdentities, type PathContentIdentity } from "../workers/gitIntegrity";
import type { NewAuditEvent } from "../store/types";
import type { WorkerHandle, WorkerResult, WorkerTaskContract } from "../workers/types";
import { redStartBindingId } from "../workers/prompt";
import { taskBranchName } from "../branches/naming";
import { createInMemoryApprovalRepository } from "../store/memory";
import type { Approval, ApprovalKind } from "../store/types";
import { createManagerLoop, type ManagerLoop } from "./loop";
import { APPROVAL_ACTIONS } from "./loop";
import { createApprovalPort } from "./adapters";
import type { OrchestrationPolicy, OrchestrationPorts, TaskIntake, TrustedRunRecord } from "./types";
import type { OrchestrationPersistencePort } from "./types";

/**
 * Simulation harness for the Manager Loop. No real GitHub, no Claude, no
 * git, no production DB, no network, no timers. The GitHub write path is the
 * real write client over the in-memory remote from githubWrite/fake, leases
 * use the real registry, and QA uses the real github/qa evaluator — only the
 * transports, the worker, and the trusted evidence recorder are faked.
 */

export const FAKE_REPO = { owner: "oxm", repo: "oxm-platform" } as const;
export const sha = (n: number) => n.toString(16).padStart(40, "0");
export const MAIN_SHA = sha(0xa0000);
export const FAKE_METADATA_DIGEST = "c".repeat(64);

export type WorkerScript =
  | "success"
  | "failure"
  | "policy_error"
  | "head_mismatch"
  | "malformed_output"
  | "validation_failed"
  | "validation_failed_dirty"
  | "scope_violation"
  | "risk_red"
  | "git_metadata_changed"
  /** Transient runtime failures (tool startup, quota, infrastructure). */
  | "timeout"
  /** Timed out after editing task files: the retry must inherit new dirty paths. */
  | "timeout_dirty"
  | "process_error"
  /** Edits files even though the contract is read_only (policy violation probe). */
  | "mutate_readonly"
  /** Worker usage quota exhausted (typed availability failure); no reset time exposed. */
  | "quota_exhausted"
  /** Edited task files, then hit the quota: the continuation must inherit the progress. */
  | "quota_exhausted_dirty"
  /** Quota exhausted with a trusted provider reset time (2026-10-07T18:00:00.000Z). */
  | "quota_exhausted_reset"
  /** Quota exhausted with a trusted reset time that has already passed on the simulation clock. */
  | "quota_exhausted_elapsed"
  /** The Worker CLI needs a new login (typed availability failure). */
  | "auth_unavailable"
  /** The Worker executable cannot be found. */
  | "executable_unavailable"
  /** The Worker's service is down (transient; bounded retries, then a pause). */
  | "service_unavailable";
export type CiScript = "pass" | "fail" | "pending";

export interface SimulationOptions {
  /** Outcome per worker run of a task (the last entry repeats). Default: success. */
  worker?: Record<string, readonly WorkerScript[]>;
  /** CI outcome per pushed head of a task (the last entry repeats). Default: pass. */
  ci?: Record<string, readonly CiScript[]>;
  /** Values returned by repo.mainHeadSha() in order (the last repeats). Default: the remote main. */
  mainHeads?: readonly string[];
  /** Actual main on the fake remote. */
  remoteMain?: string;
  policy?: Partial<OrchestrationPolicy>;
  /** Keep worker runs outstanding until releaseWorker(taskId). */
  holdWorkers?: boolean;
  persistence?: OrchestrationPersistencePort;
  /** Optional real-controller-shaped lifecycle port used by integration harnesses. */
  lifecycle?: OrchestrationPorts["lifecycle"];
  /** Makes all otherwise-successful check observations stale for this task. */
  staleQaTaskIds?: readonly string[];
  /** Test convenience; disable to assert the mandatory human gate itself. */
  autoApproveCommits?: boolean;
  /**
   * Manager goal reviewer. When set, tasks with a goal context get the same
   * semantic acceptance as production (planning/goalAcceptance); without it
   * the simulation keeps its validation-only acceptance.
   */
  goalReviewer?: GoalReviewer;
  /** Answer text a read_only Worker returns, per task (default cites the task's own file). */
  answers?: Record<string, string>;
  /**
   * Fake tracked repository content. When set, the trusted evidence layer reads
   * it (cited files and the Manager's own evidence gathering: listing + search)
   * instead of returning a placeholder for any path.
   */
  repoFiles?: Record<string, string>;
  /**
   * Commands a Worker run reports in its own run record, per task and run (the last entry repeats).
   * Replaces the default test commands; used to probe owner-constraint verification.
   */
  workerCommands?: Record<string, readonly (readonly string[])[]>;
  /** GPT Manager reasoning port (scripted in tests); absent = deterministic-only Manager. */
  manager?: OrchestrationPorts["manager"];
}

export interface WorkerCall {
  kind: WorkerKind;
  taskId: string;
  runId: string;
  branch: string;
  expectedHeadSha: string | null;
  repair: boolean;
  /** Full contract objective, including any Manager repair instruction (untrusted task data). */
  objective: string;
  requiredValidations: readonly string[];
  storedRiskLevel: string | null;
  allowedDirtyPaths: readonly string[];
}

export interface Simulation {
  loop: ManagerLoop;
  ports: OrchestrationPorts;
  remote: FakeRemote;
  audit: Omit<NewAuditEvent, "id">[];
  workerCalls: WorkerCall[];
  qaReads: number[];
  qaDecisions: QaDecision[];
  trustedRecords: TrustedRunRecord[];
  /** Every trusted commit the workspace port actually created. */
  commits: { taskId: string; approvalId: string }[];
  approvals: ReturnType<typeof createInMemoryApprovalRepository>;
  approve(taskId: string, phase: "pre_execution" | "commit_publish" | "post_qa", overrides?: Partial<Pick<Approval, "taskId" | "kind" | "requestedAction" | "bindingShaOrActionId" | "expiresAt">>): Approval;
  rejectApproval(taskId: string, phase: "pre_execution" | "commit_publish" | "post_qa"): Approval;
  expireApproval(taskId: string, phase: "pre_execution" | "commit_publish" | "post_qa"): Approval;
  releaseWorker(taskId: string): boolean;
  /**
   * Out-of-band workspace change (e.g. after Manager review): writes/removes files
   * (null = delete) and/or replaces the Git metadata digest.
   */
  mutateWorkspace(taskId: string, change: { files?: Record<string, string | null>; gitMetadataDigest?: string }): void;
  /** Posts task_created and settles. */
  create(task: TaskIntake): Promise<void>;
  /** Posts an event and settles. */
  send(event: Parameters<ManagerLoop["post"]>[0]): Promise<void>;
}

export function createSimulation(opts: SimulationOptions = {}): Simulation {
  const remoteMain = opts.remoteMain ?? MAIN_SHA;
  const remote = createFakeRemote({ refs: { main: remoteMain } });
  const parents = new Map<string, string>();
  const pushed = new Map<string, string[]>(); // branch -> pushed heads in order
  const isAncestor = (anc: string, s: string) => {
    for (let cur: string | undefined = s; cur; cur = parents.get(cur)) if (cur === anc) return true;
    return false;
  };
  const github = createGitHubWriteClient(FAKE_REPO, {
    transport: remote,
    push: {
      async pushBranch(branch, localSha) {
        remote.calls.push(`PUSH ${localSha}:refs/heads/${branch}`);
        const current = remote.refs.get(branch);
        if (current && !isAncestor(current, localSha)) throw new Error("non-fast-forward rejected");
        remote.refs.set(branch, localSha);
        pushed.set(branch, [...(pushed.get(branch) ?? []), localSha]);
      },
    },
  });

  const leases = createWorkspaceLeaseRegistry();
  const heads = new Map<string, { branch: string; headSha: string }>(); // taskId -> workspace HEAD
  const dirtyPaths = new Map<string, string[]>();
  const contents = new Map<string, Map<string, string | null>>(); // taskId -> path -> bytes (null = deleted)
  const gitMetadata = new Map<string, string>(); // taskId -> current Git metadata digest of its workspace
  const metadataOf = (taskId: string) => gitMetadata.get(taskId) ?? FAKE_METADATA_DIGEST;
  const identitiesOf = (taskId: string, paths: readonly string[]): PathContentIdentity[] =>
    Array.from(new Set(paths)).sort().map((path): PathContentIdentity => {
      const bytes = contents.get(taskId)?.get(path);
      return typeof bytes === "string" ? { path, mode: "100644", blob: gitBlobId(Buffer.from(bytes)) } : { path, mode: "absent", blob: null };
    });
  const audit: Omit<NewAuditEvent, "id">[] = [];
  const workerCalls: WorkerCall[] = [];
  const qaReads: number[] = [];
  const qaDecisions: QaDecision[] = [];
  const trustedRecords: TrustedRunRecord[] = [];
  const commits: { taskId: string; approvalId: string }[] = [];
  const recordsByTask = new Map<string, TrustedRunRecord>();
  const runsByTask = new Map<string, number>();
  const contractsByTask = new Map<string, WorkerTaskContract>();
  const held = new Map<string, () => void>();
  let nextSha = 0xb0000;
  let mainReads = 0;
  const now = () => "2026-10-04T12:00:00.000Z";
  const trustedTestRuns = new Map<string, WorkerResult["testsRun"]>();
  const approvals = createInMemoryApprovalRepository(now);
  const intakes = new Map<string, TaskIntake>();

  const resultFor = (c: WorkerTaskContract, script: WorkerScript): WorkerResult => {
    const start = c.expectedHeadSha ?? null;
    const edit = (changed = files) => {
      dirtyPaths.set(c.taskId, [...changed]);
      const store = contents.get(c.taskId) ?? new Map<string, string | null>();
      for (const path of changed) store.set(path, `content:${path}:${c.runId}`);
      contents.set(c.taskId, store);
      return start;
    };
    const files = c.allowedScope.map((p) => (p.endsWith("/") ? `${p}index.ts` : p));
    const base: WorkerResult = {
      status: "success",
      summary: "done",
      filesChanged: files,
      testsRun: [
        { command: "pnpm test", outcome: "passed" },
        {
          command: "pnpm vitest run orchestrator/src/e2e/fixture.test.ts",
          outcome: "passed",
        },
        { command: "pnpm check", outcome: "passed" },
      ],
      checkResult: "passed",
      branch: c.branch,
      headSha: null,
      prNumber: null,
      riskObserved: { level: c.storedRiskLevel ?? "green", notes: [] },
      needsApproval: false,
      fallbackRecommended: false,
      errorType: null,
      workerErrorCode: null,
    };
    if (c.mode === "read_only" && script === "success")
      return { ...base, filesChanged: [], summary: opts.answers?.[c.taskId] ?? `Answer for ${c.taskId}: see ${files[0] ?? "the repository"}.`, headSha: start };
    switch (script) {
      case "mutate_readonly":
      case "success":
        return { ...base, headSha: edit() };
      case "risk_red":
        return {
          ...base,
          headSha: edit(),
          riskObserved: { level: "red", notes: ["observed red"] },
        };
      case "failure":
        return {
          ...base,
          status: "failure",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          errorType: "worker_failure",
        };
      case "git_metadata_changed":
        // Mirrors runtimeWorker: metadata drifted during the run, so the result is refused with no headSha.
        gitMetadata.set(c.taskId, "d".repeat(64));
        return {
          ...base,
          status: "failure",
          summary: "worker run changed or hid Git metadata; result refused",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: null,
          riskObserved: { level: "red", notes: [] },
          needsApproval: true,
          errorType: "git_metadata_changed",
        };
      case "timeout":
        return {
          ...base,
          status: "timeout",
          summary: "worker run timed out",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          errorType: "timeout",
        };
      case "timeout_dirty":
        edit();
        return {
          ...base,
          status: "timeout",
          summary: "worker run timed out",
          filesChanged: files,
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          errorType: "timeout",
        };
      case "quota_exhausted":
      case "quota_exhausted_dirty":
      case "quota_exhausted_reset":
      case "quota_exhausted_elapsed":
        if (script === "quota_exhausted_dirty") edit();
        return {
          ...base,
          status: "failure",
          summary: "worker runtime unavailable: quota_exhausted",
          filesChanged: script === "quota_exhausted_dirty" ? files : [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          fallbackRecommended: true,
          errorType: "quota_exhausted",
          availability: {
            kind: "quota_exhausted",
            resetAt: script === "quota_exhausted_reset" ? "2026-10-07T18:00:00.000Z" : script === "quota_exhausted_elapsed" ? "2026-10-04T11:00:00.000Z" : null,
          },
        };
      case "auth_unavailable":
      case "executable_unavailable":
      case "service_unavailable": {
        const errorType = script === "auth_unavailable" ? "authentication_unavailable" : script;
        const kind = script === "auth_unavailable" ? "authentication_unavailable" : script;
        return {
          ...base,
          status: "failure",
          summary: `worker runtime unavailable: ${kind}`,
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          fallbackRecommended: true,
          errorType,
          availability: { kind, resetAt: null },
        };
      }
      case "process_error":
        return {
          ...base,
          status: "failure",
          summary: "worker exited with code 1",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          fallbackRecommended: true,
          errorType: "process_error",
        };
      case "policy_error":
        return {
          ...base,
          status: "failure",
          summary: "Codex worker command policy is missing or altered",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          errorType: "policy_error",
        };
      case "malformed_output":
        return {
          ...base,
          status: "failure",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: start,
          errorType: "malformed_output",
        };
      case "head_mismatch":
        return {
          ...base,
          status: "failure",
          filesChanged: [],
          testsRun: [],
          checkResult: "not_run",
          headSha: sha(0xdead),
          errorType: "result_mismatch",
        };
      case "validation_failed":
        return {
          ...base,
          status: "failure",
          headSha: edit(),
          testsRun: [
            { command: "pnpm test", outcome: "failed" },
            { command: "pnpm check", outcome: "passed" },
          ],
          checkResult: "failed",
          errorType: "validation_incomplete",
        };
      case "validation_failed_dirty":
        edit();
        return {
          ...base,
          status: "failure",
          headSha: start,
          testsRun: [{ command: "pnpm vitest run orchestrator/src/e2e/fixture.test.ts", outcome: "failed" }],
          checkResult: "not_run",
          errorType: "validation_incomplete",
        };
      case "scope_violation":
        edit([...files, "server/unrelated.ts"]);
        return {
          ...base,
          status: "failure",
          headSha: start,
          filesChanged: [...files, "server/unrelated.ts"],
          errorType: "scope_violation",
        };
    }
  };

  const ports: OrchestrationPorts = {
    ...(opts.manager ? { manager: opts.manager } : {}),
    github,
    leases,
    audit: (e) => audit.push(structuredClone(e)),
    repo: {
      async mainHeadSha() {
        const seq = opts.mainHeads ?? [];
        const v = seq.length ? seq[Math.min(mainReads, seq.length - 1)] : (remote.refs.get("main") as string);
        mainReads++;
        return v;
      },
    },
    workspace: {
      async prepare({ plan, lease }) {
        if (!isPlannerApproved(plan))
          return {
            ok: false,
            error: "policy_violation",
            reason: "plan not approved",
          };
        if (!leases.holds(lease) || (lease as WorkspaceLease).taskId !== plan.taskId)
          return {
            ok: false,
            error: "lease_conflict",
            reason: "lease not held",
          };
        const headSha = plan.decision === "reuse_branch" ? plan.headSha : plan.baseSha;
        heads.set(plan.taskId, { branch: plan.branch, headSha });
        const prepared: PreparedWorkspace = Object.freeze({
          workspaceId: lease.workspaceId,
          leaseId: lease.leaseId,
          taskId: plan.taskId,
          branch: plan.branch,
          headSha,
          allowedDirtyPaths: [],
          gitMetadataDigest: metadataOf(plan.taskId),
        });
        return { ok: true, prepared };
      },
      async checkPreconditions({ prepared, contract, lease }) {
        const p = prepared as PreparedWorkspace;
        if (!leases.holds(lease)) return { ok: false, reason: "lease not held" };
        if (contract.taskId !== p.taskId || contract.branch !== p.branch) return { ok: false, reason: "contract not bound to prepared branch" };
        if (metadataOf(p.taskId) !== p.gitMetadataDigest) return { ok: false, reason: "Git metadata changed since preparation" };
        return {
          ok: true,
          contract: { ...contract, expectedHeadSha: p.headSha, gitMetadataDigest: p.gitMetadataDigest },
        };
      },
      async head(lease) {
        return heads.get(lease.taskId) ?? null;
      },
      async observeCommitState(lease) {
        if (!leases.holds(lease)) return { ok: false as const, error: "lease_conflict" as const, reason: "lease not held" };
        const head = heads.get(lease.taskId);
        if (!head) return { ok: false as const, error: "verification_failed" as const, reason: "head unavailable" };
        const dirty = [...(dirtyPaths.get(lease.taskId) ?? [])].sort();
        return { ok: true as const, ...head, dirtyPaths: dirty, contentIdentities: identitiesOf(lease.taskId, dirty), gitMetadataDigest: metadataOf(lease.taskId) };
      },
      async commitValidated({ plan, lease, evidence, approval }) {
        if (!isPlannerApproved(plan) || !leases.holds(lease)) return { ok: false, error: "policy_violation", reason: "untrusted commit input" };
        const head = heads.get(lease.taskId);
        const dirty = dirtyPaths.get(lease.taskId) ?? [];
        const expectedPaths = Array.from(new Set(evidence.changedPaths)).sort();
        if (approval.kind !== "commit_publish" || approval.taskId !== plan.taskId || approval.requestedAction !== COMMIT_PUBLISH_ACTION || approval.bindingShaOrActionId !== commitApprovalBinding(evidence)) {
          return { ok: false, error: "policy_violation", reason: "approval mismatch" };
        }
        if (!head || head.branch !== plan.branch || head.headSha !== evidence.expectedHeadSha || JSON.stringify([...dirty].sort()) !== JSON.stringify(expectedPaths)) {
          return { ok: false, error: "dirty_worktree", reason: "trusted commit preconditions failed" };
        }
        if (expectedPaths.length === 0 || expectedPaths.some((path) => !evidence.allowedScope.some((scope) => scope.endsWith("/") ? path.startsWith(scope) : path === scope))) {
          return { ok: false, error: "policy_violation", reason: "commit path outside scope" };
        }
        if (metadataOf(lease.taskId) !== evidence.gitMetadataDigest || !sameContentIdentities(identitiesOf(lease.taskId, expectedPaths), evidence.contentIdentities)) {
          return { ok: false, error: "verification_failed", reason: "approved content or Git metadata drifted" };
        }
        commits.push({ taskId: lease.taskId, approvalId: approval.id });
        const committed = sha(++nextSha);
        parents.set(committed, evidence.expectedHeadSha);
        heads.set(lease.taskId, { branch: plan.branch, headSha: committed });
        dirtyPaths.delete(lease.taskId);
        return { ok: true, headSha: committed };
      },
    },
    worker: {
      start(kind, contract): WorkerHandle {
        contractsByTask.set(contract.taskId, structuredClone(contract));
        const n = (runsByTask.get(contract.taskId) ?? 0) + 1;
        runsByTask.set(contract.taskId, n);
        workerCalls.push({
          kind,
          taskId: contract.taskId,
          runId: contract.runId,
          branch: contract.branch,
          expectedHeadSha: contract.expectedHeadSha ?? null,
          repair: contract.objective.includes("Repair attempt"),
          objective: contract.objective,
          requiredValidations: [...contract.requiredValidations],
          storedRiskLevel: contract.storedRiskLevel ?? null,
          allowedDirtyPaths: [...(contract.allowedDirtyPaths ?? [])],
        });
        const script = opts.worker?.[contract.taskId] ?? ["success"];
        const outcome = script[Math.min(n - 1, script.length - 1)];
        const result = new Promise<WorkerResult>((resolve) => {
          const cmds = opts.workerCommands?.[contract.taskId];
          const finish = () => {
            const r = resultFor(contract, outcome);
            // The orchestrator's own (trusted) validations stay independent of what the Worker reports running.
            if (cmds) trustedTestRuns.set(contract.runId, r.testsRun);
            resolve(cmds ? { ...r, testsRun: cmds[Math.min(n - 1, cmds.length - 1)].map((command) => ({ command, outcome: "passed" as const })) } : r);
          };
          if (opts.holdWorkers) held.set(contract.taskId, finish);
          else finish();
        });
        return {
          runId: contract.runId,
          promptHash: "f".repeat(64),
          result,
          cancel() {},
        };
      },
    },
    evidence: {
      async record({ contract, result, lease, goal, runId }): Promise<TrustedRunRecord> {
        if (!contract.gitMetadataDigest || metadataOf(lease.taskId) !== contract.gitMetadataDigest) {
          throw new Error("[fake] Git metadata changed since workspace preparation");
        }
        const trustedRuns = trustedTestRuns.get(runId) ?? result.testsRun;
        const outcomeOf = (needle: string) => trustedRuns.find((r) => r.command.includes(needle))?.outcome ?? "not_run";
        const validations = contract.requiredValidations.map((name) => {
          const o = outcomeOf(
            name === "tests"
              ? "pnpm test"
              : name === "smoke"
                ? "orchestrator/src/e2e/fixture.test.ts"
                : "check",
          );
          return {
            name,
            requested: true,
            executed: o !== "not_run",
            status: o === "passed" ? ("passed" as const) : o === "failed" ? ("failed" as const) : ("missing" as const),
            trusted: true,
          };
        });
        const validationsPassed =
          validations.length > 0 &&
          validations.every((v) => v.status === "passed");
        const acceptanceReference = contract.requiredValidations[0] ?? null;
        const files = contents.get(contract.taskId) ?? new Map<string, string | null>();
        const judged =
          goal && opts.goalReviewer
            ? await semanticAcceptance({
                  goal,
                  validations,
                  reviewer: opts.goalReviewer,
                  reviewId: runId,
                  diff: { text: result.filesChanged.map((p) => `+++ b/${p}\n+${files.get(p) ?? ""}`).join("\n"), truncated: false },
                  answer: result.summary,
                  fileContent: (p) => files.get(p) ?? (opts.repoFiles ? (opts.repoFiles[p] ?? null) : `// repository file ${p}`),
                  ...(opts.repoFiles
                    ? {
                        sourcePorts: {
                          listFiles: async () => Object.keys(opts.repoFiles!),
                          searchContent: async (kw: string) => Object.entries(opts.repoFiles!).filter(([, c]) => c.toLowerCase().includes(kw.toLowerCase())).map(([p]) => p),
                        },
                      }
                    : {}),
                  timeoutMs: 5_000,
                })
            : null;
        const record: TrustedRunRecord = {
          changedPaths: result.filesChanged,
          validations,
          ...(judged?.reviewUnavailable ? { goalReviewUnavailable: true } : {}),
          ...(judged ? { managerReviewCalls: judged.reviewCalls, citedFiles: judged.citedFiles, constraintVerdicts: judged.constraintVerdicts, ...(judged.ownerAnswer ? { managerAnswer: judged.ownerAnswer } : {}) } : {}),
          acceptance: judged
            ? judged.acceptance
            : contract.acceptanceCriteria.map((_, i) => ({
                criterionId: `AC-${i + 1}`,
                status: validationsPassed ? ("satisfied" as const) : ("failed" as const),
                evidenceType: "validation" as const,
                reference: acceptanceReference,
              })),
          verifiedHeadSha: heads.get(lease.taskId)?.headSha ?? null,
          observedRisk: result.riskObserved.level,
        };
        trustedRecords.push(structuredClone(record));
        recordsByTask.set(contract.taskId, structuredClone(record));
        return record;
      },
    },
    approvals: createApprovalPort(approvals, now),
    persistence: opts.persistence,
    lifecycle: opts.lifecycle,
    now,
    qa: {
      async read(prNumber) {
        qaReads.push(prNumber);
        const raw = remote.prs.get(prNumber);
        if (!raw) throw new Error("Not Found");
        const branch = raw.head.ref;
        const headSha = remote.refs.get(branch) ?? raw.head.sha;
        const idx = (pushed.get(branch) ?? []).indexOf(headSha);
        const script = Object.entries(opts.ci ?? {}).find(([id]) => branch.startsWith(`agent/task-${id}-`))?.[1] ?? ["pass"];
        const outcome = script[Math.min(Math.max(idx, 0), script.length - 1)];
        const stale = opts.staleQaTaskIds?.some((id) =>
          branch.startsWith(`agent/task-${id}-`),
        );
        const checkHead = stale ? sha(0x515151) : headSha;
        const checks: CheckObservation[] = DEFAULT_REQUIRED_CHECKS.map((r) => ({
          source: "check_run",
          name: r.name,
          headSha: checkHead,
          appSlug: "github-actions",
          status: outcome === "pending" ? "in_progress" : "completed",
          conclusion: outcome === "pending" ? null : outcome === "fail" && r.name === "full-test" ? "failure" : "success",
        }));
        // Include successful observations from older pushed heads. The real QA
        // evaluator must ignore them and require every check on the exact
        // current repair head.
        for (const stale of (pushed.get(branch) ?? []).slice(0, Math.max(idx, 0))) {
          checks.push(
            ...DEFAULT_REQUIRED_CHECKS.map((r) => ({
              source: "check_run" as const,
              name: r.name,
              headSha: stale,
              appSlug: "github-actions",
              status: "completed",
              conclusion: "success",
            })),
          );
        }
        const decision = evaluateQa({
          pr: {
            number: prNumber,
            state: "open",
            draft: Boolean(raw.draft),
            headSha,
            headRef: branch,
            baseRef: raw.base.ref,
          },
          required: DEFAULT_REQUIRED_CHECKS,
          checks,
        });
        qaDecisions.push(structuredClone(decision));
        return decision;
      },
    },
  };

  // Explicit fixture: a simulation may run the deterministic Manager when no GPT port is injected.
  const loop = createManagerLoop(ports, { managerMode: "deterministic_fixture", ...opts.policy });
  const decideApproval = (taskId: string, phase: "pre_execution" | "commit_publish" | "post_qa", status: "approved" | "rejected" | "expired", overrides = {}) => {
    const task = intakes.get(taskId);
    const latestContract = contractsByTask.get(taskId);
    const snap = loop.task(taskId);
    if ((!task && !latestContract) || !snap) throw new Error(`unknown task ${taskId}`);
    const branch = snap.branch ?? taskBranchName(task!.lineage?.rootTaskId ?? task!.taskId, task!.lineage?.title ?? task!.title, task!.category);
    const contract: WorkerTaskContract = latestContract ?? {
      taskId: task!.taskId,
      runId: `${task!.taskId}-approval-binding`,
      category: task!.category,
      actions: task!.actions,
      changedPaths: task!.expectedPaths,
      storedRiskLevel: task!.classification.risk.level,
      objective: task!.objective,
      allowedScope: task!.allowedScope ?? task!.expectedPaths,
      acceptanceCriteria: task!.acceptanceCriteria.map((c) => c.text),
      requiredValidations: task!.requiredValidations,
      branch,
    };
    const record = recordsByTask.get(taskId);
    const head = heads.get(taskId);
    const commitEvidence = record && head ? normalizeCommitApprovalEvidence({
      taskId,
      branch,
      expectedHeadSha: head.headSha,
      changedPaths: dirtyPaths.get(taskId) ?? [],
      contentIdentities: identitiesOf(taskId, dirtyPaths.get(taskId) ?? []),
      gitMetadataDigest: metadataOf(taskId),
      allowedScope: contract.allowedScope,
      validations: record.validations,
      // The Manager's final acceptance record (incl. owner-constraint verdicts the loop added).
      acceptance: snap.evidence?.acceptance ?? record.acceptance,
      observedRisk: record.observedRisk,
      managerDecision: "accepted",
      action: COMMIT_PUBLISH_ACTION,
      authorization: { commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false },
    }) : null;
    const defaults =
      phase === "pre_execution"
        ? {
            kind: "start" as ApprovalKind,
            requestedAction: APPROVAL_ACTIONS.pre_execution,
            // A parked red-risk repair is approved against its own new plan.
            bindingShaOrActionId: snap.pendingRepair?.approvalBinding ?? snap.pendingRetry?.approvalBinding ?? redStartBindingId(contract),
          }
        : phase === "commit_publish"
          ? {
              kind: "commit_publish" as ApprovalKind,
              requestedAction: APPROVAL_ACTIONS.commit_publish,
              bindingShaOrActionId: commitEvidence ? commitApprovalBinding(commitEvidence) : "missing",
            }
        : {
            kind: "merge" as ApprovalKind,
            requestedAction: APPROVAL_ACTIONS.post_qa,
            bindingShaOrActionId: snap.headSha as string,
          };
    const approval = approvals.create({
      id: `approval-${taskId}-${phase}-${approvals.listByTask(taskId).length + 1}`,
      taskId,
      expiresAt: "2026-10-05T12:00:00.000Z",
      ...defaults,
      ...overrides,
    });
    return status === "expired"
      ? approvals.expire(approval.id)
      : approvals.decide(approval.id, {
          status,
          decidedBy: "human-1",
          channel: "test",
        });
  };
  const approve: Simulation["approve"] = (taskId, phase, overrides) => decideApproval(taskId, phase, "approved", overrides);

  async function maybeAutoApproveCommit(taskId: string) {
    if (opts.autoApproveCommits === false || loop.task(taskId)?.approvalPhase !== "commit_publish") return;
    approve(taskId, "commit_publish");
    loop.post({ type: "approval_granted", taskId, phase: "commit_publish" });
    await loop.settle();
  }

  return {
    loop,
    ports,
    remote,
    audit,
    workerCalls,
    qaReads,
    qaDecisions,
    trustedRecords,
    commits,
    approvals,
    approve,
    rejectApproval: (taskId, phase) => decideApproval(taskId, phase, "rejected"),
    expireApproval: (taskId, phase) => decideApproval(taskId, phase, "expired"),
    mutateWorkspace(taskId, change) {
      if (change.gitMetadataDigest !== undefined) gitMetadata.set(taskId, change.gitMetadataDigest);
      const files = contents.get(taskId) ?? new Map<string, string | null>();
      const dirty = new Set(dirtyPaths.get(taskId) ?? []);
      for (const [path, bytes] of Object.entries(change.files ?? {})) {
        files.set(path, bytes);
        dirty.add(path);
      }
      contents.set(taskId, files);
      dirtyPaths.set(taskId, Array.from(dirty).sort());
    },
    releaseWorker(taskId) {
      const f = held.get(taskId);
      if (!f) return false;
      held.delete(taskId);
      f();
      return true;
    },
    async create(task) {
      intakes.set(task.taskId, structuredClone(task));
      loop.post({ type: "task_created", task });
      await loop.settle();
      await maybeAutoApproveCommit(task.taskId);
    },
    async send(event) {
      loop.post(event);
      await loop.settle();
      const eventTaskId = "taskId" in event ? event.taskId : event.type === "task_created" ? event.task.taskId : null;
      if (eventTaskId) await maybeAutoApproveCommit(eventTaskId);
    },
  };
}

export interface FakeIntakeInput {
  taskId: string;
  title?: string;
  category?: TaskCategory;
  actions?: TaskAction[];
  expectedPaths?: string[];
  workspaceId?: string;
  availability?: WorkerAvailability;
  allowClaudeToCodexFallback?: boolean;
}

/** A classified, routed intake. Classification and routing use the real domain policy. */
export function fakeIntake(input: FakeIntakeInput, overrides: Partial<TaskIntake> = {}): TaskIntake {
  const category = input.category ?? "bug_fix";
  const actions = input.actions ?? [{ kind: "code_edit" }, { kind: "run_tests" }];
  const expectedPaths = input.expectedPaths ?? [`server/${input.taskId}/`];
  const classification = classifyTask({
    id: input.taskId,
    category,
    actions,
    changedPaths: expectedPaths,
  });
  const routing = routeTask(classification, input.availability ?? { claude: "available", codex: "available" }, {
    allowClaudeToCodexFallback: input.allowClaudeToCodexFallback,
  });
  return {
    taskId: input.taskId,
    title: input.title ?? `Fix ${input.taskId}`,
    category,
    actions,
    classification,
    routing,
    expectedPaths,
    objective: `Implement task ${input.taskId}.`,
    summary: `Task ${input.taskId}`,
    acceptanceCriteria: [{ id: "AC-1", text: "Behaviour is covered by tests" }],
    requiredValidations: ["tests", "typecheck"],
    workspaceId: input.workspaceId ?? `ws-${input.taskId}`,
    ...overrides,
  };
}

/** Polls QA once per call (as an external timer would) until the task leaves qa_pending; bounded. */
export async function driveQa(sim: Simulation, taskId: string, maxPolls = 10): Promise<number> {
  let polls = 0;
  let approvals = 0;
  while (polls < maxPolls) {
    const task = sim.loop.task(taskId);
    if (task?.approvalPhase === "commit_publish" && task.status === "needs_human_approval") {
      // Bounded: an approval that does not take (binding mismatch) must fail the test, not hang it.
      if (++approvals > 3) throw new Error(`[fake] commit approval for ${taskId} did not take`);
      sim.approve(taskId, "commit_publish");
      await sim.send({ type: "approval_granted", taskId, phase: "commit_publish" });
      continue;
    }
    if (task?.status !== "qa_pending") break;
    await sim.send({ type: "qa_updated", taskId });
    polls++;
  }
  return polls;
}
