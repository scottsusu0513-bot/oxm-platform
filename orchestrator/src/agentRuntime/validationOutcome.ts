import type { ValidationStatus } from "../manager/types";
import type { ProcessExit } from "../workers/types";

/**
 * Classifies one trusted validation run (pure; no I/O). Only a run that
 * actually executed and failed, with no sign of an infrastructure cause,
 * counts as "failed" (failed_due_to_task). Output is inspected here for
 * known infrastructure signatures and then discarded; only the category
 * becomes evidence.
 */
export type ValidationRunOutcome = Extract<ValidationStatus, "passed" | "failed" | "unavailable" | "unverified">;

export interface ValidationClassification {
  status: ValidationRunOutcome;
  /** Sanitized, log-free reason for anything but passed/failed. */
  summary?: string;
}

/**
 * Signatures of an environment that could not run the command at all.
 * Deliberately narrow: TypeScript's own "Cannot find module './x'" (TS2307)
 * is a code error and is NOT matched — only the tools/package manager missing.
 */
const INFRA_SIGNATURES: readonly { re: RegExp; reason: string }[] = [
  { re: /(?:^|\n)\s*(?:\/bin\/)?(?:sh|bash|zsh)(?::\s*(?:line\s*)?\d+)?:\s*[\w./@-]+: (?:command )?not found\b/i, reason: "a required command or tool is not installed" },
  { re: /(?:^|\n)\s*(?:pnpm|npm|npx|node|vitest|tsc|corepack): (?:command )?not found\b/i, reason: "a required command or tool is not installed" },
  { re: /\bcorepack\b[\s\S]{0,200}\b(?:error|failed|cannot)\b|Cannot find matching keyid|Usage Error: [^\n]*packageManager/i, reason: "the package manager (corepack/pnpm) could not be prepared" },
  { re: /\bERR_PNPM_(?!RECURSIVE_RUN_FIRST_FAIL\b|RECURSIVE_EXEC_FIRST_FAIL\b)[A-Z_]+\b/, reason: "the package manager failed before the command ran" },
  { re: /node_modules missing|Local package\.json exists, but node_modules/i, reason: "dependencies are not installed" },
  { re: /Cannot find (?:module|package) '(?:vitest|typescript|vite|tsx|esbuild|@vitejs\/[^']+)'/i, reason: "a validation tool is not installed" },
  { re: /node_modules\/\.bin\/[\w.-]+:? (?:not found|No such file)/i, reason: "a validation tool is not installed" },
  { re: /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH)\b/, reason: "a network or external service was unavailable" },
  { re: /\bENOSPC\b|JavaScript heap out of memory/i, reason: "the machine ran out of disk or memory" },
  { re: /Refusing to run[^\n]*TEST_DATABASE_URL|no TEST_DATABASE_URL/i, reason: "the test database environment is not configured" },
];

export function classifyValidationExit(exit: ProcessExit | null, timedOut: boolean): ValidationClassification {
  if (timedOut) return { status: "unverified", summary: "validation timed out; the result cannot be attributed to the task" };
  if (!exit) return { status: "unavailable", summary: "validation could not be started" };
  if (exit.spawnError) return { status: "unavailable", summary: "validation command is not available in this environment" };
  if (exit.signal !== null) return { status: "unverified", summary: "validation was interrupted; the result cannot be attributed to the task" };
  if (exit.exitCode === 0) return { status: "passed" };
  const output = `${exit.stdout}\n${exit.stderr}`;
  const infra = INFRA_SIGNATURES.find((s) => s.re.test(output));
  if (infra) return { status: "unavailable", summary: `validation could not run: ${infra.reason}` };
  return { status: "failed" };
}

/**
 * A failure observed while unrelated (non-task) changes were present in the
 * shared workspace cannot be attributed to the task with certainty.
 */
export function attributeValidationFailure(c: ValidationClassification, foreignPathCount: number): ValidationClassification {
  if (c.status !== "failed" || foreignPathCount === 0) return c;
  return { status: "unverified", summary: `validation failed while ${foreignPathCount} unrelated workspace change(s) were present; not attributable to this task` };
}
