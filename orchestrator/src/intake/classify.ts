import {
  TASK_CATEGORIES,
  type TaskAction,
  type TaskCategory,
} from "../domain/types";
import { PRIORITY_SIGNALS, type PrioritySignal } from "../scheduler/types";
import type {
  IntakeClassification,
  MinimalLlmClassifier,
  PreparedIntake,
} from "./types";

const UI: readonly [RegExp, TaskCategory][] = [
  [/\b(css|stylesheet|tailwind)\b/i, "css"],
  [/\b(layout|spacing|alignment|responsive)\b/i, "layout"],
  [
    /\b(visual polish|polish the ui|pixel|color|typography)\b/i,
    "visual_polish",
  ],
  [/\b(frontend styling|style the|theme)\b/i, "frontend_styling"],
  [/\b(ui|user interface|button|modal|page|screen|loading state)\b/i, "ui"],
];
const ENGINEERING: readonly [RegExp, TaskCategory][] = [
  [/\b(auth|oauth|login|permission|rbac|session)\b/i, "auth"],
  [/\b(security|vulnerability|xss|csrf|injection)\b/i, "security"],
  [/\b(database|schema|migration|sql|data model)\b/i, "database"],
  [/\b(api|server|backend|endpoint|job|queue)\b/i, "backend"],
  [/\b(bug|fix|regression|broken|error|crash)\b/i, "bug_fix"],
  [/\b(architecture|architect|system design)\b/i, "architecture"],
  [/\b(business logic|workflow|rule)\b/i, "business_logic"],
];

function actionSeed(
  text: string,
  category: TaskCategory,
  hint: PreparedIntake["riskHint"]
): TaskAction[] {
  const out: TaskAction[] = [
    {
      kind:
        category === "ui" ||
        category === "css" ||
        category === "layout" ||
        category === "visual_polish" ||
        category === "frontend_styling"
          ? "ui_edit"
          : "code_edit",
    },
    { kind: "run_tests" },
    { kind: "run_check" },
    { kind: "open_pr" },
  ];
  if (/\b(dependency|package|upgrade library|lockfile)\b/i.test(text))
    out.push({ kind: "dependency_change" });
  if (/\b(ci|workflow|github actions)\b/i.test(text))
    out.push({ kind: "ci_workflow_change" });
  if (/\b(migration|schema file)\b/i.test(text))
    out.push({ kind: "migration_file_change" });
  if (category === "auth" || /\b(permission|authorization)\b/i.test(text))
    out.push({ kind: "auth_logic_change" });
  if (/\b(broad refactor|repo-wide|entire codebase)\b/i.test(text))
    out.push({ kind: "broad_refactor" });
  if (
    /\b(production|prod)\b.*\b(database|db)\b.*\b(write|update|modify)\b/i.test(
      text
    )
  )
    out.push({ kind: "prod_db_write" });
  if (/\b(production|prod)\b.*\b(schema|migration)\b/i.test(text))
    out.push({ kind: "prod_schema_change" });
  if (
    /\b(deploy|release)\b.*\b(production|prod)\b|\bproduction deploy\b/i.test(
      text
    )
  )
    out.push({ kind: "prod_deploy" });
  if (
    /\b(delete|drop|purge|truncate)\b.*\b(data|database|table|records?)\b/i.test(
      text
    )
  )
    out.push({ kind: "destructive_data_delete" });
  if (hint === "yellow") out.push({ kind: "config_change" });
  if (hint === "red") out.push({ kind: "irreversible_prod_op" });
  return Array.from(new Map(out.map(a => [a.kind, a])).values());
}

function prioritySeeds(
  text: string,
  supplied: readonly PrioritySignal[]
): PrioritySignal[] {
  const found = [...supplied];
  const add = (signal: PrioritySignal, re: RegExp) => {
    if (re.test(text)) found.push(signal);
  };
  add(
    "production_incident",
    /\b(prod(?:uction)? incident|production outage|sev[ -]?[01])\b/i
  );
  add("security_incident", /\bsecurity incident|active breach\b/i);
  add("main_ci_broken", /\bmain (?:branch )?ci (?:is )?broken\b/i);
  add("release_blocker", /\brelease blocker|blocks? release\b/i);
  add("functional_regression", /\bregression\b/i);
  add("auth_integrity", /\b(auth|permission).*(broken|incident|integrity)\b/i);
  add("data_integrity", /\bdata (?:loss|corruption|integrity)\b/i);
  return Array.from(new Set(found))
    .filter(s => PRIORITY_SIGNALS.includes(s))
    .sort();
}

function clarification(text: string): string[] {
  if (
    /^(help|please help|fix it|change it|make it better|do this)[.!]?$/i.test(
      text
    )
  )
    return ["an actionable objective and target outcome are required"];
  if (/\b(delete|remove|drop|purge)\s+(it|that|this|something)\b/i.test(text))
    return ["the destructive action needs a specific target"];
  return [];
}

export async function classifyIntake(
  input: PreparedIntake,
  llm?: MinimalLlmClassifier
): Promise<IntakeClassification> {
  const text = `${input.title}\n${input.instruction}`;
  const reasons = clarification(input.instruction);
  const normalizedCriteria = input.acceptanceCriteria.map(c =>
    c.text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
  );
  for (const criterion of normalizedCriteria) {
    const opposite = criterion.startsWith("not ")
      ? criterion.slice(4)
      : `not ${criterion}`;
    if (normalizedCriteria.includes(opposite))
      reasons.push("acceptance criteria contain incompatible outcomes");
  }
  let category =
    input.categoryHint ??
    UI.find(([re]) => re.test(text))?.[1] ??
    ENGINEERING.find(([re]) => re.test(text))?.[1] ??
    "general_coding";
  let path: IntakeClassification["path"] = "deterministic";
  let calls = 0;
  // The fallback is deliberately narrow: deterministic hints and ordinary engineering
  // requests never pay for a classifier call.
  if (
    !input.categoryHint &&
    category === "general_coding" &&
    /\b(classify with assistant|ambiguous product area)\b/i.test(text) &&
    llm
  ) {
    const result = await llm.classify({
      instruction: input.instruction,
      title: input.title,
    });
    calls = 1;
    path = "llm_fallback";
    if (
      !result ||
      !TASK_CATEGORIES.includes(result.category) ||
      !Array.isArray(result.clarificationReasons)
    ) {
      reasons.push("classifier returned invalid structured output");
    } else {
      category = result.category;
      reasons.push(
        ...result.clarificationReasons.filter(
          r => typeof r === "string" && r.length <= 200
        )
      );
    }
  }
  const clarificationReasons = Array.from(new Set(reasons));
  return {
    category,
    actions: actionSeed(text, category, input.riskHint),
    prioritySignals: prioritySeeds(text, input.prioritySignals),
    path,
    llmClassifierCalls: calls,
    clarificationReasons,
    clarificationRequired: clarificationReasons.length > 0,
    executable: clarificationReasons.length === 0,
  };
}
