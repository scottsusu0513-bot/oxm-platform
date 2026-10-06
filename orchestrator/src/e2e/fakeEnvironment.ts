import { taskBranchName } from "../branches/naming";
import { createCodespaceLifecycleController } from "../codespace/controller";
import { createFakeCodespaceClient, FAKE_CODESPACE_IDENTITY } from "../codespace/fake";
import { createLifecycleLeaseRegistry } from "../codespace/lease";
import { createMemoryLifecycleStateRepository } from "../codespace/state";
import type { LifecycleDecision } from "../codespace/types";
import {
  createFakeAuthenticator,
  createFakeGatewayAudit,
  createFakeRateLimiter,
  createInMemoryGatewayDecisionRepository,
  fakePrincipal,
} from "../gateway/fake";
import {
  createManagerApprovalRequirementReader,
  createManagerLoopGatewayEvents,
} from "../gateway/integration";
import { createAgentGatewayService } from "../gateway/service";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createManagerLoopRuntimePort } from "../intake/runtime";
import { createAgentRuntimeService } from "../intake/service";
import { createSimulation, MAIN_SHA, type CiScript, type WorkerScript } from "../scheduler/fake";
import { createMemoryStore } from "../store/memory";
import type { SmokeHarnessEnvironment } from "./types";
import { smokeTaskDefinition } from "./harness";

const NOW = "2026-10-05T12:00:00.000Z";
const TOKEN = "internal-smoke-principal";

export interface FakeSmokeOptions {
  smokeRunId: string;
  worker?: readonly WorkerScript[];
  ci?: readonly CiScript[];
  lifecycleAvailable?: boolean;
  staleQa?: boolean;
  existingPrNumber?: number;
  maxRepairAttempts?: number;
}

export function createFakeSmokeEnvironment(
  options: FakeSmokeOptions,
): SmokeHarnessEnvironment & {
  simulation: ReturnType<typeof createSimulation>;
  networkCalls: string[];
} {
  const taskId = "e2e-smoke";
  const lifecycleDecisions: LifecycleDecision[] = [];
  const fakeCodespace = createFakeCodespaceClient(
    options.lifecycleAvailable === false ? "stopped" : "available",
  );
  const controller = createCodespaceLifecycleController({
    identity: FAKE_CODESPACE_IDENTITY,
    ports: {
      client: fakeCodespace.client,
      persistence: createMemoryLifecycleStateRepository(),
      leases: createLifecycleLeaseRegistry(),
      audit() {},
    },
    policy: { autoStart: false, autoStop: false },
  });
  const lifecycle = {
    async reconcile(...args: Parameters<typeof controller.reconcile>) {
      const outcome = await controller.reconcile(...args);
      lifecycleDecisions.push(structuredClone(outcome.decision));
      return outcome;
    },
  };
  const simulation = createSimulation({
    worker: options.worker ? { [taskId]: options.worker } : undefined,
    ci: options.ci ? { [taskId]: options.ci } : undefined,
    staleQaTaskIds: options.staleQa ? [taskId] : undefined,
    lifecycle,
    policy:
      options.maxRepairAttempts === undefined
        ? undefined
        : { maxRepairAttempts: options.maxRepairAttempts },
  });

  if (options.existingPrNumber) {
    const branch = taskBranchName(
      taskId,
      "chore: agent e2e smoke",
      "ui",
    );
    simulation.remote.prs.set(options.existingPrNumber, {
      number: options.existingPrNumber,
      state: "open",
      draft: false,
      merged: false,
      head: { ref: branch, sha: MAIN_SHA },
      base: { ref: "main" },
    });
  }

  const now = () => NOW;
  const store = createMemoryStore(now);
  const intakeRecords = createInMemoryIntakeRepository();
  let auditSequence = 0;
  const runtime = createAgentRuntimeService({
    ...store,
    intakeRecords,
    scheduler: createManagerLoopRuntimePort(simulation.loop),
    workerAvailability: () => ({ claude: "available", codex: "available" }),
    nextTaskId: () => taskId,
    nextAuditId: () => `smoke-audit-${++auditSequence}`,
    now,
  });
  const gateway = createAgentGatewayService({
    authenticator: createFakeAuthenticator({
      [TOKEN]: fakePrincipal({
        principalId: "e2e-smoke",
        capabilities: ["task:submit", "task:read"],
        now: NOW,
      }),
    }),
    runtime,
    approvals: store.approvals,
    approvalRequirements: createManagerApprovalRequirementReader(simulation.loop),
    decisions: createInMemoryGatewayDecisionRepository(),
    events: createManagerLoopGatewayEvents(simulation.loop),
    rateLimiter: createFakeRateLimiter(),
    audit: createFakeGatewayAudit(),
    now,
  });
  const task = smokeTaskDefinition(options.smokeRunId);
  const auth = {
    credentials: { token: TOKEN },
    requestId: `request-${options.smokeRunId}`,
    source: "e2e-smoke-harness",
  };

  return {
    mode: "fake",
    simulation,
    networkCalls: [],
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
    settle: () => simulation.loop.settle(),
    snapshot: (id) => simulation.loop.task(id),
    async pollQa(id) {
      await simulation.send({ type: "qa_updated", taskId: id });
    },
    observe(id) {
      const snapshot = simulation.loop.task(id);
      const record = simulation.trustedRecords.at(-1);
      const qa = simulation.qaDecisions.at(-1);
      return {
        baseSha: MAIN_SHA,
        filesChanged: [...(record?.changedPaths ?? [])],
        validations: [...(record?.validations ?? [])].map((item) => ({ ...item })),
        lifecycleDecisions: structuredClone(lifecycleDecisions),
        ciChecks: structuredClone(qa?.checks ?? []),
        prState: snapshot?.prNumber ? "open" : null,
        workerInvocations: simulation.workerCalls.length,
        workerRuntimeAvailable: options.lifecycleAvailable !== false,
        fallbackWorker: null,
      };
    },
    now,
    wait: async () => {},
  };
}
