import { isPlannerApproved } from "../branches/planner";
import { checkTaskBranchName, isValidSha } from "../branches/naming";
import type { AssignedBranchPlan } from "../branches/types";
import { isDangerousValue, REDACTED } from "../store/sanitize";
import { PR_BASE_BRANCH, type PrTaskMetadata, type PullRequestTextInput, type RepoRef } from "./types";

/**
 * Deterministic guards for every GitHub write. All checks fail closed.
 */

const REPO_PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function isValidRepo(repo: unknown): repo is RepoRef {
  const r = repo as RepoRef;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.owner === "string" &&
    typeof r.repo === "string" &&
    REPO_PART_RE.test(r.owner) &&
    REPO_PART_RE.test(r.repo) &&
    !r.owner.startsWith(".") &&
    !r.repo.startsWith(".")
  );
}

export type PlanCheck = { ok: true; plan: AssignedBranchPlan } | { ok: false; reason: string };

/** The plan must be a planner-issued new_branch/reuse_branch plan with a valid task branch and base. */
export function checkAssignedPlan(plan: unknown, allowed: readonly AssignedBranchPlan["decision"][]): PlanCheck {
  if (!isPlannerApproved(plan)) return { ok: false, reason: "branch plan was not approved by the deterministic planner" };
  if (!allowed.includes(plan.decision)) return { ok: false, reason: `plan decision ${plan.decision} does not allow this operation` };
  const name = checkTaskBranchName(plan.branch);
  if (!name.ok) return { ok: false, reason: name.reason };
  if (plan.baseBranch !== PR_BASE_BRANCH) return { ok: false, reason: "plan base must be main" };
  if (!isValidSha(plan.baseSha)) return { ok: false, reason: "plan base SHA is invalid" };
  return { ok: true, plan };
}

export const MAX_PR_TITLE = 120;
export const MAX_PR_SUMMARY = 2000;
export const MAX_PR_CRITERIA = 20;
export const MAX_PR_CRITERION = 300;

/** Single-line, control-char-free, credential-redacted text with a hard length cap. */
export function sanitizePrText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  let s = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  s = multiline ? s.replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  s = s
    .replace(/\b(bearer|basic)\s+\S+/gi, REDACTED)
    .split(/(\s+)/)
    .map((tok) => (isDangerousValue(tok) ? REDACTED : tok))
    .join("")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** PR title/body from sanitized task metadata only. */
export function buildPrText(taskId: string, branch: string, meta: PrTaskMetadata): PullRequestTextInput {
  const title = sanitizePrText(meta?.title, MAX_PR_TITLE) || `Task ${taskId}`;
  const summary = sanitizePrText(meta?.summary, MAX_PR_SUMMARY, true);
  const criteria = (Array.isArray(meta?.acceptanceCriteria) ? meta.acceptanceCriteria : [])
    .slice(0, MAX_PR_CRITERIA)
    .map((c) => sanitizePrText(c, MAX_PR_CRITERION))
    .filter(Boolean);
  const body = [
    `Task: ${taskId}`,
    `Branch: ${branch}`,
    "",
    "## Summary",
    summary || "(none)",
    "",
    "## Acceptance criteria",
    ...(criteria.length ? criteria.map((c) => `- ${c}`) : ["- (none)"]),
    "",
    "Opened by the OXM orchestrator. Merging requires human review.",
  ].join("\n");
  return { title, body };
}
