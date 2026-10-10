import type { PathContentIdentity } from "./gitIntegrity";
import { isPathInScope } from "./prompt";

/**
 * Task-owned delta attribution (pure).
 *
 * The workspace may be shared: other actors can have uncommitted changes
 * before a Worker starts, or change files while it runs. A Worker is only
 * responsible for what it changed during ITS execution, measured against the
 * trusted baseline (content identity of every dirty path) captured right
 * before the run.
 *
 *   in allowedScope, changed during the run (or the task's own earlier
 *     edits, allowedDirtyPaths)                     -> taskOwned
 *   dirty before the run and unchanged by it          -> preExisting
 *   out of scope, changed during the run, and the Worker itself
 *     reports it                                    -> workerOutOfScope (genuine scope violation)
 *   out of scope, changed during the run, not reported by the
 *     Worker                                        -> unattributed (shared-workspace uncertainty)
 *
 * unattributed is never called a Worker violation and never repaired; it is
 * excluded from the task delta, never committed, and reported to the owner.
 */
export interface WorkspaceDeltaAttribution {
  taskOwned: string[];
  workerOutOfScope: string[];
  preExisting: string[];
  unattributed: string[];
}

export function attributeWorkspaceDelta(input: {
  /** Identity of every path that was dirty when the execution started. */
  baseline: readonly PathContentIdentity[];
  /** Identity now of every path that is dirty now or was dirty at the start. */
  current: readonly PathContentIdentity[];
  /** Paths that differ from the start HEAD now (committed + uncommitted). */
  changedNow: readonly string[];
  allowedScope: readonly string[];
  /** The task lineage's own earlier edits (already validated in scope). */
  allowedDirtyPaths: readonly string[];
  /** Paths the Worker itself reports having changed (untrusted, used only to attribute responsibility). */
  reported: readonly string[];
}): WorkspaceDeltaAttribution {
  const before = new Map(input.baseline.map((i) => [i.path, i]));
  const now = new Map(input.current.map((i) => [i.path, i]));
  const changed = new Set(input.changedNow);
  const ownDirty = new Set(input.allowedDirtyPaths);
  const reported = new Set(input.reported);
  const out: WorkspaceDeltaAttribution = { taskOwned: [], workerOutOfScope: [], preExisting: [], unattributed: [] };
  const all = Array.from(new Set([...input.changedNow, ...input.baseline.map((b) => b.path)])).sort();
  for (const path of all) {
    const b = before.get(path);
    const n = now.get(path);
    // Unknown current identity of a baseline path counts as changed (never silently "unchanged").
    const changedDuringRun = b ? !n || n.mode !== b.mode || n.blob !== b.blob : changed.has(path);
    if (isPathInScope(path, input.allowedScope)) {
      if (!changed.has(path)) continue; // reverted to HEAD: nothing to own or publish
      if (changedDuringRun || ownDirty.has(path)) out.taskOwned.push(path);
      else out.preExisting.push(path);
      continue;
    }
    if (!changedDuringRun) {
      if (changed.has(path)) out.preExisting.push(path);
      continue;
    }
    (reported.has(path) ? out.workerOutOfScope : out.unattributed).push(path);
  }
  return out;
}
