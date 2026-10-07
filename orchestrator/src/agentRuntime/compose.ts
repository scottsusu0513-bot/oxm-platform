import { randomBytes } from "node:crypto";
import { createCodespaceLifecycleController } from "../codespace/controller";
import { createFixedCodespaceClient } from "../codespace/client";
import { createLifecycleLeaseRegistry } from "../codespace/lease";
import { createMemoryLifecycleStateRepository } from "../codespace/state";
import { checkLiveSafety, createGhReadTransport, readCodespaceObservation } from "../e2e/liveAdapters";
import { createFakeGatewayAudit, createFakeRateLimiter, createInMemoryGatewayDecisionRepository, createInMemoryHumanDecisionRepository } from "../gateway/fake";
import { createManagerApprovalRequirementReader, createManagerHumanDecisionReader, createManagerLoopGatewayEvents } from "../gateway/integration";
import { createAgentGatewayService } from "../gateway/service";
import type { AgentGatewayService } from "../gateway/types";
import { createGitHubReadClient } from "../github/client";
import { DEFAULT_REQUIRED_CHECKS } from "../github/types";
import { createGitHubWriteClient } from "../githubWrite/client";
import { createWorkspaceLeaseRegistry } from "../githubWrite/lease";
import { createGhCliWriteTransport, createGitPushTransport } from "../githubWrite/transport";
import type { HumanOwnerSession } from "../humanInteraction/auth";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createManagerLoopRuntimePort } from "../intake/runtime";
import { createAgentRuntimeService } from "../intake/service";
import { createRepositoryJournal, REPOSITORY_JOURNAL_EVENT } from "../persistence/journal";
import { createApprovalPort, createQaPort, createRepoStatePort, createWorkerPort, createWorkspacePort } from "../scheduler/adapters";
import { createManagerLoop, type ManagerLoop } from "../scheduler/loop";
import { createAuditCheckpointRepository } from "../scheduler/persistence";
import { TERMINAL_ORCHESTRATION_STATUSES } from "../scheduler/types";
import { createInMemoryApprovalRepository, createInMemoryTaskRepository, createInMemoryTaskRunRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createGitInspector } from "../workers/gitInspector";
import { createNodeProcessRunner } from "../workers/processRunner";
import type { ProcessRunner, WorkerAdapter } from "../workers/types";
import { createLocalClaudeCodeAdapter, createLocalCodexAdapter } from "../workers/workerAdapter";
import { createReadOnlySnapshotAdapter, routeByMode } from "./readOnlySnapshot";
import { AGENT_RUNTIME_CONFIRMATION, type AgentRuntimeConfig } from "./config";
import { describeIssues, reconcileRuntimeState } from "./reconcile";
import { createRepoFileReader, createWorkingTreeDiff } from "./reviewEvidence";
import type { GoalReviewer, IntentPlanner } from "../planning/types";
import { createInMemoryInterpretationRepository } from "../gateway/fake";
import { createTrustedValidationEvidencePort } from "./validation";

export interface AgentRuntimeOptions {
  /** Durable append-only audit repository: Manager checkpoint + journaled runtime/Gateway repositories. */
  audit: AuditRepository;
  /** The only Gateway principal of this runtime (the human owner behind a transport). */
  owner: HumanOwnerSession;
  /** Apply the deterministic recoveries for recoverable startup disagreements. */
  reconcile?: boolean;
  runner?: ProcessRunner;
  nextTaskId?: () => string;
  /** Trusted planning layer (Claude-backed in production); null disables natural-language intake and goal review. */
  planner?: IntentPlanner | null;
  reviewer?: GoalReviewer | null;
}

export interface AgentRuntime {
  loop: ManagerLoop;
  gateway: AgentGatewayService;
  checkpointRestored: boolean;
  restoredTaskIds: string[];
  /** Human-readable descriptions of recoveries applied by --reconcile. */
  reconciled: string[];
  activeTaskIds(): string[];
  allTaskIds(): string[];
}

