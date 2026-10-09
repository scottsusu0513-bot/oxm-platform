import { AGENT_INTENTS, TASK_CREATING_INTENTS, modeForIntent, type AgentIntent, type TaskCreatingIntent } from "../domain/types";
import { isDangerousValue, REDACTED } from "../store/sanitize";
import { validatePlannerGoal } from "./structured";
import { FOLLOW_UP_TOPICS, type CriterionReview, type FollowUpTopic, type IntentDecision } from "./types";

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > max || isDangerousValue(s)) return null;
  return s;
};

const CLARIFY: IntentDecision = { kind: "clarify", question: "I could not interpret that safely. What should the Agent do (and for which task)?" };

/**
 * Validates the planner's raw output. The planner can only pick an intent,
 * a known task id, and goal wording; the mode is derived from the intent and
 * everything else (task id, scope, risk, worker, branch) stays with intake.
 */
export function normalizeIntentDecision(raw: unknown, input: { knownTaskIds: readonly string[]; requireTask: boolean }): IntentDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return CLARIFY;
  const r = raw as Record<string, unknown>;
  const intent = r.intent;
  if (intent === "clarify") {
    const question = text(r.clarificationQuestion, 300);
    return question ? { kind: "clarify", question } : CLARIFY;
  }
  if (!(AGENT_INTENTS as readonly unknown[]).includes(intent)) return CLARIFY;
  if ((TASK_CREATING_INTENTS as readonly unknown[]).includes(intent)) {
    // Planner structured output has its own strict validation path (not the raw owner-input filters).
    const checked = validatePlannerGoal({ title: r.title, interpretedObjective: r.interpretedObjective, criteria: r.criteria, riskObservations: r.riskObservations ?? [] });
    if (!checked.ok || !checked.title) return CLARIFY;
    const ti = intent as TaskCreatingIntent;
    const areas = r.workAreas && typeof r.workAreas === "object" && !Array.isArray(r.workAreas) ? (r.workAreas as Record<string, unknown>) : null;
    const part = (v: unknown) => text(v, 1500);
    return {
      kind: "task",
      intent: ti,
      mode: modeForIntent(ti),
      title: checked.title,
      interpretedObjective: checked.interpretedObjective,
      criteria: checked.criteria,
      riskObservations: checked.riskObservations,
      ...(areas ? { workAreas: { programming: areas.programming === true, visual: areas.visual === true } } : {}),
      programmingObjective: part(r.programmingObjective),
      visualObjective: part(r.visualObjective),
      ownerReply: text(r.ownerReply, 600),
    };
  }
  if (input.requireTask) return { kind: "clarify", question: "「任務：」/goal creates a new task, but this reads like a question about an existing task. Send it without 「任務：」 or /goal." };
  const taskId = typeof r.taskId === "string" && input.knownTaskIds.includes(r.taskId) ? r.taskId : null;
  const kind = intent as Exclude<AgentIntent, TaskCreatingIntent>;
  if (kind === "task_follow_up") {
    // Only the fixed topic set survives; order and duplicates are normalized. Unknown topics are dropped.
    // Missing field (older planner output): topics stay unknown and the answer falls back to the task's outcome.
    const reply = text(r.ownerReply, 1_200);
    const ownerReply = reply ? { ownerReply: reply } : {};
    if (!Array.isArray(r.followUpTopics)) return { kind, intent: kind, taskId, ...ownerReply };
    const raw = r.followUpTopics as unknown[];
    const topics = FOLLOW_UP_TOPICS.filter((t) => raw.includes(t)) as FollowUpTopic[];
    return { kind, intent: kind, taskId, topics, ...ownerReply };
  }
  if (kind === "retry_task") {
    const reply = text(r.ownerReply, 1_200);
    return { kind, intent: kind, taskId, ...(reply ? { ownerReply: reply } : {}) };
  }
  return { kind, intent: kind, taskId };
}

const STATUSES = new Set(["satisfied", "not_satisfied", "unsupported"]);
const CONSTRAINT_STATUSES = new Set(["satisfied", "violated", "unsupported"]);

/** Reviewer verdicts on owner constraints; missing/duplicate/evidence-less "satisfied" -> unsupported. */
export function normalizeConstraintVerdicts(raw: unknown, ids: readonly string[]): Map<string, { status: "satisfied" | "violated" | "unsupported"; evidence: string }> {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { constraints?: unknown }).constraints) ? (raw as { constraints: unknown[] }).constraints : [];
  const out = new Map<string, { status: "satisfied" | "violated" | "unsupported"; evidence: string }>();
  const dup = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !ids.includes(r.id)) continue;
    if (out.has(r.id)) dup.add(r.id);
    const status = CONSTRAINT_STATUSES.has(String(r.status)) ? (r.status as "satisfied" | "violated" | "unsupported") : "unsupported";
    const evidence = text(r.evidence, 300) ?? "";
    const reason = text(r.reason, 300) ?? "";
    out.set(r.id, { status: status === "satisfied" && !evidence ? "unsupported" : status, evidence: evidence || reason || "no evidence cited" });
  }
  for (const id of Array.from(dup)) out.set(id, { status: "unsupported", evidence: "reviewer returned conflicting verdicts" });
  return out;
}

export const MAX_OWNER_ANSWER = 4_000;

/**
 * The Manager's owner answer (read-only work), or null when missing or not a
 * string. Output hygiene only: line endings normalized, secret-like
 * substrings redacted, length bounded. The Manager's prose is NOT
 * re-validated claim by claim; that judgement is the Manager's.
 */
export function normalizeOwnerAnswer(raw: unknown): string | null {
  const value = raw && typeof raw === "object" ? (raw as { ownerAnswer?: unknown }).ownerAnswer : undefined;
  if (typeof value !== "string") return null;
  const answer = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\b(bearer|basic)\s+\S+/gi, REDACTED)
    .split(/(\s+)/)
    .map((tok) => (isDangerousValue(tok) ? REDACTED : tok))
    .join("")
    .trim();
  if (!answer) return null;
  return answer.length > MAX_OWNER_ANSWER ? `${answer.slice(0, MAX_OWNER_ANSWER - 1)}…` : answer;
}

/**
 * Validates the reviewer's raw output against the exact criteria under
 * review. Missing, duplicate or unknown ids, and "satisfied" without cited
 * evidence, all become "unsupported" — never accepted by default.
 */
export function normalizeGoalReview(raw: unknown, criteria: readonly { id: string }[]): CriterionReview[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { criteria?: unknown }).criteria) ? ((raw as { criteria: unknown[] }).criteria) : [];
  const seen = new Map<string, CriterionReview>();
  const dup = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !criteria.some((c) => c.id === r.id)) continue;
    if (seen.has(r.id)) dup.add(r.id);
    const status = STATUSES.has(String(r.status)) ? (r.status as CriterionReview["status"]) : "unsupported";
    const evidence = text(r.evidence, 300) ?? "";
    const reason = text(r.reason, 300) ?? "";
    seen.set(r.id, { id: r.id, status: status === "satisfied" && !evidence ? "unsupported" : status, evidence, reason: reason || (status === "satisfied" && !evidence ? "no evidence cited" : "") });
  }
  return criteria.map((c) =>
    dup.has(c.id) || !seen.has(c.id)
      ? { id: c.id, status: "unsupported", evidence: "", reason: dup.has(c.id) ? "reviewer returned conflicting verdicts" : "reviewer did not assess this criterion" }
      : seen.get(c.id)!,
  );
}
