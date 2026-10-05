import type { IsoTimestamp, NewAuditEvent } from "../store/types";

export const LIFECYCLE_STATES = [
  "unknown",
  "stopped",
  "starting",
  "available",
  "busy",
  "idle",
  "stopping",
  "failed",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_DECISIONS = [
  "start",
  "wait_ready",
  "keep_alive",
  "stop",
  "no_op",
  "blocked",
] as const;
export type LifecycleDecisionKind = (typeof LIFECYCLE_DECISIONS)[number];
export type LifecycleOperation = "start" | "stop";
export type TrustedCodespaceStatus =
  | "unknown"
  | "stopped"
  | "starting"
  | "available"
  | "stopping"
  | "failed";

export interface RepositoryBinding {
  owner: string;
  repository: string;
}
export interface CodespaceIdentity {
  /** Fixed configuration, never populated from task input. */
  codespaceName: string;
  repository: RepositoryBinding;
  expectedRepository: RepositoryBinding;
  sourceRepository: RepositoryBinding;
  expectedBranch: string;
  workspacePath?: string;
}

export interface LifecyclePolicy {
  autoStart: boolean;
  autoStop: boolean;
  idleGraceMinutes: number;
  startupTimeoutMinutes: number;
  maxStartAttempts: number;
  maxStopAttempts: number;
  keepAliveForRepair: boolean;
  maxConcurrentLifecycleOps: number;
}

export interface PendingLifecycleOperation {
  kind: LifecycleOperation;
  idempotencyKey: string;
  requestedAt: IsoTimestamp;
  attempt: number;
}

export interface PersistedLifecycleState {
  version: 1;
  codespaceName: string;
  state: LifecycleState;
  lastTrustedStatus: TrustedCodespaceStatus;
  pendingOperation: PendingLifecycleOperation | null;
  startAttempts: number;
  stopAttempts: number;
  idleSince: IsoTimestamp | null;
  lastActivityAt: IsoTimestamp | null;
  lastDecision: LifecycleDecisionKind | null;
  lastReasonCode: string | null;
  operationIdempotencyKey: string | null;
}

export interface LifecycleWorkload {
  runnableTaskIds: readonly string[];
  imminentTaskIds: readonly string[];
  repairPendingTaskIds: readonly string[];
  workerRunningTaskIds: readonly string[];
  activeWorkspaceLease: boolean;
  orchestrationActive: boolean;
  /** True only for an observation request; never creates useful work. */
  statusQueryOnly?: boolean;
}

export interface LifecycleDecision {
  action: LifecycleDecisionKind;
  state: LifecycleState;
  reasonCode: string;
  taskIds: string[];
  idleSince: IsoTimestamp | null;
  attempt: number;
}

export interface CodespaceObservation {
  status: TrustedCodespaceStatus;
  observedAt: IsoTimestamp;
  repository: RepositoryBinding;
  codespaceName: string;
}

export interface CodespaceClient {
  getStatus(): Promise<CodespaceObservation>;
  start(idempotencyKey: string): Promise<void>;
  stop(idempotencyKey: string): Promise<void>;
}

export interface LifecycleStateRepository {
  load(codespaceName: string): PersistedLifecycleState | null;
  save(state: PersistedLifecycleState): void;
}

export interface LifecycleOperationLease {
  operation: LifecycleOperation;
  key: string;
}

export interface LifecycleLeaseRegistry {
  acquire(
    operation: LifecycleOperation,
    key: string
  ):
    | { ok: true; lease: LifecycleOperationLease }
    | { ok: false; reason: string };
  release(lease: LifecycleOperationLease): boolean;
  current(): LifecycleOperationLease | null;
}

export interface LifecycleControllerPorts {
  client: CodespaceClient;
  persistence: LifecycleStateRepository;
  leases: LifecycleLeaseRegistry;
  audit: (event: Omit<NewAuditEvent, "id">) => void;
}

export interface LifecycleOutcome {
  ready: boolean;
  decision: LifecycleDecision;
  state: PersistedLifecycleState;
  unexpectedStop: boolean;
  workerInterrupted: boolean;
}

export interface LifecycleController {
  reconcile(
    work: LifecycleWorkload,
    now: IsoTimestamp
  ): Promise<LifecycleOutcome>;
  snapshot(): PersistedLifecycleState;
}
