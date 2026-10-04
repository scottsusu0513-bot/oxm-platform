import {
  ACTION_KINDS,
  type ActionKind,
  type ClassificationResult,
  type RiskDecision,
  type RiskLevel,
  type TaskAction,
  type TaskInput,
} from "./types";

/**
 * Deterministic, rule-based risk classification.
 *
 * Policy note: an authorized worker *reading* a secret is green. Risk is about
 * exposure (secret_exposure → red) or operational impact, not access.
 */

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

const PROTECTED_BRANCHES = new Set(["main", "master"]);

const ACTION_RISK: Record<Exclude<ActionKind, "commit" | "push">, RiskLevel> = {
  repo_read: "green",
  code_edit: "green",
  ui_edit: "green",
  run_tests: "green",
  run_check: "green",
  run_build: "green",
  open_pr: "green",
  update_pr: "green",
  secret_read: "green",

  dependency_change: "yellow",
  ci_workflow_change: "yellow",
  migration_file_change: "yellow",
  auth_logic_change: "yellow",
  broad_refactor: "yellow",
  config_change: "yellow",

  prod_db_write: "red",
  prod_schema_change: "red",
  prod_deploy: "red",
  force_push: "red",
  destructive_data_delete: "red",
  secret_exposure: "red",
  irreversible_prod_op: "red",
};

/** Path rules, evaluated in order; every matching rule contributes a reason. */
const PATH_RULES: ReadonlyArray<{ test: (p: string) => boolean; level: RiskLevel; label: string }> = [
  {
    // committing a real env file exposes secrets to Git
    test: (p) => /(^|\/)\.env(\.[^/]+)?$/.test(p) && !/\.(example|sample|template)$/.test(p),
    level: "red",
    label: "env file change (secret exposure to Git)",
  },
  {
    test: (p) =>
      /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(p) ||
      p.startsWith("patches/"),
    level: "yellow",
    label: "dependency change",
  },
  { test: (p) => p.startsWith(".github/workflows/"), level: "yellow", label: "CI workflow change" },
  {
    test: (p) => /^drizzle\/.*\.sql$/.test(p) || p.startsWith("drizzle/meta/") || p === "drizzle/schema.ts",
    level: "yellow",
    label: "migration/schema file change",
  },
  {
    test: (p) =>
      p === "server/_core/context.ts" ||
      p === "server/_core/trpc.ts" ||
      /(^|\/)[^/]*(auth|oauth|permission|rbac)[^/]*\.(ts|tsx)$/i.test(p),
    level: "yellow",
    label: "auth/permission logic change",
  },
  {
    test: (p) =>
      /^(tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts|drizzle\.config\.ts|capacitor\.config\.ts|ecosystem\.config\.cjs)$/.test(
        p,
      ),
    level: "yellow",
    label: "shared configuration change",
  },
];

export function normalizeBranch(branch: string): string {
  return branch.trim().replace(/^refs\/heads\//, "").replace(/^origin\//, "");
}

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(normalizeBranch(branch));
}

function assessAction(action: TaskAction): { level: RiskLevel; reason: string } {
  const { kind } = action;

  if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
    return { level: "red", reason: `unknown action "${String(kind)}" (fail-closed)` };
  }

  if (kind === "push") {
    if (!action.branch) return { level: "red", reason: "push without target branch (fail-closed)" };
    if (isProtectedBranch(action.branch)) {
      return { level: "red", reason: `direct push to ${normalizeBranch(action.branch)}` };
    }
    return { level: "green", reason: "push to working branch" };
  }

  if (kind === "commit") {
    if (!action.branch) return { level: "yellow", reason: "commit without target branch" };
    if (isProtectedBranch(action.branch)) {
      return { level: "yellow", reason: `local commit on ${normalizeBranch(action.branch)}` };
    }
    return { level: "green", reason: "commit to working branch" };
  }

  if (kind === "secret_exposure") {
    return { level: "red", reason: `secret exposure${action.surface ? ` to ${action.surface}` : ""}` };
  }

  return { level: ACTION_RISK[kind], reason: kind };
}

export function assessRisk(input: TaskInput): RiskDecision {
  const hits: { level: RiskLevel; reason: string }[] = [];

  for (const action of input.actions) hits.push(assessAction(action));

  for (const rawPath of input.changedPaths ?? []) {
    const path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    for (const rule of PATH_RULES) {
      if (rule.test(path)) hits.push({ level: rule.level, reason: `${rule.label}: ${path}` });
    }
  }

  if (input.category === "auth") {
    hits.push({ level: "yellow", reason: "auth category" });
  }

  let level: RiskLevel = "green";
  for (const hit of hits) if (RANK[hit.level] > RANK[level]) level = hit.level;

  // Report only the rules that determined the final level, de-duplicated, in input order.
  const reasons = Array.from(new Set(hits.filter((h) => h.level === level).map((h) => h.reason)));
  if (reasons.length === 0) reasons.push("no escalating signals");

  return { level, reasons, requiresApproval: level === "red" };
}

export function classifyTask(input: TaskInput): ClassificationResult {
  return { taskId: input.id, category: input.category, risk: assessRisk(input) };
}
