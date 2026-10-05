import type { TaskIntake, TaskSnapshot } from "../scheduler/types";
import type {
  IntakeRecordRepository,
  PersistedIntakeRecord,
  RuntimeSchedulerPort,
} from "./types";

export function createInMemoryIntakeRepository(
  initial: readonly PersistedIntakeRecord[] = []
): IntakeRecordRepository {
  const byTask = new Map(initial.map(r => [r.taskId, structuredClone(r)]));
  const byKey = new Map(initial.map(r => [r.idempotencyKey, r.taskId]));
  const clone = (r: PersistedIntakeRecord) => structuredClone(r);
  return {
    getByKey(key) {
      const id = byKey.get(key);
      return id ? clone(byTask.get(id)!) : null;
    },
    getByTask(id) {
      const r = byTask.get(id);
      return r ? clone(r) : null;
    },
    create(record) {
      if (byKey.has(record.idempotencyKey))
        throw new Error("[intake] idempotency key already exists");
      if (byTask.has(record.taskId))
        throw new Error("[intake] task already exists");
      byKey.set(record.idempotencyKey, record.taskId);
      byTask.set(record.taskId, clone(record));
      return clone(record);
    },
    update(taskId, patch) {
      const current = byTask.get(taskId);
      if (!current) throw new Error(`[intake] task ${taskId} not found`);
      const next = { ...current, ...structuredClone(patch) };
      byTask.set(taskId, next);
      return clone(next);
    },
  };
}

export interface FakeRuntimeScheduler extends RuntimeSchedulerPort {
  enqueued: TaskIntake[];
  pauseCalls: string[];
  cancelCalls: string[];
  setSnapshot(taskId: string, snapshot: TaskSnapshot): void;
  setRunning(taskId: string, running: boolean): void;
}

export function createFakeRuntimeScheduler(): FakeRuntimeScheduler {
  const enqueued: TaskIntake[] = [];
  const snapshots = new Map<string, TaskSnapshot>();
  const running = new Set<string>();
  const pauseCalls: string[] = [];
  const cancelCalls: string[] = [];
  return {
    enqueued,
    pauseCalls,
    cancelCalls,
    enqueue(task) {
      enqueued.push(structuredClone(task));
    },
    snapshot(id) {
      const s = snapshots.get(id);
      return s ? structuredClone(s) : null;
    },
    pause(id) {
      pauseCalls.push(id);
      return running.has(id)
        ? { ok: false, reason: "task is already running" }
        : { ok: true };
    },
    cancel(id) {
      cancelCalls.push(id);
      return { ok: true, cancellationRequested: running.has(id) };
    },
    setSnapshot(id, snapshot) {
      snapshots.set(id, structuredClone(snapshot));
    },
    setRunning(id, value) {
      if (value) running.add(id);
      else running.delete(id);
    },
  };
}
