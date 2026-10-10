import { createCodespaceLifecycleController } from "../codespace/controller";
import { createFixedCodespaceClient } from "../codespace/client";
import { createLifecycleLeaseRegistry } from "../codespace/lease";
import { createMemoryLifecycleStateRepository } from "../codespace/state";
import { isSafeWorkspaceRoot } from "../codespace/policy";
import type {
  CodespaceObservation,
  LifecycleDecision,
  TrustedCodespaceStatus,
} from "../codespace/types";
import {
  createFakeAuthenticator,
  createFakeGatewayAudit,
  createFakeRateLimiter,
  createInMemoryGatewayDecisionRepository,
  createInMemoryHumanDecisionRepository,
  fakePrincipal,
} from "../gateway/fake";
import {
  createManagerApprovalRequirementReader,
  createManagerHumanDecisionReader,
  createManagerLoopGatewayEvents,
} from "../gateway/integration";
import { createAgentGatewayService } from "../gateway/service";
import { createGitHubReadClient } from "../github/client";
import { DEFAULT_REQUIRED_CHECKS, type GitHubReadTransport } from "../github/types";
import { createGitHubWriteClient } from "../githubWrite/client";
import { createWorkspaceLeaseRegistry } from "../githubWrite/lease";
import {
  createGhCliWriteTransport,
  createGitPushTransport,
} from "../githubWrite/transport";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createManagerLoopRuntimePort } from "../intake/runtime";
import { createAgentRuntimeService } from "../intake/service";
import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import {
  createApprovalPort,
  createEvidencePort,
  createQaPort,
  createRepoStatePort,
  createWorkerPort,
  createWorkspacePort,
} from "../scheduler/adapters";
import { createManagerLoop } from "../scheduler/loop";
import type { QaPort, TrustedRunRecord } from "../scheduler/types";
import { createMemoryStore } from "../store/memory";
import { createGitInspector } from "../workers/gitInspector";
import { createNodeProcessRunner } from "../workers/processRunner";
import type {
  ProcessExit,
  ProcessRunner,
  WorkerAdapter,
  WorkerResult,
  WorkerTaskContract,
} from "../workers/types";
import { createLocalCodexAdapter } from "../workers/workerAdapter";
import { blockedSmokeReport, runSmokeHarness, smokeTaskDefinition, smokeTaskId } from "./harness";
import type {
  LiveSafetyResult,
  LiveSmokeConfig,
  SafetyCheck,
  SmokeHarnessEnvironment,
  SmokeReport,
} from "./types";
import {
  LIVE_CONFIRMATION,
  SMOKE_FIXTURE_PATH,
  SMOKE_VALIDATION_COMMAND,
} from "./types";

