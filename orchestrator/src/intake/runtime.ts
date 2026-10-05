import type { ManagerLoop } from "../scheduler/loop";
import type { RuntimeSchedulerPort } from "./types";

/**
 * Narrow bridge to the existing event-driven Manager Loop. Control callbacks
 * belong to the process supervisor that owns worker handles/kill switches;
 * intake itself never receives a WorkerAdapter or process capability.
 */
export function createManagerLoopRuntimePort(
  loop: Pick<ManagerLoop, "post" | "task" | "pause" | "cancel">
): RuntimeSchedulerPort {
  return {
    enqueue(task) {
      loop.post({ type: "task_created", task });
    },
    snapshot(taskId) {
      return loop.task(taskId);
    },
    pause(taskId) {
      return loop.pause(taskId);
    },
    cancel(taskId) {
      return loop.cancel(taskId);
    },
  };
}
