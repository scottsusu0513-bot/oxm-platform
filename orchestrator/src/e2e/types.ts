import type { LifecycleDecision } from "../codespace/types";
import type { RiskLevel, WorkerKind } from "../domain/types";
import type { RequiredCheckResult } from "../github/types";
import type { ManagerDecision, ValidationEvidence } from "../manager/types";
import type { PriorityClass, TaskSnapshot } from "../scheduler/types";

export const SMOKE_FIXTURE_PATH =
  "orchestrator/smoke-fixtures/agent-e2e-smoke.txt" as const;
export const SMOKE_VALIDATION_COMMAND =
  "pnpm vitest run orchestrator/src/e2e/fixture.test.ts" as const;
export const LIVE_CONFIRMATION =
  "create-one-smoke-branch-and-pr-without-merge" as const;

/** The fixture is exactly one marker line with a final newline. */
export function smokeFixtureContent(smokeRunId: string): string {
  return `OXM_AGENT_E2E_SMOKE=${smokeRunId}\n`;
}

export function isSmokeFixtureContent(value: string): boolean {
  const line = value.endsWith("\r\n") ? value.slice(0, -2) : value.endsWith("\n") ? value.slice(0, -1) : null;
  return line !== null && /^OXM_AGENT_E2E_SMOKE=[a-z0-9][a-z0-9-]*$/.test(line);
}

export type SmokeMode = "fake" | "live";
export type SmokeFinalStatus =
  | "waiting_for_ci"
  | "qa_passed"
  | "qa_failed"
  | "accepted"
  | "needs_repair"
  | "needs_human_approval"
  | "blocked";

export interface SmokeTaskDefinition {
  idempotencyKey: string;
  title: "chore: agent e2e smoke";
  instruction: string;
  expectedScope: readonly [typeof SMOKE_FIXTURE_PATH];
  acceptanceCriteria: readonly string[];
  requiredValidations: readonly ["smoke"];
  requestedPriority: "normal";
}

export interface SmokeObservation {
  baseSha: string | null;
  filesChanged: string[];
  validations: ValidationEvidence[];
  lifecycleDecisions: LifecycleDecision[];
  ciChecks: RequiredCheckResult[];
  prState: "open" | "closed" | "merged" | null;
  workerInvocations: number;
  workerRuntimeAvailable: boolean;
  fallbackWorker: WorkerKind | null;
}

export interface SmokeReport {
  smokeRunId: string;
  mode: SmokeMode;
  taskId: string | null;
  intakeResult: "accepted" | "duplicate" | "not_started" | "failed";
  risk: RiskLevel | null;
  priority: PriorityClass | null;
  worker: WorkerKind | null;
  fallbackWorker: WorkerKind | null;
  workerRuntimeAvailable: boolean;
  workerInvocationCount: number;
  branch: string | null;
  baseSha: string | null;
  headSha: string | null;
  filesChanged: string[];
  validations: ValidationEvidence[];
  codespaceLifecycleDecisions: LifecycleDecision[];
  prNumber: number | null;
  prState: "open" | "closed" | "merged" | null;
  ciChecks: RequiredCheckResult[];
  managerDecision: ManagerDecision | null;
  repairCount: number;
  timestamps: {
    startedAt: string;
    finishedAt: string;
  };
  finalStatus: SmokeFinalStatus;
  failureCode: string | null;
  failureReason: string | null;
}

export interface SmokeHarnessEnvironment {
  mode: SmokeMode;
  submit(): Promise<{
    taskId: string;
    duplicate: boolean;
  }>;
  settle(): Promise<void>;
  snapshot(taskId: string): TaskSnapshot | null;
  pollQa(taskId: string): Promise<void>;
  observe(taskId: string): SmokeObservation;
  now(): string;
  wait(ms: number): Promise<void>;
}

export interface SmokeHarnessOptions {
  smokeRunId: string;
  maxQaPolls: number;
  /** Live waits honor Manager Loop backoff. Tests inject a no-op wait. */
  waitForQa: boolean;
}

export interface LiveSmokeConfig {
  live: true;
  confirmation: string;
  repoRoot: string;
  expectedRepository: { owner: string; repo: string };
  codespaceName: string;
  expectedCodespaceName: string;
  workspacePath: string;
  codexCommand?: string;
  codexModel?: string;
  workerTimeoutMs: number;
  maxQaPolls: number;
  mergeEnabled: false;
  deployEnabled: false;
  forcePushEnabled: false;
  productionDbEnabled: false;
  ci: boolean;
}

export interface SafetyCheck {
  name: string;
  ok: boolean;
  reason: string;
}

export type LiveSafetyResult =
  | { ok: true; checks: SafetyCheck[]; branch: string }
  | { ok: false; checks: SafetyCheck[]; failureCode: string };
