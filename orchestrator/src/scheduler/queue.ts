import { priorityRank } from "./priority";
import type { SchedulerTaskView } from "./types";

/**
 * Deterministic queue order:
 *   priority (critical first)
 *   -> dependency readiness (ready before waiting)
 *   -> creation sequence
 *   -> task id
 */
export function compareQueued(a: SchedulerTaskView, b: SchedulerTaskView, ready: (taskId: string) => boolean): number {
  const p = priorityRank(a.priority) - priorityRank(b.priority);
  if (p !== 0) return p;
  const r = Number(ready(b.taskId)) - Number(ready(a.taskId));
  if (r !== 0) return r;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

export function orderQueue(tasks: readonly SchedulerTaskView[], ready: (taskId: string) => boolean): SchedulerTaskView[] {
  return [...tasks].sort((a, b) => compareQueued(a, b, ready));
}