export type AgentRuntimeResult = { ok: true; runtime: AgentRuntime } | { ok: false; code: string; reason: string; diagnostics: string[] };

/** Trusted task ids: generated here, never supplied by a transport. */
export function defaultTaskIdGenerator(): () => string {
  return () => {
    const d = new Date();
    const day = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    return `t${day}-${randomBytes(3).toString("hex")}`;
  };
}

/**
 * The long-lived OXM Agent runtime: the normal intake → Manager → planner →
 * Worker → validation → repair → approval → Trusted Git pipeline for many
 * tasks, made durable through the audit repository. A transport (Telegram)
 * only reaches it through the returned Gateway with the owner session.
 */
export async function createAgentRuntime(config: AgentRuntimeConfig, options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
  const runner = options.runner ?? createNodeProcessRunner();
  const now = () => new Date().toISOString();
  const bootId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  let auditSequence = 0;
  const nextAuditId = () => `agent-${bootId}-${++auditSequence}`;
  const fail = (code: string, reason: string, diagnostics: string[] = []): AgentRuntimeResult => ({ ok: false, code, reason, diagnostics });

  const checkpoints = createAuditCheckpointRepository({ audit: options.audit, nextId: nextAuditId });
  let checkpoint: ReturnType<typeof checkpoints.load>;
  try {
    checkpoint = checkpoints.load();
  } catch {
    return fail("checkpoint_unreadable", "Manager checkpoint could not be read; refusing to start");
  }
  const active = (checkpoint?.tasks ?? []).filter((t) => !TERMINAL_ORCHESTRATION_STATUSES.includes(t.status));
  const dirtyBranches = Array.from(new Set(active.filter((t) => t.plan && !t.receipt).map((t) => t.plan!.branch)));

  const workerCommands = [
    ...(config.workers.codex ? [{ kind: "codex", command: config.workers.codex.command ?? "codex" }] : []),
    ...(config.workers.claude ? [{ kind: "claude", command: config.workers.claude.command ?? "claude" }] : []),
  ];
  const safety = await checkLiveSafety(config.base, runner, { dirtyBranches, expectedConfirmation: AGENT_RUNTIME_CONFIRMATION, workerCommands });
  if (!safety.ok) {
    const failed = safety.checks.find((c) => !c.ok);
    return fail(safety.failureCode, failed?.reason ?? "live safety gate failed");
  }

  // Durable runtime / Gateway repositories (journaled into the audit log) and replay.
  const journal = createRepositoryJournal({ audit: options.audit, nextId: nextAuditId, now });
  const clock = journal.clock;
  const tasks = journal.wrap("tasks", createInMemoryTaskRepository(clock), ["create", "update", "transition"]);
  const runs = journal.wrap("runs", createInMemoryTaskRunRepository(clock), ["create", "update"]);
  const approvals = journal.wrap("approvals", createInMemoryApprovalRepository(clock), ["create", "decide", "expire"]);
  const intakeRecords = journal.wrap("intakeRecords", createInMemoryIntakeRepository(), ["create", "update"]);
  const gatewayDecisions = journal.wrap("gatewayDecisions", createInMemoryGatewayDecisionRepository(), ["create", "markEventEmitted"]);
  const humanDecisionSubmissions = journal.wrap("humanDecisionSubmissions", createInMemoryHumanDecisionRepository(), ["create", "markEventEmitted"]);
  // Stored interpretations make a redelivered owner message deterministic (the planner is never asked twice).
  const interpretations = journal.wrap("interpretations", createInMemoryInterpretationRepository(), ["create"]);
  try {
    journal.replay();
  } catch {
    return fail("journal_replay_failed", "durable runtime journal could not be replayed; refusing to start");
  }

  // Startup consistency between the journal and the Manager checkpoint.
  const runtimeTaskIds = Array.from(
    new Set(
      options.audit
        .list({ taskId: "repository-journal" })
        .filter((e) => e.event === REPOSITORY_JOURNAL_EVENT && e.metadata.repository === "intakeRecords" && e.metadata.method === "create")
        .map((e) => ((e.metadata.args as { taskId?: unknown }[] | undefined)?.[0]?.taskId as string | undefined) ?? "")
        .filter(Boolean),
    ),
  );
  const consistency = reconcileRuntimeState({
    checkpointTasks: (checkpoint?.tasks ?? []).map((t) => ({ taskId: t.intake.taskId, status: t.status, state: t.state })),
    runtimeTasks: runtimeTaskIds.map((taskId) => ({ taskId, state: tasks.get(taskId)?.state ?? null, hasIntakeRecord: intakeRecords.getByTask(taskId) !== null })),
  });
  const reconciled: string[] = [];
  if (!consistency.ok) {
    const diagnostics = describeIssues(consistency.issues);
    if (!options.reconcile || consistency.issues.some((i) => !i.recoverable))
      return fail("state_disagreement", "runtime journal and Manager checkpoint disagree; refusing to continue any task", diagnostics);
    for (const issue of consistency.issues) {
      if (issue.kind !== "runtime_task_not_in_checkpoint") continue;
      tasks.transition(issue.taskId, "cancelled");
      intakeRecords.update(issue.taskId, { controlState: "cancel_requested", updatedAt: now() });
      options.audit.append({ id: nextAuditId(), taskId: issue.taskId, actor: "system", event: "runtime_reconciled", metadata: { action: issue.action } });
      reconciled.push(`${issue.taskId}: cancelled never-started runtime record`);
    }
  }

  const repo = config.base.expectedRepository;
  const writeTransport = createGhCliWriteTransport(runner, config.base.repoRoot);
  const github = createGitHubWriteClient(repo, { transport: writeTransport, push: createGitPushTransport(runner, config.base.repoRoot) });
  const leases = createWorkspaceLeaseRegistry();
  const git = createGitInspector(runner, config.base.repoRoot);
  const identity = {
    codespaceName: config.base.codespaceName,
    repository: { owner: repo.owner, repository: repo.repo },
    expectedRepository: { owner: repo.owner, repository: repo.repo },
    sourceRepository: { owner: repo.owner, repository: repo.repo },
    expectedBranch: "main",
    workspacePath: config.base.workspacePath,
  };
  const lifecycleController = createCodespaceLifecycleController({
    identity,
    ports: {
      client: createFixedCodespaceClient(identity, {
        async status() {
          const observation = await readCodespaceObservation(runner, config.base);
          if (!observation) throw new Error("Codespace status unavailable");
          return observation;
        },
        async start() {
          throw new Error("the Agent runtime never starts a Codespace");
        },
        async stop() {
          throw new Error("the Agent runtime never stops a Codespace");
        },
      }),
      persistence: createMemoryLifecycleStateRepository(),
      leases: createLifecycleLeaseRegistry(),
      audit() {},
    },
    policy: { autoStart: false, autoStop: false },
  });
  const unavailable = (kind: "claude" | "codex"): WorkerAdapter => ({
    kind,
    start() {
      throw new Error(`${kind} is not enabled in this runtime`);
    },
  });
  const timeoutMs = config.workerTimeoutMs;
  const claude = config.workers.claude;
  const codex = config.workers.codex;
  // Read-only contracts never run in the authoritative workspace: each gets a disposable snapshot.
  const isolated = (kind: "claude" | "codex", make: (root: string) => WorkerAdapter, change: WorkerAdapter) =>
    routeByMode(change, createReadOnlySnapshotAdapter({ kind, repoRoot: config.base.repoRoot, runner, makeAdapter: make }));
  const worker = createWorkerPort({
    claude: claude
      ? isolated(
          "claude",
          (root) => createLocalClaudeCodeAdapter({ command: claude.command, model: claude.model, repoRoot: root, timeoutMs }),
          createLocalClaudeCodeAdapter({ command: claude.command, model: claude.model, repoRoot: config.base.repoRoot, timeoutMs }),
        )
      : unavailable("claude"),
    codex: codex
      ? isolated(
          "codex",
          (root) => createLocalCodexAdapter({ command: codex.command, model: codex.model, repoRoot: root, timeoutMs }),
          createLocalCodexAdapter({ command: codex.command, model: codex.model, repoRoot: config.base.repoRoot, timeoutMs }),
        )
      : unavailable("codex"),
    now,
  });
  const loop = createManagerLoop({
    github,
    leases,
    workspace: createWorkspacePort({ runner, git, repoRoot: config.base.repoRoot, leases }),
    worker,
    evidence: createTrustedValidationEvidencePort({
      git,
      runner,
      repoRoot: config.base.repoRoot,
      timeoutMs: config.validationTimeoutMs,
      reviewer: options.reviewer ?? null,
      diff: createWorkingTreeDiff(runner, config.base.repoRoot),
      readFile: createRepoFileReader(config.base.repoRoot),
    }),
    qa: createQaPort(createGitHubReadClient(createGhReadTransport(runner, config.base.repoRoot)), repo, DEFAULT_REQUIRED_CHECKS),
    repo: createRepoStatePort(writeTransport, repo),
    approvals: createApprovalPort(approvals, now),
    persistence: checkpoints,
    now,
    audit(event) {
      options.audit.append({ id: nextAuditId(), ...event });
    },
    lifecycle: { reconcile: (...args) => lifecycleController.reconcile(...args) },
  });
  const generate = options.nextTaskId ?? defaultTaskIdGenerator();
  const runtime = createAgentRuntimeService({
    tasks,
    runs,
    approvals,
    audit: options.audit,
    intakeRecords,
    scheduler: createManagerLoopRuntimePort(loop),
    workerAvailability: () => ({ claude: config.workers.claude ? "available" : "unavailable", codex: config.workers.codex ? "available" : "unavailable" }),
    nextTaskId: () => {
      for (let i = 0; i < 16; i++) {
        const id = generate();
        if (!tasks.get(id)) return id;
      }
      throw new Error("[agent-runtime] could not allocate a unique task id");
    },
    nextAuditId,
    now,
  });
  const gateway = createAgentGatewayService({
    authenticator: options.owner.authenticator,
    runtime,
    approvals,
    approvalRequirements: createManagerApprovalRequirementReader(loop),
    decisions: gatewayDecisions,
    events: createManagerLoopGatewayEvents(loop),
    humanDecisionRequirements: createManagerHumanDecisionReader(loop, (id) => tasks.get(id)?.requesterId ?? null),
    humanDecisionSubmissions,
    ...(options.planner ? { intentPlanner: options.planner } : {}),
    interpretations,
    taskDirectory: () =>
      loop
        .tasks()
        .reverse()
        .map((t) => ({ taskId: t.taskId, title: t.title, status: t.status, mode: t.mode })),
    rateLimiter: createFakeRateLimiter(),
    audit: createFakeGatewayAudit(),
    now,
  });

  try {
    await loop.resume();
  } catch {
    return fail("checkpoint_resume_failed", "Manager checkpoint could not be resumed; refusing to start");
  }
  for (const issue of consistency.issues) {
    if (issue.kind !== "runtime_cancelled_but_manager_active") continue;
    const result = loop.cancel(issue.taskId);
    reconciled.push(`${issue.taskId}: ${result.ok ? "honoured recorded cancellation in the Manager" : `could not cancel (${result.reason ?? "unknown"})`}`);
  }
  const isActive = (status: string) => !TERMINAL_ORCHESTRATION_STATUSES.includes(status as never);
  return {
    ok: true,
    runtime: {
      loop,
      gateway,
      checkpointRestored: checkpoint !== null,
      restoredTaskIds: loop.tasks().map((t) => t.taskId),
      reconciled,
      activeTaskIds: () => loop.tasks().filter((t) => isActive(t.status)).map((t) => t.taskId),
      allTaskIds: () => loop.tasks().map((t) => t.taskId),
    },
  };
}
