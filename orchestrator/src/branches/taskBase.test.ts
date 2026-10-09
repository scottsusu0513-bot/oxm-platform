import { describe, expect, it } from "vitest";
import { decideRuntimeRestore, establishRuntimeBaseline, isRuntimeBranch, resolveTaskBaseSha, type RuntimeBaseline } from "./taskBase";

const sha = (n: number) => n.toString(16).padStart(40, "0");
const MAIN = sha(0xe556);
const RUNTIME = sha(0x40bf);
const BASELINE: RuntimeBaseline = { branch: "agent/gpt-manager-live-e2e", sha: RUNTIME };
const TASK = "agent/task-t261009-882d30-oxm";

describe("runtime branch identity", () => {
  it("never treats main/master, a task branch, or detached HEAD as the runtime branch", () => {
    expect(isRuntimeBranch("agent/gpt-manager-live-e2e")).toBe(true);
    expect(isRuntimeBranch("feature/runtime-v2")).toBe(true);
    for (const b of ["main", "master", "MAIN", "refs/heads/main", "HEAD", TASK, "", "-x", "a..b", "a//b", "x.lock", "a@{1}", "a/"]) expect(isRuntimeBranch(b), b).toBe(false);
  });
});

describe("task base resolution", () => {
  it("runtime baseline newer than main: the task branch starts from the baseline, never the older main", () => {
    expect(resolveTaskBaseSha({ mainSha: MAIN, baseline: BASELINE, relation: "ahead" })).toBe(RUNTIME);
  });

  it("main already contains the runtime (post-merge production): main is the base", () => {
    expect(resolveTaskBaseSha({ mainSha: MAIN, baseline: BASELINE, relation: "behind" })).toBe(MAIN);
    expect(resolveTaskBaseSha({ mainSha: MAIN, baseline: BASELINE, relation: "identical" })).toBe(MAIN);
    expect(resolveTaskBaseSha({ mainSha: RUNTIME, baseline: BASELINE, relation: null })).toBe(RUNTIME);
    expect(resolveTaskBaseSha({ mainSha: MAIN, baseline: null, relation: null })).toBe(MAIN);
  });

  it("fails closed when the baseline diverged from main or is unknown to the remote", () => {
    expect(() => resolveTaskBaseSha({ mainSha: MAIN, baseline: BASELINE, relation: "diverged" })).toThrow(/diverged/);
    expect(() => resolveTaskBaseSha({ mainSha: MAIN, baseline: BASELINE, relation: null })).toThrow(/not available on the remote/);
    expect(() => resolveTaskBaseSha({ mainSha: null, baseline: BASELINE, relation: "ahead" })).toThrow(/main head/);
  });
});

describe("runtime baseline across crash / stop / restart", () => {
  it("started on the runtime branch: that branch/HEAD is the baseline, recorded only when it changes", () => {
    expect(establishRuntimeBaseline({ branch: BASELINE.branch, headSha: RUNTIME }, null)).toEqual({ ok: true, baseline: BASELINE, record: true });
    expect(establishRuntimeBaseline({ branch: BASELINE.branch, headSha: RUNTIME }, BASELINE)).toEqual({ ok: true, baseline: BASELINE, record: false });
    const newer = sha(0x50);
    expect(establishRuntimeBaseline({ branch: BASELINE.branch, headSha: newer }, BASELINE)).toEqual({ ok: true, baseline: { ...BASELINE, sha: newer }, record: true });
  });

  it("restarted on a task branch: keeps the recorded baseline instead of adopting the task branch", () => {
    expect(establishRuntimeBaseline({ branch: TASK, headSha: sha(0x99) }, BASELINE)).toEqual({ ok: true, baseline: BASELINE, record: false });
    expect(establishRuntimeBaseline({ branch: TASK, headSha: sha(0x99) }, null)).toMatchObject({ ok: false, code: "runtime_baseline_unknown" });
  });

  it("never adopts main/master or a detached HEAD as the baseline", () => {
    for (const branch of ["main", "master", "HEAD"]) expect(establishRuntimeBaseline({ branch, headSha: MAIN }, BASELINE)).toMatchObject({ ok: false, code: "runtime_baseline_unsafe_branch" });
  });
});

describe("returning the idle workspace to the runtime branch", () => {
  const idle = { status: { branch: TASK, dirtyPaths: [] }, baseline: BASELINE, taskActive: false, localBaselineSha: RUNTIME };

  it("returns a clean, finished task-branch checkout to the exact baseline", () => {
    expect(decideRuntimeRestore(idle)).toEqual({ action: "return", branch: BASELINE.branch, sha: RUNTIME });
  });

  it("stays while a task (or same-task repair) is active, or the tree is dirty", () => {
    expect(decideRuntimeRestore({ ...idle, taskActive: true })).toEqual({ action: "stay", reason: "task_active" });
    expect(decideRuntimeRestore({ ...idle, status: { branch: TASK, dirtyPaths: ["client/a.ts"] } })).toEqual({ action: "stay", reason: "dirty_worktree" });
  });

  it("never moves a non-task checkout, a moved/missing runtime branch, or onto main/master", () => {
    expect(decideRuntimeRestore({ ...idle, status: { branch: "feature/manual", dirtyPaths: [] } })).toEqual({ action: "stay", reason: "not_on_task_branch" });
    expect(decideRuntimeRestore({ ...idle, status: { branch: BASELINE.branch, dirtyPaths: [] } })).toEqual({ action: "stay", reason: "already_on_runtime" });
    expect(decideRuntimeRestore({ ...idle, localBaselineSha: null })).toEqual({ action: "stay", reason: "runtime_branch_missing" });
    expect(decideRuntimeRestore({ ...idle, localBaselineSha: sha(1) })).toEqual({ action: "stay", reason: "runtime_branch_moved" });
    for (const branch of ["main", "master", TASK]) expect(decideRuntimeRestore({ ...idle, baseline: { branch, sha: RUNTIME } })).toEqual({ action: "stay", reason: "unsafe_runtime_branch" });
    expect(decideRuntimeRestore({ ...idle, baseline: null })).toEqual({ action: "stay", reason: "no_baseline" });
  });
});