const TOKEN = "internal-live-smoke-principal";
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function exec(
  runner: ProcessRunner,
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<ProcessExit> {
  return runner.spawn({ command, args, cwd }).exit;
}

const successful = (result: ProcessExit) =>
  result.exitCode === 0 && !result.truncated;

function repoName(input: unknown): string | null {
  const value = input as { nameWithOwner?: unknown };
  return typeof value?.nameWithOwner === "string" ? value.nameWithOwner : null;
}

/** Read-only, fail-closed checks. No branch, PR, worker, Codespace or data mutation occurs here. */
export interface LiveSafetyOptions {
  /**
   * Branches whose kept, uncommitted work a durable checkpoint expects (an
   * active, not-yet-pushed task). A dirty worktree is accepted only on one of
   * these exact branches; the Manager re-verifies HEAD and content identities
   * before any resume or commit. Absent: the worktree must be clean.
   */
  dirtyBranches?: readonly string[];
  /** Confirmation value required for this runtime (defaults to the smoke confirmation). */
  expectedConfirmation?: string;
  /** Worker CLIs that must answer --version (defaults to the configured Codex command). */
  workerCommands?: readonly { kind: string; command: string }[];
}

export async function checkLiveSafety(
  config: LiveSmokeConfig,
  runner: ProcessRunner = createNodeProcessRunner(),
  options: LiveSafetyOptions = {},
): Promise<LiveSafetyResult> {
  const checks: SafetyCheck[] = [];
  const add = (name: string, ok: boolean, reason: string) =>
    checks.push({ name, ok, reason });
  add("explicit_live_opt_in", config.live === true, "live flag is required");
  add(
    "explicit_confirmation",
    config.confirmation === (options.expectedConfirmation ?? LIVE_CONFIRMATION),
    "confirmation value does not match",
  );
  add("not_ci", config.ci === false, "live smoke is disabled in CI");
  add(
    "isolated_scope",
    SMOKE_FIXTURE_PATH.startsWith("orchestrator/smoke-fixtures/") &&
      !SMOKE_FIXTURE_PATH.includes(".."),
    "smoke scope must remain inside the dedicated fixture directory",
  );
  add("production_db_disabled", config.productionDbEnabled === false, "production DB access must be disabled");
  add("merge_disabled", config.mergeEnabled === false, "merge must be disabled");
  add("deploy_disabled", config.deployEnabled === false, "deploy must be disabled");
  add("force_push_disabled", config.forcePushEnabled === false, "force push must be disabled");
  add(
    "codespace_binding",
    config.codespaceName.length > 0 &&
      config.codespaceName === config.expectedCodespaceName,
    "configured Codespace does not match the expected Codespace",
  );
  add(
    "workspace_binding",
    config.repoRoot === config.workspacePath &&
      isSafeWorkspaceRoot(config.repoRoot),
    "workspace path does not match the configured repository root",
  );

  const branchResult = await exec(configRunner(runner), config.repoRoot, "git", [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const branch = branchResult.stdout.trim();
  add(
    "non_production_branch",
    successful(branchResult) &&
      branch !== "main" &&
      branch !== "master" &&
      branch !== "HEAD",
    "current branch must be a non-protected branch",
  );

  const status = await exec(configRunner(runner), config.repoRoot, "git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const clean = successful(status) && status.stdout.trim() === "";
  if (options.dirtyBranches && options.dirtyBranches.length > 0 && !clean)
    add(
      "resume_branch_binding",
      successful(status) && successful(branchResult) && options.dirtyBranches.includes(branch),
      "uncommitted work is not on the branch of a checkpointed active task",
    );
  else add("clean_worktree", clean, "working tree must be clean before live side effects");

  const expected = `${config.expectedRepository.owner}/${config.expectedRepository.repo}`;
  const repo = await exec(configRunner(runner), config.repoRoot, "gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
  ]);
  let actualRepo: string | null = null;
  if (successful(repo)) {
    try {
      actualRepo = repoName(JSON.parse(repo.stdout));
    } catch {
      actualRepo = null;
    }
  }
  add(
    "expected_repository",
    actualRepo?.toLowerCase() === expected.toLowerCase(),
    "GitHub repository binding does not match the expected OXM repository",
  );

  const auth = await exec(configRunner(runner), config.repoRoot, "gh", ["auth", "status"]);
  add("github_auth", successful(auth), "GitHub authentication is unavailable");

  const codespace = await readCodespaceObservation(runner, config);
  add(
    "codespace_available",
    codespace !== null &&
      codespace.status === "available" &&
      codespace.codespaceName === config.expectedCodespaceName &&
      `${codespace.repository.owner}/${codespace.repository.repository}`.toLowerCase() ===
        expected.toLowerCase(),
    "expected Codespace is unavailable or bound to another repository",
  );

  for (const w of options.workerCommands ?? [{ kind: "codex", command: config.codexCommand ?? "codex" }]) {
    const worker = await exec(configRunner(runner), config.repoRoot, w.command, ["--version"]);
    add(w.kind === "codex" ? "worker_runtime" : `worker_runtime_${w.kind}`, successful(worker), `${w.kind === "codex" ? "Codex" : "Claude"} runtime is unavailable`);
  }

  const failed = checks.find((check) => !check.ok);
  return failed
    ? { ok: false, checks, failureCode: `safety_${failed.name}` }
    : { ok: true, checks, branch };
}

// Keeps the runner injection explicit in every command call and easy to audit.
const configRunner = (runner: ProcessRunner) => runner;

function mapCodespaceStatus(value: unknown): TrustedCodespaceStatus {
  const state = String(value ?? "").toLowerCase();
  if (["available", "running"].includes(state)) return "available";
  if (["starting", "provisioning", "rebuilding"].includes(state)) return "starting";
  if (["stopped", "shutdown"].includes(state)) return "stopped";
  if (["stopping", "shuttingdown"].includes(state)) return "stopping";
  if (["failed", "unavailable"].includes(state)) return "failed";
  return "unknown";
}

export async function readCodespaceObservation(
  runner: ProcessRunner,
  config: LiveSmokeConfig,
): Promise<CodespaceObservation | null> {
  const result = await exec(runner, config.repoRoot, "gh", [
    "api",
    `user/codespaces/${config.codespaceName}`,
  ]);
  if (!successful(result)) return null;
  try {
    const raw = JSON.parse(result.stdout) as {
      name?: unknown;
      state?: unknown;
      repository?: { full_name?: unknown };
    };
    const fullName = String(raw.repository?.full_name ?? "");
    const [owner, repository, extra] = fullName.split("/");
    if (
      extra ||
      typeof raw.name !== "string" ||
      !owner ||
      !repository
    )
      return null;
    return {
      status: mapCodespaceStatus(raw.state),
      observedAt: new Date().toISOString(),
      repository: { owner, repository },
      codespaceName: raw.name,
    };
  } catch {
    return null;
  }
}

export function createGhReadTransport(
  runner: ProcessRunner,
  repoRoot: string,
): GitHubReadTransport {
  const call = async (path: string) => {
    const result = await exec(runner, repoRoot, "gh", ["api", path]);
    if (!successful(result)) throw new Error("GitHub read failed");
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("GitHub read returned malformed JSON");
    }
  };
  const path = (owner: string, repo: string) => `repos/${owner}/${repo}`;
  return {
    async getPullRequest(repo, number) {
      return (await call(`${path(repo.owner, repo.repo)}/pulls/${number}`)) as Awaited<
        ReturnType<GitHubReadTransport["getPullRequest"]>
      >;
    },
    async listCheckRuns(repo, sha) {
      const raw = (await call(
        `${path(repo.owner, repo.repo)}/commits/${sha}/check-runs?filter=latest`,
      )) as { check_runs?: unknown };
      if (!Array.isArray(raw.check_runs)) throw new Error("GitHub check list is malformed");
      return raw.check_runs as Awaited<ReturnType<GitHubReadTransport["listCheckRuns"]>>;
    },
    async listCommitStatuses(repo, sha) {
      const raw = (await call(
        `${path(repo.owner, repo.repo)}/commits/${sha}/status`,
      )) as { statuses?: unknown };
      if (!Array.isArray(raw.statuses)) throw new Error("GitHub status list is malformed");
      return raw.statuses as Awaited<ReturnType<GitHubReadTransport["listCommitStatuses"]>>;
    },
  };
}

const validationEvidence = (
  contract: WorkerTaskContract,
  result: WorkerResult,
): ValidationEvidence[] =>
  contract.requiredValidations.map((name) => {
    const passed =
      name === "smoke" &&
      result.testsRun.some(
        (test) =>
          test.command === SMOKE_VALIDATION_COMMAND && test.outcome === "passed",
      );
    return {
      name,
      requested: true,
      executed: name === "smoke" && result.testsRun.some((test) => test.command === SMOKE_VALIDATION_COMMAND),
      status: passed ? "passed" : "failed",
      trusted: true,
    };
  });

const acceptanceEvidence = (
  contract: WorkerTaskContract,
  result: WorkerResult,
): AcceptanceEvidence[] => {
  const passed =
    result.status === "success" &&
    result.filesChanged.every((path) => path === SMOKE_FIXTURE_PATH) &&
    result.testsRun.some(
      (test) =>
        test.command === SMOKE_VALIDATION_COMMAND && test.outcome === "passed",
    );
  return contract.acceptanceCriteria.map((_, index) => ({
    criterionId: `AC-${index + 1}`,
    status: passed ? "satisfied" : "failed",
    evidenceType: "validation",
    reference: "smoke",
  }));
};

function unavailableClaude(): WorkerAdapter {
  return {
    kind: "claude",
    start() {
      throw new Error("Claude is not enabled for this Codex-routed smoke task");
    },
  };
}

export async function createLiveSmokeEnvironment(
  config: LiveSmokeConfig,
  smokeRunId: string,
): Promise<{ ok: true; environment: SmokeHarnessEnvironment } | { ok: false; report: SmokeReport }> {
  const at = new Date().toISOString();
  if (!RUN_ID.test(smokeRunId)) {
    return {
      ok: false,
      report: blockedSmokeReport({
        smokeRunId,
        mode: "live",
        at,
        failureCode: "invalid_smoke_run_id",
        reason: "smoke run id must be lowercase letters, digits, and hyphens",
      }),
    };
  }
  const runner = createNodeProcessRunner();
  const safety = await checkLiveSafety(config, runner);
  if (!safety.ok) {
    const failed = safety.checks.find((check) => !check.ok);
    return {
      ok: false,
      report: blockedSmokeReport({
        smokeRunId,
        mode: "live",
        at,
        failureCode: safety.failureCode,
        reason: failed?.reason ?? "live safety gate failed",
      }),
    };
  }

  const now = () => new Date().toISOString();
  const repo = config.expectedRepository;
  const writeTransport = createGhCliWriteTransport(runner, config.repoRoot);
  const github = createGitHubWriteClient(repo, {
    transport: writeTransport,
    push: createGitPushTransport(runner, config.repoRoot),
  });
  const leases = createWorkspaceLeaseRegistry();
  const git = createGitInspector(runner, config.repoRoot);
  const lifecycleDecisions: LifecycleDecision[] = [];
  const lifecycleClient = createFixedCodespaceClient(
    {
      codespaceName: config.codespaceName,
      repository: { owner: repo.owner, repository: repo.repo },
      expectedRepository: { owner: repo.owner, repository: repo.repo },
      sourceRepository: { owner: repo.owner, repository: repo.repo },
      expectedBranch: "main",
      workspacePath: config.workspacePath,
    },
    {
      async status() {
        const observation = await readCodespaceObservation(runner, config);
        if (!observation) throw new Error("Codespace status unavailable");
        return observation;
      },
      async start() {
        throw new Error("live smoke never starts a Codespace");
      },
      async stop() {
        throw new Error("live smoke never stops a Codespace");
      },
    },
  );
  const lifecycleController = createCodespaceLifecycleController({
    identity: {
      codespaceName: config.codespaceName,
      repository: { owner: repo.owner, repository: repo.repo },
      expectedRepository: { owner: repo.owner, repository: repo.repo },
      sourceRepository: { owner: repo.owner, repository: repo.repo },
      expectedBranch: "main",
      workspacePath: config.workspacePath,
    },
    ports: {
      client: lifecycleClient,
      persistence: createMemoryLifecycleStateRepository(),
      leases: createLifecycleLeaseRegistry(),
      audit() {},
    },
    policy: { autoStart: false, autoStop: false },
  });
  const trustedRecords: TrustedRunRecord[] = [];
  const qaDecisions: Awaited<ReturnType<QaPort["read"]>>[] = [];
  let baseSha: string | null = null;
  let workerInvocations = 0;
  const evidence = createEvidencePort({
    git,
    validations: validationEvidence,
    acceptance: acceptanceEvidence,
  });
  const qa = createQaPort(
    createGitHubReadClient(createGhReadTransport(runner, config.repoRoot)),
    repo,
    DEFAULT_REQUIRED_CHECKS,
  );
  const store = createMemoryStore(now);
  let auditSequence = 0;
  const nextAuditId = () => `live-smoke-audit-${++auditSequence}`;
  const codex = createLocalCodexAdapter({
    command: config.codexCommand,
    model: config.codexModel,
    repoRoot: config.repoRoot,
    timeoutMs: config.workerTimeoutMs,
  });
  const baseWorker = createWorkerPort({
    claude: unavailableClaude(),
    codex,
    now,
  });
  const repoPort = createRepoStatePort(writeTransport, repo);
  const loop = createManagerLoop({
    github,
    leases,
    workspace: createWorkspacePort({ runner, git, repoRoot: config.repoRoot, leases }),
    worker: {
      start(...args) {
        workerInvocations++;
        return baseWorker.start(...args);
      },
    },
    evidence: {
      async record(input) {
        const record = await evidence.record(input);
        trustedRecords.push(structuredClone(record));
        return record;
      },
    },
    qa: {
      async read(prNumber) {
        const decision = await qa.read(prNumber);
        qaDecisions.push(structuredClone(decision));
        return decision;
      },
    },
    repo: {
      async taskBaseSha() {
        baseSha = await repoPort.taskBaseSha();
        return baseSha;
      },
    },
    approvals: createApprovalPort(store.approvals, now),
    now,
    audit(event) {
      store.audit.append({ id: nextAuditId(), ...event });
    },
    lifecycle: {
      async reconcile(...args) {
        const outcome = await lifecycleController.reconcile(...args);
        lifecycleDecisions.push(structuredClone(outcome.decision));
        return outcome;
      },
    },
  }, {
    // The smoke task's terminal goal is its PR: it is never merged or deployed.
    completion: "pull_request",
  });
  const runtime = createAgentRuntimeService({
    ...store,
    intakeRecords: createInMemoryIntakeRepository(),
    scheduler: createManagerLoopRuntimePort(loop),
    workerAvailability: () => ({ claude: "unavailable", codex: "available" }),
    nextTaskId: () => smokeTaskId(smokeRunId),
    nextAuditId,
    now,
  });
  const gateway = createAgentGatewayService({
    authenticator: createFakeAuthenticator({
      [TOKEN]: fakePrincipal({
        principalId: "e2e-smoke",
        capabilities: ["task:submit", "task:read"],
        now: now(),
      }),
    }),
    runtime,
    approvals: store.approvals,
    approvalRequirements: createManagerApprovalRequirementReader(loop),
    decisions: createInMemoryGatewayDecisionRepository(),
    events: createManagerLoopGatewayEvents(loop),
    humanDecisionRequirements: createManagerHumanDecisionReader(loop, (id) => store.tasks.get(id)?.requesterId ?? null),
    humanDecisionSubmissions: createInMemoryHumanDecisionRepository(),
    rateLimiter: createFakeRateLimiter(),
    audit: createFakeGatewayAudit(),
    now,
  });
  const task = smokeTaskDefinition(smokeRunId);
  const auth = {
    credentials: { token: TOKEN },
    requestId: `request-${smokeRunId}`,
    source: "e2e-smoke-harness",
  };
  const environment: SmokeHarnessEnvironment = {
    mode: "live",
    async submit() {
      const result = await gateway.submitTask({
        authentication: auth,
        request: {
          idempotencyKey: task.idempotencyKey,
          userInstruction: task.instruction,
          title: task.title,
          priority: task.requestedPriority,
          expectedScopeHint: task.expectedScope,
          acceptanceCriteria: task.acceptanceCriteria,
          requiredValidations: task.requiredValidations,
        },
      });
      return { taskId: result.taskId, duplicate: result.duplicate };
    },
    settle: () => loop.settle({ waitForWorkers: true }),
    snapshot: (taskId) => loop.task(taskId),
    async pollQa(taskId) {
      loop.post({ type: "qa_updated", taskId });
    },
    observe(taskId) {
      const snapshot = loop.task(taskId);
      const record = trustedRecords.at(-1);
      const qaDecision = qaDecisions.at(-1);
      return {
        baseSha,
        filesChanged: [...(record?.changedPaths ?? [])],
        validations: [...(record?.validations ?? [])].map((item) => ({ ...item })),
        lifecycleDecisions: structuredClone(lifecycleDecisions),
        ciChecks: structuredClone(qaDecision?.checks ?? []),
        prState: snapshot?.prNumber ? "open" : null,
        workerInvocations,
        workerRuntimeAvailable: true,
        fallbackWorker: null,
      };
    },
    now,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 120_000))),
  };
  return { ok: true, environment };
}

export async function runLiveSmoke(
  config: LiveSmokeConfig,
  smokeRunId: string,
): Promise<SmokeReport> {
  const created = await createLiveSmokeEnvironment(config, smokeRunId);
  if (!created.ok) return created.report;
  return runSmokeHarness(created.environment, {
    smokeRunId,
    maxQaPolls: config.maxQaPolls,
    waitForQa: true,
  });
}
