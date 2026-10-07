import { AGENT_INTENTS, TASK_CREATING_INTENTS, modeForIntent, type AgentIntent, type TaskCreatingIntent } from "../domain/types";
import { isDangerousValue } from "../store/sanitize";
import { validatePlannerGoal } from "./structured";
import type { CriterionReview, IntentDecision } from "./types";

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
    return { kind: "task", intent: ti, mode: modeForIntent(ti), title: checked.title, interpretedObjective: checked.interpretedObjective, criteria: checked.criteria, riskObservations: checked.riskObservations };
  }
  if (input.requireTask) return { kind: "clarify", question: "/goal creates a new task, but this reads like a question about an existing task. Send it without /goal." };
  const taskId = typeof r.taskId === "string" && input.knownTaskIds.includes(r.taskId) ? r.taskId : null;
  const kind = intent as Exclude<AgentIntent, TaskCreatingIntent>;
  return { kind, intent: kind, taskId };
}

const STATUSES = new Set(["satisfied", "not_satisfied", "unsupported"]);

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
