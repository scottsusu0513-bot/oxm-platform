/**
 * Typed Worker / Manager availability failures. Pure and deterministic.
 *
 * Availability is infrastructure state, never a verdict on the task: a quota
 * or rate limit says nothing about whether the Worker can satisfy the goal,
 * so it must never consume a Manager-guided repair cycle or trigger repair
 * instructions. The classifier reads only a bounded prefix of the process
 * output; nothing it inspects is ever returned (no stdout/stderr leaks).
 */

export const AVAILABILITY_FAILURES = [
  /** Subscription / usage quota exhausted: waits for a reset. */
  "quota_exhausted",
  /** Short-lived throttling: a bounded same-contract retry is enough. */
  "rate_limited_transient",
  "service_unavailable",
  "authentication_unavailable",
  "executable_unavailable",
  "process_failure",
] as const;
export type AvailabilityFailure = (typeof AVAILABILITY_FAILURES)[number];

export interface AvailabilityClassification {
  kind: AvailabilityFailure;
  /**
   * Absolute reset time (ISO-8601, UTC) ONLY when the provider exposed a
   * trustworthy one (epoch, timezone-qualified timestamp, or a relative
   * seconds value resolved against the injected clock). Never guessed.
   */
  resetAt: string | null;
}

const INSPECT_BYTES = 8_192;

const QUOTA_RE =
  /usage[ _-]?limit|usage_limit_reached|quota[ _-]?(?:exceeded|exhausted|reached)|insufficient[ _-]?quota|limit reached|hit your (?:usage )?limit|out of (?:usage|credits)|(?:5|five)[- ]hour limit|weekly limit|monthly limit|plan limit|credit balance is too low/i;
const RATE_RE = /rate[ _-]?limit(?:ed)?|too many requests|\b429\b|slow down|requests per minute/i;
const SERVICE_RE = /\b(?:500|502|503|504|529)\b|overloaded|service unavailable|internal server error|bad gateway|gateway timeout|temporarily unavailable|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network error|stream disconnected/i;
const AUTH_RE = /not (?:logged|signed) in|please (?:log ?in|login|sign in)|unauthori[sz]ed|\b401\b|authentication (?:failed|required)|invalid api key|token (?:has )?expired|login required|auth(?:entication)? error|run `?(?:codex|claude) (?:auth )?login/i;

function iso(ms: number): string | null {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * Extracts a reset time only from unambiguous formats:
 *  - "...limit reached|1767225600" (epoch seconds after a pipe; Claude CLI)
 *  - "resets_at": "2026-10-07T18:00:00Z" / "reset at 2026-10-07T18:00:00+08:00"
 *  - "resets_in_seconds": 3600 / "retry-after: 3600" (relative; resolved against now)
 * Wall-clock text without a date or timezone ("try again at 3pm") is ignored.
 */
export function parseTrustedResetTime(text: string, now: string): string | null {
  const head = text.slice(0, INSPECT_BYTES);
  const epoch = /limit reached\|(\d{10})\b/i.exec(head);
  if (epoch) return iso(Number(epoch[1]) * 1000);
  const abs = /reset(?:s|_at|s_at| at| time)?["']?\s*[:=]?\s*["']?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))/i.exec(head);
  if (abs) return iso(Date.parse(abs[1]));
  const rel = /(?:resets?_in_seconds|retry[-_ ]after(?:_seconds)?)["']?\s*[:=]\s*["']?(\d{1,7})\b/i.exec(head);
  if (rel) {
    const base = Date.parse(now);
    return Number.isFinite(base) ? iso(base + Number(rel[1]) * 1000) : null;
  }
  return null;
}

/**
 * Classifies a failed CLI invocation. `spawnError` wins (the executable could
 * not start). Output patterns are checked from most to least specific; a
 * failure that matches nothing is a plain process failure (still
 * infrastructure, still no repair cycle).
 */
export function classifyAvailabilityFailure(input: { stdout?: string; stderr?: string; exitCode?: number | null; spawnError?: string | null; now: string }): AvailabilityClassification {
  if (input.spawnError) return { kind: input.spawnError === "ENOENT" || input.spawnError === "EACCES" ? "executable_unavailable" : "process_failure", resetAt: null };
  const text = `${(input.stderr ?? "").slice(0, INSPECT_BYTES)}\n${(input.stdout ?? "").slice(-INSPECT_BYTES)}`;
  if (QUOTA_RE.test(text)) return { kind: "quota_exhausted", resetAt: parseTrustedResetTime(text, input.now) };
  if (AUTH_RE.test(text)) return { kind: "authentication_unavailable", resetAt: null };
  if (RATE_RE.test(text)) return { kind: "rate_limited_transient", resetAt: parseTrustedResetTime(text, input.now) };
  if (SERVICE_RE.test(text)) return { kind: "service_unavailable", resetAt: null };
  if (input.exitCode === 127) return { kind: "executable_unavailable", resetAt: null };
  return { kind: "process_failure", resetAt: null };
}

/** Failures a bounded same-contract retry may clear (no waiting for a reset, no human). */
export const TRANSIENT_AVAILABILITY: readonly AvailabilityFailure[] = ["rate_limited_transient", "service_unavailable", "process_failure"];
