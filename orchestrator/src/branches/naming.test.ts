import { describe, expect, it } from "vitest";
import { checkTaskBranchName, slugify, taskBranchName } from "./naming";

describe("deterministic branch naming", () => {
  it("formats agent/task-<taskId>-<slug> deterministically", () => {
    const a = taskBranchName("t-42", "Add Region Multi-Select!", "ui");
    expect(a).toBe("agent/task-t-42-add-region-multi-select");
    expect(taskBranchName("t-42", "Add Region Multi-Select!", "ui")).toBe(a);
  });

  it("sanitizes slugs to lowercase ascii and caps length", () => {
    expect(slugify("Café  --  Déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("x".repeat(100)).length).toBe(40);
    expect(slugify("a".repeat(39) + "-bbbb")).toBe("a".repeat(39));
  });

  it("falls back to category, then 'task' for empty/non-ascii titles", () => {
    expect(taskBranchName("t1", "地區複選", "bug_fix")).toBe("agent/task-t1-bug-fix");
    expect(taskBranchName("t1", "", undefined)).toBe("agent/task-t1-task");
  });

  it("shell injection / ref syntax in titles never reaches the branch name", () => {
    for (const t of ["$(rm -rf /)", "; git push --force origin main", "`id`", "../../main", "refs/heads/main", "a..b@{0}~^:"]) {
      const b = taskBranchName("t1", t);
      expect(b).toMatch(/^agent\/task-t1-[a-z0-9-]+$/);
      expect(checkTaskBranchName(b).ok).toBe(true);
    }
  });

  it("rejects invalid task ids", () => {
    for (const id of ["", "T1", "a_b", "a--b", "-a", "a-", "a/b", "a b", "x".repeat(65)]) {
      expect(() => taskBranchName(id, "x")).toThrow();
    }
  });

  it("rejects protected and non-task branches", () => {
    for (const b of ["main", "master", "refs/heads/main", "origin/master", " main", "feature/x", "agent/task-", "agent/task-A", "agent/task-x/../main", ""]) {
      expect(checkTaskBranchName(b).ok, b).toBe(false);
    }
    expect(checkTaskBranchName("main")).toEqual({ ok: false, reason: "protected branch requested" });
  });
});
