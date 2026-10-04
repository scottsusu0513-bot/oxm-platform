import { isPlannerApproved } from "../branches/planner";
import { classifyTask } from "../domain/risk";
import { routeTask } from "../domain/routing";
import type { TaskAction, TaskCategory, WorkerAvailability, WorkerKind } from "../domain/types";
import { evaluateQa } from "../github/qa";
import { DEFAULT_REQUIRED_CHECKS, type CheckObservation } from "../github/types";
import { createGitHubWriteClient } from "../githubWrite/client";
import { createFakeRemote, type FakeRemote } from "../githubWrite/fake";
import { createWorkspaceLeaseRegistry, type WorkspaceLease } from "../githubWrite/lease";
import type { PreparedWorkspace } from "../githubWrite/workspace";
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

export type WorkerScript = "success" | "failure" | "validation_failed" | "scope_violation" | "risk_red";
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
}

export interface WorkerCall {
  kind: WorkerKind;
  taskId: string;
  runId: string;
  branch: string;
  expectedHeadSha: string | null;
  repair: boolean;
}

export interface Simulation {
  loop: ManagerLoop;
  ports: OrchestrationPorts;
  remote: FakeRemote;
  audit: Omit<NewAuditEvent, "id">[];
  workerCalls: WorkerCall[];
  qaReads: number[];
  approvals: ReturnType<typeof createInMemoryApprovalRepository>;
  approve(taskId: string, phase: "pre_execution" | "post_qa", overrides?: Partial<Pick<Approval, "taskId" | "kind" | "requestedAction" | "bindingShaOrActionId" | "expiresAt">>): Approval;
  rejectApproval(taskId: string, phase: "pre_execution" | "post_qa"): Approval;
  expireApproval(taskId: string, phase: "pre_execution" | "post_qa"): Approval;
  releaseWorker(taskId: string): boolean;
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
  const audit: Omit<NewAuditEvent, "id">[] = [];
  const workerCalls: WorkerCall[] = [];
  const qaReads: number[] = [];
  const runsByTask = new Map<string, number>();
  const held = new Map<string, () => void>();
  let nextSha = 0xb0000;
  let mainReads = 0;
  const now = () => "2026-10-04T12:00:00.000Z";
  const approvals = createInMemoryApprovalRepository(now);
  const intakes = new Map<string, TaskIntake>();

