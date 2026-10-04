import { describe, expect, it } from "vitest";
import { createWorkspaceLeaseRegistry, evaluateLease } from "./lease";

const A = { workspaceId: "ws-1", taskId: "ta", lineageId: "ta", branch: "agent/task-ta-a" };
const B = { workspaceId: "ws-1", taskId: "tb", lineageId: "tb", branch: "agent/task-tb-b" };

describe("workspace leases", () => {
  it("a lease for task A blocks task B from switching the same workspace", () => {
    const reg = createWorkspaceLeaseRegistry();
    const a = reg.acquire(A);
    expect(a).toMatchObject({ ok: true, lease: { taskId: "ta", leaseId: "ws-1#1" } });
    expect(reg.acquire(B)).toMatchObject({ ok: false, error: "lease_conflict", reason: expect.stringMatching(/leased to task ta/) });
    expect(reg.current("ws-1")?.taskId).toBe("ta");
  });

  it("a different workspace is independent", () => {
    const reg = createWorkspaceLeaseRegistry();
    reg.acquire(A);
    expect(reg.acquire({ ...B, workspaceId: "ws-2" }).ok).toBe(true);
  });

  it("same task re-acquire is idempotent; same task on another branch is denied", () => {
    const reg = createWorkspaceLeaseRegistry();
    const a = reg.acquire(A);
    const again = reg.acquire(A);
    expect(again.ok && a.ok && again.lease === a.lease).toBe(true);
    expect(reg.acquire({ ...A, branch: "agent/task-ta-other" }).ok).toBe(false);
  });

  it("same lineage continues only with explicit handoff; old lease is invalidated", () => {
    const reg = createWorkspaceLeaseRegistry();
    const a = reg.acquire(A);
    const next = { ...A, taskId: "tc" };
    expect(reg.acquire(next)).toMatchObject({ ok: false, reason: expect.stringMatching(/handoff not explicitly allowed/) });
    const c = reg.acquire({ ...next, allowLineageHandoff: true });
    expect(c).toMatchObject({ ok: true, lease: { taskId: "tc", lineageId: "ta", leaseId: "ws-1#2" } });
    expect(a.ok && reg.holds(a.lease)).toBe(false);
    // handoff never crosses lineages or branches
    expect(reg.acquire({ ...B, allowLineageHandoff: true }).ok).toBe(false);
  });

  it("release requires the exact current lease (ownership mismatch fails closed)", () => {
    const reg = createWorkspaceLeaseRegistry();
    const a = reg.acquire(A);
    if (!a.ok) throw new Error();
    expect(reg.release({ ...a.lease })).toMatchObject({ ok: false, error: "lease_mismatch" });
    expect(reg.holds({ ...a.lease })).toBe(false);
    expect(reg.release(a.lease)).toEqual({ ok: true });
    expect(reg.release(a.lease)).toMatchObject({ ok: false });
    expect(reg.acquire(B).ok).toBe(true);
  });

  it("denies protected/invalid branches and ids", () => {
    for (const bad of [{ ...A, branch: "main" }, { ...A, branch: "master" }, { ...A, workspaceId: "../x" }, { ...A, taskId: "T A" }]) {
      expect(evaluateLease(null, bad).action).toBe("deny");
    }
  });
});
