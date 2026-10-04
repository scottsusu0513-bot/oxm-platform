import { RISK_LEVELS, type RiskLevel } from "../domain/types";
import { VALIDATION_OUTCOMES, type TestRunRecord, type ValidationOutcome, type WorkerReport } from "./types";

/**
 * Strict parsing of Claude Code headless output. Pure: no I/O.
 *
 * `claude -p --output-format json` prints one envelope object whose `result`
 * string must itself be exactly the WorkerReport JSON (optionally wrapped in
 * a single ```json fence). Anything else — malformed JSON, unknown keys or
 * enum values, bad branch/SHA formats — is rejected. Malformed output is
 * never success. Free text is control-char stripped, length capped, and
 * secret-like substrings are redacted before anything can be persisted.
 */

export const SHA_RE = /^[0-9a-f]{40}$/;
export const REDACTED = "[REDACTED]";

const LIMITS = { summary: 2000, path: 400, files: 500, tests: 50, command: 200, notes: 20, note: 300 } as const;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@\S*/gi, // scheme://user:pass@host
  /\b(?:sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|database[_-]?url)\b\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function sanitizeText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = redactSecrets(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""));
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Git ref-name subset: no "..", no leading "-", no ".lock", no whitespace/control/shell metachars. */
export function isValidBranchName(branch: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock") &&
    !branch.endsWith(".")
  );
}

export function isSafeRepoPath(p: string): boolean {
  if (p.length === 0 || p.length > LIMITS.path) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\") || p.includes("\0")) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "");
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export interface ClaudeEnvelope {
  isError: boolean;
  subtype: string;
  result: string;
}

/** Parses the CLI's JSON envelope. Never returns raw text other than `result`. */
export function parseClaudeEnvelope(stdout: string): ParseResult<ClaudeEnvelope> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.trim());
  } catch {
    return fail("envelope is not valid JSON");
  }
  if (!isPlainObject(raw) || raw.type !== "result") return fail("envelope is not a result object");
  const subtype = typeof raw.subtype === "string" ? raw.subtype : "";
  const isError = raw.is_error === true || subtype !== "success";
  if (!isError && typeof raw.result !== "string") return fail("envelope result is not a string");
  return { ok: true, value: { isError, subtype: sanitizeText(subtype, 64), result: isError ? "" : (raw.result as string) } };
}

const REPORT_KEYS = [
  "status",
  "summary",
  "filesChanged",
  "testsRun",
  "checkResult",
  "branch",
  "headSha",
  "prNumber",
  "riskObserved",
  "needsApproval",
  "fallbackRecommended",
  "errorType",
] as const;

export function parseWorkerReport(text: string): ParseResult<WorkerReport> {
  let body = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body);
  if (fence) body = fence[1].trim();

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return fail("worker result is not valid JSON");
  }
  if (!isPlainObject(raw)) return fail("worker result is not an object");

  const unknownKeys = Object.keys(raw).filter((k) => !(REPORT_KEYS as readonly string[]).includes(k));
  if (unknownKeys.length) return fail(`unknown result field(s): ${unknownKeys.slice(0, 5).map((k) => sanitizeText(k, 40)).join(", ")}`);
  const missing = REPORT_KEYS.filter((k) => !(k in raw));
  if (missing.length) return fail(`missing result field(s): ${missing.join(", ")}`);

  // A worker can only report success/failure; cancelled/timeout are decided by the orchestrator.
  if (raw.status !== "success" && raw.status !== "failure") return fail("invalid status");
  if (typeof raw.summary !== "string" || raw.summary.trim() === "") return fail("summary must be a non-empty string");

  if (!Array.isArray(raw.filesChanged) || raw.filesChanged.length > LIMITS.files) return fail("invalid filesChanged");
  if (!raw.filesChanged.every((p): p is string => typeof p === "string" && isSafeRepoPath(p))) {
    return fail("filesChanged must contain repo-relative paths");
  }

  if (!Array.isArray(raw.testsRun) || raw.testsRun.length > LIMITS.tests) return fail("invalid testsRun");
  const testsRun: TestRunRecord[] = [];
  for (const t of raw.testsRun) {
    if (!isPlainObject(t) || typeof t.command !== "string" || !isOutcome(t.outcome)) return fail("invalid testsRun entry");
    testsRun.push({ command: sanitizeText(t.command, LIMITS.command), outcome: t.outcome });
  }

  if (!isOutcome(raw.checkResult)) return fail("invalid checkResult");
  if (typeof raw.branch !== "string" || !isValidBranchName(raw.branch)) return fail("invalid branch");
  if (typeof raw.headSha !== "string" || !SHA_RE.test(raw.headSha)) return fail("invalid headSha");
  // The worker has no GitHub write capability; any PR number it reports is fabricated.
  if (raw.prNumber !== null) return fail("prNumber must be null (worker cannot open pull requests)");

  const risk = raw.riskObserved;
  if (!isPlainObject(risk) || !(RISK_LEVELS as readonly unknown[]).includes(risk.level)) return fail("invalid riskObserved");
  if (!Array.isArray(risk.notes) || !risk.notes.every((n) => typeof n === "string")) return fail("invalid riskObserved.notes");

  if (typeof raw.needsApproval !== "boolean") return fail("needsApproval must be boolean");
  if (typeof raw.fallbackRecommended !== "boolean") return fail("fallbackRecommended must be boolean");
  if (raw.errorType !== null && !(typeof raw.errorType === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(raw.errorType))) {
    return fail("invalid errorType");
  }

  return {
    ok: true,
    value: {
      status: raw.status,
      summary: sanitizeText(raw.summary, LIMITS.summary),
      filesChanged: Array.from(new Set(raw.filesChanged.map((p) => redactSecrets(p)))),
      testsRun,
      checkResult: raw.checkResult,
      branch: raw.branch,
      headSha: raw.headSha,
      prNumber: null,
      riskObserved: {
        level: risk.level as RiskLevel,
        notes: (risk.notes as string[]).slice(0, LIMITS.notes).map((n) => sanitizeText(n, LIMITS.note)),
      },
      needsApproval: raw.needsApproval,
      fallbackRecommended: raw.fallbackRecommended,
      errorType: raw.errorType as string | null,
    },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOutcome(v: unknown): v is ValidationOutcome {
  return (VALIDATION_OUTCOMES as readonly unknown[]).includes(v);
}