  const resultFor = (c: WorkerTaskContract, script: WorkerScript): WorkerResult => {
    const start = c.expectedHeadSha ?? null;
    const commit = () => {
      const s = sha(++nextSha);
      if (start) parents.set(s, start);
      heads.set(c.taskId, { branch: c.branch, headSha: s });
      return s;
    };
    const files = c.allowedScope.map((p) => (p.endsWith("/") ? `${p}index.ts` : p));
    const base: WorkerResult = {
      status: "success",
      summary: "done",
      filesChanged: files,
      testsRun: [
        { command: "pnpm test", outcome: "passed" },
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
    switch (script) {
      case "success":
        return { ...base, headSha: commit() };
      case "risk_red":
        return { ...base, headSha: commit(), riskObserved: { level: "red", notes: ["observed red"] } };
      case "failure":
        return { ...base, status: "failure", filesChanged: [], testsRun: [], checkResult: "not_run", headSha: start, errorType: "worker_failure" };
      case "validation_failed":
        return {
          ...base,
          status: "failure",
          headSha: commit(),
          testsRun: [
            { command: "pnpm test", outcome: "failed" },
            { command: "pnpm check", outcome: "passed" },
          ],
          checkResult: "failed",
          errorType: "validation_incomplete",
        };
      case "scope_violation":
        return { ...base, status: "failure", headSha: commit(), filesChanged: [...files, "server/unrelated.ts"], errorType: "scope_violation" };
    }
  };

  const ports: OrchestrationPorts = {
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
        if (!isPlannerApproved(plan)) return { ok: false, error: "policy_violation", reason: "plan not approved" };
        if (!leases.holds(lease) || (lease as WorkspaceLease).taskId !== plan.taskId) return { ok: false, error: "lease_conflict", reason: "lease not held" };
        const headSha = plan.decision === "reuse_branch" ? plan.headSha : plan.baseSha;
        heads.set(plan.taskId, { branch: plan.branch, headSha });
        const prepared: PreparedWorkspace = Object.freeze({
          workspaceId: lease.workspaceId,
          leaseId: lease.leaseId,
          taskId: plan.taskId,
          branch: plan.branch,
          headSha,
          allowedDirtyPaths: [],
        });
        return { ok: true, prepared };
      },
      async checkPreconditions({ prepared, contract, lease }) {
        const p = prepared as PreparedWorkspace;
        if (!leases.holds(lease)) return { ok: false, reason: "lease not held" };
        if (contract.taskId !== p.taskId || contract.branch !== p.branch) return { ok: false, reason: "contract not bound to prepared branch" };
        return { ok: true, contract: { ...contract, expectedHeadSha: p.headSha } };
      },
      async head(lease) {
        return heads.get(lease.taskId) ?? null;
      },
    },
    worker: {
      start(kind, contract): WorkerHandle {
        const n = (runsByTask.get(contract.taskId) ?? 0) + 1;
        runsByTask.set(contract.taskId, n);
        workerCalls.push({
          kind,
          taskId: contract.taskId,
          runId: contract.runId,
          branch: contract.branch,
          expectedHeadSha: contract.expectedHeadSha ?? null,
          repair: contract.objective.includes("Repair attempt"),
        });
        const script = opts.worker?.[contract.taskId] ?? ["success"];
        const outcome = script[Math.min(n - 1, script.length - 1)];
        const result = new Promise<WorkerResult>((resolve) => {
          const finish = () => resolve(resultFor(contract, outcome));
          if (opts.holdWorkers) held.set(contract.taskId, finish);
          else finish();
        });
        return { runId: contract.runId, promptHash: "f".repeat(64), result, cancel() {} };
      },
    },
    evidence: {
      async record({ contract, result, lease }): Promise<TrustedRunRecord> {
        const outcomeOf = (needle: string) => result.testsRun.find((r) => r.command.includes(needle))?.outcome ?? "not_run";
        const validations = contract.requiredValidations.map((name) => {
          const o = outcomeOf(name === "tests" ? "test" : "check");
          return { name, requested: true, executed: o !== "not_run", status: o === "passed" ? ("passed" as const) : o === "failed" ? ("failed" as const) : ("missing" as const), trusted: true };
        });
        const testsPassed = validations.find((v) => v.name === "tests")?.status === "passed";
        return {
          changedPaths: result.filesChanged,
          validations,
          acceptance: contract.acceptanceCriteria.map((_, i) => ({
            criterionId: `AC-${i + 1}`,
            status: testsPassed ? ("satisfied" as const) : ("failed" as const),
            evidenceType: "validation" as const,
            reference: "tests",
          })),
          verifiedHeadSha: heads.get(lease.taskId)?.headSha ?? null,
          observedRisk: result.riskObserved.level,
        };
      },
    },
    approvals: createApprovalPort(approvals, now),
    persistence: opts.persistence,
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
        const checks: CheckObservation[] = DEFAULT_REQUIRED_CHECKS.map((r) => ({
          source: "check_run",
          name: r.name,
          headSha,
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
        return evaluateQa({
          pr: { number: prNumber, state: "open", draft: Boolean(raw.draft), headSha, headRef: branch, baseRef: raw.base.ref },
          required: DEFAULT_REQUIRED_CHECKS,
          checks,
        });
      },
    },
  };

  const loop = createManagerLoop(ports, opts.policy);
  const decideApproval = (taskId: string, phase: "pre_execution" | "post_qa", status: "approved" | "rejected" | "expired", overrides = {}) => {
    const task = intakes.get(taskId);
    const snap = loop.task(taskId);
    if (!task || !snap) throw new Error(`unknown task ${taskId}`);
    const branch = snap.branch ?? taskBranchName(task.lineage?.rootTaskId ?? task.taskId, task.lineage?.title ?? task.title, task.category);
    const contract: WorkerTaskContract = {
      taskId: task.taskId,
      runId: `${task.taskId}-approval-binding`,
      category: task.category,
      actions: task.actions,
      changedPaths: task.expectedPaths,
      storedRiskLevel: task.classification.risk.level,
      objective: task.objective,
      allowedScope: task.allowedScope ?? task.expectedPaths,
      acceptanceCriteria: task.acceptanceCriteria.map((c) => c.text),
      requiredValidations: task.requiredValidations,
      branch,
    };
    const defaults = phase === "pre_execution"
      ? { kind: "start" as ApprovalKind, requestedAction: APPROVAL_ACTIONS.pre_execution, bindingShaOrActionId: redStartBindingId(contract) }
      : { kind: "merge" as ApprovalKind, requestedAction: APPROVAL_ACTIONS.post_qa, bindingShaOrActionId: snap.headSha as string };
    const approval = approvals.create({
      id: `approval-${taskId}-${phase}-${approvals.listByTask(taskId).length + 1}`,
      taskId,
      expiresAt: "2026-10-05T12:00:00.000Z",
      ...defaults,
      ...overrides,
    });
    return status === "expired"
      ? approvals.expire(approval.id)
      : approvals.decide(approval.id, { status, decidedBy: "human-1", channel: "test" });
  };
  const approve: Simulation["approve"] = (taskId, phase, overrides) => decideApproval(taskId, phase, "approved", overrides);

  return {
    loop,
    ports,
    remote,
    audit,
    workerCalls,
    qaReads,
    approvals,
    approve,
    rejectApproval: (taskId, phase) => decideApproval(taskId, phase, "rejected"),
    expireApproval: (taskId, phase) => decideApproval(taskId, phase, "expired"),
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
    },
    async send(event) {
      loop.post(event);
      await loop.settle();
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
}

/** A classified, routed intake. Classification and routing use the real domain policy. */
export function fakeIntake(input: FakeIntakeInput, overrides: Partial<TaskIntake> = {}): TaskIntake {
  const category = input.category ?? "bug_fix";
  const actions = input.actions ?? [{ kind: "code_edit" }, { kind: "run_tests" }];
  const expectedPaths = input.expectedPaths ?? [`server/${input.taskId}/`];
  const classification = classifyTask({ id: input.taskId, category, actions, changedPaths: expectedPaths });
  const routing = routeTask(classification, input.availability ?? { claude: "available", codex: "available" });
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
  while (sim.loop.task(taskId)?.status === "qa_pending" && polls < maxPolls) {
    await sim.send({ type: "qa_updated", taskId });
    polls++;
  }
  return polls;
}
