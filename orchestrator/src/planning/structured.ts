import { isDangerousValue } from "../store/sanitize";
import { RISK_SIGNAL_KINDS } from "../intake/riskSignals";

/**
 * Validation for planner-derived STRUCTURED output (interpreted objective,
 * title, acceptance criteria, risk observations). This is a separate trust
 * domain from raw owner input: legitimate engineering vocabulary ("function",
 * "class", "API", "SQL", "shell", "Git", "authentication") is fine here,
 * because the text is a non-authoritative description, never executed and
 * never granted authority. What is rejected:
 *  - malformed / oversized / control-character data,
 *  - credential-looking values,
 *  - executable instructions (shell pipelines, destructive commands, code
 *    fences, command substitution, script tags),
 *  - prompt-injection directives aimed at later model calls.
 */
export const PLANNER_LIMITS = Object.freeze({ title: 120, objective: 2_000, criterion: 300, criteriaMin: 1, criteriaMax: 8, observations: 12 });

const EMBEDDED_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\bauthorization\s*[:=]\s*\S+|\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*\S{6,}/i;

const EXECUTABLE = [
  /```/,
  /\$\(|`[^`]*\b(rm|curl|wget|sudo|chmod|chown|mkfs|dd|bash|sh)\b[^`]*`/i,
  /\b(curl|wget)\b[^|\n]*\|\s*(ba|z)?sh\b/i,
  /\brm\s+-[a-z]*[rf][a-z]*\b/i,
  /\bsudo\s+\S/i,
  /\b(mkfs|shutdown|reboot)\b|\bdd\s+if=/i,
  /\bchmod\s+[0-7]{3,4}\b|\bchmod\s+\+x\b/i,
  /\bgit\s+push\s+(-f|--force)\b|\bgit\s+reset\s+--hard\b/i,
  /\bdrop\s+(table|database)\s+[a-z_]/i,
  /<\s*script\b/i,
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)\b/i,
  /\byou\s+are\s+now\b|\bsystem\s+prompt\b/i,
];

export function plannerTextIssue(value: unknown, max: number): string | null {
  if (typeof value !== "string") return "not text";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return "control characters";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "empty";
  if (text.length > max) return "too long";
  if (isDangerousValue(text) || text.split(" ").some((w) => isDangerousValue(w)) || EMBEDDED_SECRET.test(text)) return "credential-looking content";
  if (EXECUTABLE.some((re) => re.test(text))) return "executable instruction or injection directive";
  return null;
}

export function plannerText(value: unknown, max: number): string | null {
  return plannerTextIssue(value, max) === null ? (value as string).replace(/\s+/g, " ").trim() : null;
}

export type PlannerGoalCheck =
  | { ok: true; title: string | null; interpretedObjective: string; criteria: string[]; riskObservations: string[] }
  | { ok: false; reason: string };

/** Strict schema for the planner's goal fields (used by the Gateway and again by intake). */
export function validatePlannerGoal(input: { title?: unknown; interpretedObjective: unknown; criteria: unknown; riskObservations?: unknown }): PlannerGoalCheck {
  let title: string | null = null;
  if (input.title !== undefined) {
    const issue = plannerTextIssue(input.title, PLANNER_LIMITS.title);
    if (issue) return { ok: false, reason: `title: ${issue}` };
    title = plannerText(input.title, PLANNER_LIMITS.title);
  }
  const objIssue = plannerTextIssue(input.interpretedObjective, PLANNER_LIMITS.objective);
  if (objIssue) return { ok: false, reason: `objective: ${objIssue}` };
  if (!Array.isArray(input.criteria) || input.criteria.length < PLANNER_LIMITS.criteriaMin || input.criteria.length > PLANNER_LIMITS.criteriaMax)
    return { ok: false, reason: `criteria: need ${PLANNER_LIMITS.criteriaMin}-${PLANNER_LIMITS.criteriaMax}` };
  const criteria: string[] = [];
  for (const c of input.criteria) {
    const issue = plannerTextIssue(c, PLANNER_LIMITS.criterion);
    if (issue) return { ok: false, reason: `criterion: ${issue}` };
    criteria.push(plannerText(c, PLANNER_LIMITS.criterion)!);
  }
  if (new Set(criteria.map((c) => c.toLowerCase())).size !== criteria.length) return { ok: false, reason: "criteria: duplicates" };
  const obs = input.riskObservations;
  if (obs !== undefined && (!Array.isArray(obs) || obs.length > PLANNER_LIMITS.observations || obs.some((o) => !(RISK_SIGNAL_KINDS as readonly unknown[]).includes(o))))
    return { ok: false, reason: "riskObservations: unknown kind" };
  return { ok: true, title, interpretedObjective: plannerText(input.interpretedObjective, PLANNER_LIMITS.objective)!, criteria, riskObservations: Array.from(new Set((obs as string[] | undefined) ?? [])) };
}
