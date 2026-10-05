import { lifecycleAudit, type LifecycleAuditEvent } from "./audit";
import { validateCodespaceIdentity } from "./client";
import {
  DEFAULT_LIFECYCLE_POLICY,
  decideLifecycle,
  hasUsefulWork,
} from "./policy";
import { initialLifecycleState } from "./state";
import type {
  CodespaceIdentity,
  CodespaceObservation,
  LifecycleController,
  LifecycleControllerPorts,
  LifecycleOutcome,
  LifecyclePolicy,
  LifecycleWorkload,
} from "./types";

function operationKey(
  name: string,
  kind: "start" | "stop",
  attempt: number
): string {
  return `${name}:${kind}:${attempt}`;
}

export function createCodespaceLifecycleController(input: {
  identity: CodespaceIdentity;
  ports: LifecycleControllerPorts;
  policy?: Partial<LifecyclePolicy>;
}): LifecycleController {
  const checked = validateCodespaceIdentity(input.identity);
  if (!checked.ok) throw new Error(`[codespace] ${checked.reason}`);
  const policy: LifecyclePolicy = Object.freeze({
    ...DEFAULT_LIFECYCLE_POLICY,
    ...input.policy,
  });
  if (
    policy.maxConcurrentLifecycleOps !== 1 ||
    policy.idleGraceMinutes < 0 ||
    policy.startupTimeoutMinutes <= 0 ||
    policy.maxStartAttempts < 1 ||
    policy.maxStopAttempts < 1
  )
    throw new Error("[codespace] invalid lifecycle policy");
  let state =
    input.ports.persistence.load(input.identity.codespaceName) ??
    initialLifecycleState(input.identity.codespaceName);
  if (state.codespaceName !== input.identity.codespaceName)
    throw new Error("[codespace] persisted identity mismatch");
  let serial = Promise.resolve();

  const save = () => input.ports.persistence.save(state);
  const emit = (
    event: LifecycleAuditEvent,
    decision: LifecycleOutcome["decision"]
  ) =>
    input.ports.audit(lifecycleAudit(event, input.identity, state, decision));

  async function run(
    work: LifecycleWorkload,
    now: string
  ): Promise<LifecycleOutcome> {
    let observation: CodespaceObservation;
    try {
      observation = await input.ports.client.getStatus();
    } catch {
      const decision = {
        action: "blocked" as const,
        state: "failed" as const,
        reasonCode: "trusted_status_unavailable",
        taskIds: Array.from(
          new Set([...work.runnableTaskIds, ...work.workerRunningTaskIds])
        ).sort(),
        idleSince: state.idleSince,
        attempt: state.startAttempts,
      };
      state.state = "failed";
      state.lastDecision = "blocked";
      state.lastReasonCode = decision.reasonCode;
      emit("lifecycle_blocked", decision);
      save();
      return {
        ready: false,
        decision,
        state: structuredClone(state),
        unexpectedStop: false,
        workerInterrupted: false,
      };
    }
    if (
      observation.codespaceName !== input.identity.codespaceName ||
      observation.repository.owner.toLowerCase() !==
        input.identity.expectedRepository.owner.toLowerCase() ||
      observation.repository.repository.toLowerCase() !==
        input.identity.expectedRepository.repository.toLowerCase()
    )
      throw new Error("[codespace] trusted observation target mismatch");

    const previous = state.state;
    const unexpectedStop =
      observation.status === "stopped" &&
      ["available", "busy", "idle"].includes(previous);
    const workerInterrupted =
      unexpectedStop && work.workerRunningTaskIds.length > 0;

    if (
      state.pendingOperation?.kind === "start" &&
      observation.status === "available"
    ) {
      const completed = decideLifecycle({
        state,
        observed: observation.status,
        work,
        policy,
        now,
      });
      emit("codespace_start_succeeded", completed);
      state.pendingOperation = null;
      state.startAttempts = 0;
      const held = input.ports.leases.current();
      if (held?.operation === "start") input.ports.leases.release(held);
      emit("codespace_ready", completed);
    } else if (
      state.pendingOperation?.kind === "stop" &&
      observation.status === "stopped"
    ) {
      const completed = decideLifecycle({
        state,
        observed: observation.status,
        work,
        policy,
        now,
      });
      emit("codespace_stop_succeeded", completed);
      state.pendingOperation = null;
      state.stopAttempts = 0;
      const held = input.ports.leases.current();
      if (held?.operation === "stop") input.ports.leases.release(held);
    } else if (
      state.pendingOperation?.kind === "start" &&
      ["stopped", "failed"].includes(observation.status)
    ) {
      state.pendingOperation = null;
      const held = input.ports.leases.current();
      if (held?.operation === "start") input.ports.leases.release(held);
    } else if (
      state.pendingOperation?.kind === "stop" &&
      observation.status === "available"
    ) {
      state.pendingOperation = null;
      const held = input.ports.leases.current();
      if (held?.operation === "stop") input.ports.leases.release(held);
    }

    state.lastTrustedStatus = observation.status;
    let decision = decideLifecycle({
      state,
      observed: observation.status,
      work,
      policy,
      now,
    });
    if (unexpectedStop) emit("codespace_unexpected_stop", decision);
    if (
      observation.status === "available" &&
      !["available", "busy", "idle"].includes(previous) &&
      state.pendingOperation === null
    )
      emit("codespace_ready", decision);

    if (decision.state === "idle" && state.idleSince === null)
      state.idleSince = now;
    if (hasUsefulWork(work, policy)) {
      state.idleSince = null;
      state.lastActivityAt = now;
    }
    state.state = decision.state;
    state.lastDecision = decision.action;
    state.lastReasonCode = decision.reasonCode;

    if (decision.reasonCode === "idle_grace_started")
      emit("codespace_idle", decision);
    if (decision.action === "keep_alive")
      emit("codespace_keep_alive", decision);
    if (decision.action === "blocked") emit("lifecycle_blocked", decision);
    if (decision.reasonCode === "startup_timeout_retry_pending") {
      state.pendingOperation = null;
      const held = input.ports.leases.current();
      if (held?.operation === "start") input.ports.leases.release(held);
      emit("lifecycle_retry_scheduled", decision);
    }

    if (decision.action === "start" || decision.action === "stop") {
      const kind = decision.action;
      const key = operationKey(
        input.identity.codespaceName,
        kind,
        decision.attempt
      );
      const acquired = input.ports.leases.acquire(kind, key);
      if (!acquired.ok) {
        decision = {
          ...decision,
          action: "wait_ready",
          reasonCode: "lifecycle_operation_in_progress",
        };
        state.lastDecision = decision.action;
        state.lastReasonCode = decision.reasonCode;
      } else {
        state.pendingOperation = {
          kind,
          idempotencyKey: key,
          requestedAt: now,
          attempt: decision.attempt,
        };
        state.operationIdempotencyKey = key;
        if (kind === "start") state.startAttempts = decision.attempt;
        else state.stopAttempts = decision.attempt;
        save(); // intent precedes the API mutation
        emit(
          kind === "start"
            ? "codespace_start_requested"
            : "codespace_stop_requested",
          decision
        );
        try {
          await input.ports.client[kind](key);
        } catch {
          state.pendingOperation = null;
          state.state = "failed";
          state.lastTrustedStatus = observation.status;
          state.lastReasonCode = `${kind}_api_failure`;
          input.ports.leases.release(acquired.lease);
          const failed = {
            ...decision,
            action:
              decision.attempt >=
              (kind === "start"
                ? policy.maxStartAttempts
                : policy.maxStopAttempts)
                ? ("blocked" as const)
                : ("wait_ready" as const),
            state: "failed" as const,
            reasonCode: state.lastReasonCode,
          };
          state.lastDecision = failed.action;
          emit(
            kind === "start"
              ? "codespace_start_failed"
              : "codespace_stop_failed",
            failed
          );
          if (failed.action === "blocked") emit("lifecycle_blocked", failed);
          else emit("lifecycle_retry_scheduled", failed);
          decision = failed;
        }
      }
    }
    save();
    return {
      ready: observation.status === "available" && !workerInterrupted,
      decision,
      state: structuredClone(state),
      unexpectedStop,
      workerInterrupted,
    };
  }

  return {
    reconcile(work, now) {
      const next = serial.then(() => run(structuredClone(work), now));
      serial = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    snapshot: () => structuredClone(state),
  };
}
