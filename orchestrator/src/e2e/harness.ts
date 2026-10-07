import { createHash } from "node:crypto";
import type { ManagerDecision } from "../manager/types";
import type { TaskSnapshot } from "../scheduler/types";
import type {
  SmokeFinalStatus,
  SmokeHarnessEnvironment,
  SmokeHarnessOptions,
  SmokeReport,
  SmokeTaskDefinition,
} from "./types";
import {
  smokeFixtureContent,
  SMOKE_FIXTURE_PATH,
  SMOKE_VALIDATION_COMMAND,
} from "./types";

/**
 * Bind remote task/branch ownership to one smoke run without putting an
 * unbounded operator-provided value into a ref name. The readable prefix is
 * diagnostic only; the digest keeps long or prefix-identical run ids distinct.
 */
export function smokeTaskId(smokeRunId: string): string {
  const prefix =
    smokeRunId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "run";
  const digest = createHash("sha256").update(smokeRunId).digest("hex").slice(0, 12);
  return `e2e-smoke-${prefix}-${digest}`;
}

export function smokeTaskDefinition(smokeRunId: string): SmokeTaskDefinition {
  const task: SmokeTaskDefinition = {
    idempotencyKey: `agent-e2e-smoke-${smokeRunId}`,
    title: "chore: agent e2e smoke",
    instruction: [
      "Perform a UI polish test-fixture-only smoke task.",
      `Modify only ${SMOKE_FIXTURE_PATH}.`,
      `Set its complete UTF-8 content to exactly ${JSON.stringify(smokeFixtureContent(smokeRunId))}; the final \\n is one LF byte (0x0a), not optional.`,
      `Run exactly: ${SMOKE_VALIDATION_COMMAND}`,
      "Leave the validated fixture change uncommitted; trusted orchestration owns commit creation.",
      "This is test-only and must not change production behavior, access a database, deploy, push, merge, or alter authentication or secrets.",
    ].join(" "),
    expectedScope: Object.freeze([SMOKE_FIXTURE_PATH]),
    acceptanceCriteria: Object.freeze([
      "Test-only: the dedicated smoke fixture contains the deterministic run marker",
      "No production behavior change: the targeted smoke fixture validation passes",
      "Do not merge automatically: the pull request remains open for manual cleanup",
    ]),
    requiredValidations: Object.freeze(["smoke"]),
    requestedPriority: "normal",
  };
  return Object.freeze(task);
}

function managerDecision(snapshot: TaskSnapshot | null): ManagerDecision | null {
  if (!snapshot) return null;
  if (snapshot.status === "accepted") return "accepted";
  if (snapshot.status === "needs_human_approval")
    return "needs_human_approval";
  if (snapshot.status === "repair_requested") return "needs_repair";
  if (snapshot.status === "blocked") return "blocked";
  return null;
}

function finalStatus(
  snapshot: TaskSnapshot | null,
  ciStatus: string | null,
): SmokeFinalStatus {
  if (!snapshot) return "blocked";
  if (snapshot.status === "accepted") return "accepted";
  if (snapshot.status === "needs_human_approval")
    return "needs_human_approval";
  if (snapshot.status === "repair_requested") return "needs_repair";
  if (snapshot.status === "qa_pending") return "waiting_for_ci";
  if (snapshot.status === "blocked" && ciStatus === "failed")
    return "qa_failed";
  if (snapshot.qaStatus === "passed") return "qa_passed";
  return "blocked";
}

export async function runSmokeHarness(
  env: SmokeHarnessEnvironment,
  options: SmokeHarnessOptions,
): Promise<SmokeReport> {
  const startedAt = env.now();
  let taskId: string | null = null;
  let intakeResult: SmokeReport["intakeResult"] = "not_started";
  let failureCode: string | null = null;
  let failureReason: string | null = null;

  try {
    const submitted = await env.submit();
    taskId = submitted.taskId;
    intakeResult = submitted.duplicate ? "duplicate" : "accepted";
    await env.settle();

    for (let attempt = 0; attempt < options.maxQaPolls; attempt++) {
      const current = env.snapshot(taskId);
      if (current?.status !== "qa_pending") break;
      if (options.waitForQa) {
        await env.wait(current.nextQaPollDelayMs ?? 0);
      }
      await env.pollQa(taskId);
      await env.settle();
    }
  } catch (error) {
    intakeResult = taskId ? intakeResult : "failed";
    failureCode = "smoke_execution_failed";
    failureReason =
      error instanceof Error ? `${error.name}: smoke execution failed` : "smoke execution failed";
  }

  const snapshot = taskId ? env.snapshot(taskId) : null;
  const observed = taskId
    ? env.observe(taskId)
    : {
        baseSha: null,
        filesChanged: [],
        validations: [],
        lifecycleDecisions: [],
        ciChecks: [],
        prState: null,
        workerInvocations: 0,
        workerRuntimeAvailable: false,
        fallbackWorker: null,
      };
  const ciStatus = snapshot?.qaStatus ?? null;
  const status = failureCode
    ? "blocked"
    : finalStatus(snapshot, ciStatus);
  if (!failureCode && status === "blocked") {
    failureCode = snapshot?.workerErrorType ?? "orchestration_blocked";
    failureReason = snapshot?.blockingReason ?? snapshot?.queueReason ?? "smoke did not reach acceptance";
  }

  return {
    smokeRunId: options.smokeRunId,
    mode: env.mode,
    taskId,
    intakeResult,
    risk: snapshot?.risk ?? null,
    priority: snapshot?.priority.priority ?? null,
    worker: snapshot?.worker ?? null,
    fallbackWorker: observed.fallbackWorker,
    workerRuntimeAvailable: observed.workerRuntimeAvailable,
    workerInvocationCount: observed.workerInvocations,
    branch: snapshot?.branch ?? null,
    baseSha: observed.baseSha,
    headSha: snapshot?.headSha ?? null,
    filesChanged: observed.filesChanged,
    validations: observed.validations,
    codespaceLifecycleDecisions: observed.lifecycleDecisions,
    prNumber: snapshot?.prNumber ?? null,
    prState: observed.prState,
    ciChecks: observed.ciChecks,
    managerDecision: managerDecision(snapshot),
    repairCount: snapshot?.repair.attempt ?? 0,
    timestamps: { startedAt, finishedAt: env.now() },
    finalStatus: status,
    failureCode,
    failureReason,
  };
}

export function blockedSmokeReport(input: {
  smokeRunId: string;
  mode: "live";
  at: string;
  failureCode: string;
  reason: string;
}): SmokeReport {
  return {
    smokeRunId: input.smokeRunId,
    mode: input.mode,
    taskId: null,
    intakeResult: "not_started",
    risk: null,
    priority: null,
    worker: null,
    fallbackWorker: null,
    workerRuntimeAvailable: false,
    workerInvocationCount: 0,
    branch: null,
    baseSha: null,
    headSha: null,
    filesChanged: [],
    validations: [],
    codespaceLifecycleDecisions: [],
    prNumber: null,
    prState: null,
    ciChecks: [],
    managerDecision: null,
    repairCount: 0,
    timestamps: { startedAt: input.at, finishedAt: input.at },
    finalStatus: "blocked",
    failureCode: input.failureCode,
    failureReason: input.reason,
  };
}
