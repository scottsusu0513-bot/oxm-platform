import { checkTaskBranchName, isValidBranchTaskId } from "../branches/naming";

/**
 * Workspace leases: one local working tree is driven by at most one task at
 * a time, so two active tasks can never switch the same workspace onto
 * different branches. In-memory and deterministic (sequence-numbered ids);
 * a future Manager can back the same contract with a persistent lock.
 *
 * Lease objects are frozen and registered; only the holder of the exact
 * object the registry issued can use or release it.
 */

export interface WorkspaceLease {
  readonly leaseId: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly lineageId: string;
  readonly branch: string;
}

export interface LeaseRequest {
  workspaceId: string;
  taskId: string;
  lineageId: string;
  branch: string;
  /** Lets a later task of the same lineage take over a lease on the same branch. Must be explicit. */
  allowLineageHandoff?: boolean;
}

export type LeaseDecision =
  | { action: "grant" }
  | { action: "keep" }
  | { action: "handoff" }
  | { action: "deny"; reason: string };

const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Pure lease policy: what to do with `req` given the workspace's current lease. */
export function evaluateLease(current: WorkspaceLease | null, req: LeaseRequest): LeaseDecision {
  if (!WORKSPACE_ID_RE.test(String(req?.workspaceId))) return { action: "deny", reason: "invalid workspace id" };
  if (!isValidBranchTaskId(req.taskId) || !isValidBranchTaskId(req.lineageId)) return { action: "deny", reason: "invalid task/lineage id" };
  const name = checkTaskBranchName(req.branch);
  if (!name.ok) return { action: "deny", reason: name.reason };
  if (!current) return { action: "grant" };
  if (current.taskId === req.taskId) {
    if (current.branch === req.branch && current.lineageId === req.lineageId) return { action: "keep" };
    return { action: "deny", reason: "task already holds this workspace for a different branch/lineage" };
  }
  if (current.lineageId === req.lineageId && current.branch === req.branch) {
    if (req.allowLineageHandoff === true) return { action: "handoff" };
    return { action: "deny", reason: `workspace leased to task ${current.taskId} of the same lineage; handoff not explicitly allowed` };
  }
  return { action: "deny", reason: `workspace leased to task ${current.taskId} on ${current.branch}` };
}

export type LeaseResult = { ok: true; lease: WorkspaceLease } | { ok: false; error: "lease_conflict"; reason: string };

export interface WorkspaceLeaseRegistry {
  acquire(req: LeaseRequest): LeaseResult;
  /** Releases only when `lease` is the exact current lease object. */
  release(lease: unknown): { ok: true } | { ok: false; error: "lease_mismatch"; reason: string };
  /** True only for the exact lease object currently held for its workspace. */
  holds(lease: unknown): lease is WorkspaceLease;
  current(workspaceId: string): WorkspaceLease | null;
}

export function createWorkspaceLeaseRegistry(): WorkspaceLeaseRegistry {
  const leases = new Map<string, WorkspaceLease>();
  let seq = 0;
  const holds = (lease: unknown): lease is WorkspaceLease =>
    typeof lease === "object" && lease !== null && leases.get((lease as WorkspaceLease).workspaceId) === lease;

  return Object.freeze({
    acquire(req: LeaseRequest): LeaseResult {
      const current = leases.get(String(req?.workspaceId)) ?? null;
      const decision = evaluateLease(current, req);
      if (decision.action === "deny") return { ok: false, error: "lease_conflict", reason: decision.reason };
      if (decision.action === "keep" && current) return { ok: true, lease: current };
      const lease: WorkspaceLease = Object.freeze({
        leaseId: `${req.workspaceId}#${++seq}`,
        workspaceId: req.workspaceId,
        taskId: req.taskId,
        lineageId: req.lineageId,
        branch: req.branch,
      });
      leases.set(req.workspaceId, lease);
      return { ok: true, lease };
    },
    release(lease: unknown) {
      if (!holds(lease)) return { ok: false as const, error: "lease_mismatch" as const, reason: "lease is not the current lease for its workspace" };
      leases.delete(lease.workspaceId);
      return { ok: true as const };
    },
    holds,
    current: (workspaceId: string) => leases.get(workspaceId) ?? null,
  });
}
