import { validateTransition } from "../domain/taskState";
import type { RiskLevel, TaskState, WorkerKind } from "../domain/types";
import { sanitizeMetadata } from "../store/sanitize";
import type { IsoTimestamp, JsonValue, NewAuditEvent, NewTaskRun, RunExitStatus, TaskPatch, TaskRunPatch } from "../store/types";
import type { WorkerResult } from "./types";

/**
 * Pure mapping from worker lifecycle/results to store *intents*. Nothing is
 * written here: the caller applies transitions through
 * TaskRepository.transition() (which re-validates via domain/taskState) and
 * audit events through AuditRepository.append(). Every intended transition
 * is pre-checked with validateTransition so policy is never bypassed.
 */

export type Intent<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface WorkerStartIntent {
  taskRun: NewTaskRun;
  transition: "running";
  audit: Omit<NewAuditEvent, "id">;
}

export function workerStartIntent(input: { currentState: TaskState; riskLevel: RiskLevel; taskId: string; runId: string; worker: WorkerKind; model: string; promptHash: string | null; branch: string }): Intent<WorkerStartIntent> {
  if (!input.promptHash || !/^[0-9a-f]{64}$/.test(input.promptHash)) {
    return {
      ok: false,
      reason: "a valid promptHash is required to record a run",
    };
  }
  const check = validateTransition(input.currentState, "running", {
    riskLevel: input.riskLevel,
  });
  if (!check.ok) return { ok: false, reason: check.reason };
  return {
    ok: true,
    taskRun: {
      id: input.runId,
      taskId: input.taskId,
      worker: input.worker,
      model: input.model,
      promptHash: input.promptHash,
    },
    transition: "running",
    audit: {
      taskId: input.taskId,
      actor: "manager",
      event: "worker_started",
      fromState: input.currentState,
      toState: "running",
      metadata: {
        runId: input.runId,
        worker: input.worker,
        branch: input.branch,
        riskLevel: input.riskLevel,
      },
    },
  };
}

const RISK_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

export interface WorkerFinishIntent {
  taskRunPatch: TaskRunPatch;
  /**
   * Risk escalation to persist via TaskRepository.update() *before* applying
   * the transition. Only ever raises risk (null when observed risk is not
   * higher than the stored level); the repository also forbids downgrades.
   */
  taskRiskUpdate: (TaskPatch & { riskLevel: RiskLevel }) | null;
  /**
   * null = stay in the current state. A successful worker run never moves to
   * pr_opened here: the worker cannot open PRs, so that transition belongs to
   * a future verified GitHub write layer.
   */
  transition: TaskState | null;
  audit: Omit<NewAuditEvent, "id">;
}

export function workerFinishIntent(input: { currentState: TaskState; riskLevel: RiskLevel; taskId: string; runId: string; result: WorkerResult; endedAt: IsoTimestamp }): Intent<WorkerFinishIntent> {
  const { result } = input;
  // Fail closed: a worker-supplied PR number is never trusted.
  if ((result.prNumber as unknown) !== null) {
    return {
      ok: false,
      reason: "worker results cannot carry a PR number; PRs come only from the GitHub layer",
    };
  }
  const exitStatus: RunExitStatus = result.status;
  let to: TaskState | null;
  if (result.status === "cancelled") to = "cancelled";
  else if (result.status === "success") to = null;
  else to = "failed";

  const observed = result.riskObserved.level;
  const escalate = RISK_RANK[observed] > RISK_RANK[input.riskLevel];
  const effectiveRisk = escalate ? observed : input.riskLevel;

  if (to !== null) {
    const check = validateTransition(input.currentState, to, {
      riskLevel: effectiveRisk,
    });
    if (!check.ok) return { ok: false, reason: check.reason };
  }

  const metadata = sanitizeMetadata({
    runId: input.runId,
    status: result.status,
    errorType: result.errorType,
    workerErrorCode: result.workerErrorCode,
    branch: result.branch,
    headSha: result.headSha,
    filesChanged: result.filesChanged.slice(0, 100),
    filesChangedCount: result.filesChanged.length,
    testsRun: result.testsRun as unknown as JsonValue,
    checkResult: result.checkResult,
    riskObserved: result.riskObserved as unknown as JsonValue,
    needsApproval: result.needsApproval,
    riskEscalatedFrom: escalate ? input.riskLevel : null,
    fallbackRecommended: result.fallbackRecommended,
  });

  return {
    ok: true,
    taskRunPatch: {
      endedAt: input.endedAt,
      exitStatus,
      headSha: result.headSha,
      summary: result.summary,
    },
    taskRiskUpdate: escalate ? { riskLevel: observed } : null,
    transition: to,
    audit: {
      taskId: input.taskId,
      actor: "worker",
      event: `worker_${result.status}`,
      fromState: input.currentState,
      toState: to,
      metadata,
    },
  };
}
