import { isProtectedBranch } from "../domain/risk";
import { TASK_CATEGORIES } from "../domain/types";
import { TASK_BRANCH_PREFIX } from "./types";

/**
 * Deterministic task branch naming: `agent/task-<taskId>-<slug>`.
 *
 * The name is a pure function of (taskId, title, category). The slug is
 * reduced to lowercase ASCII [a-z0-9-], so no free-form text (worker output,
 * shell metacharacters, unicode look-alikes, ref syntax) can reach a branch
 * name. Branch identity is always checked by recomputing the expected name,
 * never by parsing a name back into a task id.
 */

/** Lowercase alphanumerics with single inner hyphens (UUIDs qualify). */
export const BRANCH_TASK_ID_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;
export const MAX_SLUG_LENGTH = 40;
export const TASK_BRANCH_RE = /^agent\/task-[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,120}$/;
export const SHA_RE = /^[0-9a-f]{40}$/;

export function isValidBranchTaskId(taskId: unknown): taskId is string {
  return typeof taskId === "string" && BRANCH_TASK_ID_RE.test(taskId);
}

export function isValidSha(sha: unknown): sha is string {
  return typeof sha === "string" && SHA_RE.test(sha);
}

/** Lowercase ASCII slug; falls back to the category, then "task". */
export function slugify(title: unknown, fallback = "task"): string {
  const ascii = typeof title === "string" ? title.normalize("NFKD").replace(/[̀-ͯ]/g, "") : "";
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function taskBranchName(taskId: string, title: string, category?: string): string {
  if (!isValidBranchTaskId(taskId)) throw new Error("invalid task id for branch naming");
  const fallback = category && (TASK_CATEGORIES as readonly string[]).includes(category) ? slugify(category) : "task";
  return `${TASK_BRANCH_PREFIX}${taskId}-${slugify(title, fallback)}`;
}

export type TaskBranchCheck = { ok: true; branch: string } | { ok: false; reason: string };

/** A writable task branch: matches the task-branch pattern and is never protected. */
export function checkTaskBranchName(branch: unknown): TaskBranchCheck {
  if (typeof branch !== "string" || branch === "") return { ok: false, reason: "branch is empty or not a string" };
  if (isProtectedBranch(branch)) return { ok: false, reason: "protected branch requested" };
  if (!TASK_BRANCH_RE.test(branch)) return { ok: false, reason: "branch does not match the task branch pattern" };
  return { ok: true, branch };
}
