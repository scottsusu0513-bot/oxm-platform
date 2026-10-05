import type {
  LifecycleLeaseRegistry,
  LifecycleOperation,
  LifecycleOperationLease,
} from "./types";

export function createLifecycleLeaseRegistry(
  maxConcurrent = 1
): LifecycleLeaseRegistry {
  let current: LifecycleOperationLease | null = null;
  return Object.freeze({
    acquire(operation: LifecycleOperation, key: string) {
      if (maxConcurrent !== 1)
        return {
          ok: false as const,
          reason: "only one lifecycle operation is supported",
        };
      if (current)
        return current.operation === operation && current.key === key
          ? { ok: true as const, lease: current }
          : {
              ok: false as const,
              reason: `lifecycle ${current.operation} already in progress`,
            };
      current = Object.freeze({ operation, key });
      return { ok: true as const, lease: current };
    },
    release(lease: LifecycleOperationLease) {
      if (current !== lease) return false;
      current = null;
      return true;
    },
    current: () => current,
  });
}
