/**
 * In-memory kill switch. Cancellation can be requested from anywhere that
 * holds the switch (an operator command, a handle, a supervisor); listeners
 * registered by the adapter stop the running process. No timers, no I/O.
 */
export interface KillSwitch {
  /** Requests cancellation; the first reason wins, later calls are no-ops. */
  trigger(reason?: string): void;
  readonly triggered: boolean;
  readonly reason: string | null;
  /** Runs `listener` on trigger (immediately if already triggered). Returns an unsubscribe. */
  onTrigger(listener: (reason: string) => void): () => void;
}

export function createKillSwitch(): KillSwitch {
  let reason: string | null = null;
  const listeners = new Set<(reason: string) => void>();
  return {
    get triggered() {
      return reason !== null;
    },
    get reason() {
      return reason;
    },
    trigger(r = "cancel requested") {
      if (reason !== null) return;
      reason = r;
      for (const l of Array.from(listeners)) {
        try {
          l(r);
        } catch {
          // a failing listener must not prevent the others from stopping work
        }
      }
      listeners.clear();
    },
    onTrigger(listener) {
      if (reason !== null) {
        listener(reason);
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
