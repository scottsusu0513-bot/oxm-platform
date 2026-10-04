import type { JsonValue } from "./types";

/**
 * Deterministic metadata sanitizer for audit persistence.
 *
 * - Keys whose normalized name (lowercase, alphanumerics only) contains a
 *   dangerous fragment have their value replaced with REDACTED.
 * - String values that look like credentials (bearer headers, URLs with
 *   embedded user:pass, well-known token prefixes) are redacted regardless of key.
 * - Recurses through plain objects and arrays; output is plain JSON.
 * - Functions/symbols/undefined are dropped, cycles and excessive depth are
 *   replaced with markers. Input is never mutated.
 */
export const REDACTED = "[REDACTED]";
export const CIRCULAR = "[Circular]";
export const MAX_DEPTH_MARKER = "[MaxDepth]";
export const MAX_DEPTH = 12;

const DANGEROUS_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "accesskey",
  "refreshtoken",
  "oauthcode",
  "databaseurl",
  "privatekey",
  "credential",
  "prompt",
] as const;

/** Keys that match a fragment but are known-safe by construction. */
const SAFE_KEYS = new Set(["prompthash"]);

const DANGEROUS_VALUE_PATTERNS = [
  /^\s*(bearer|basic)\s+\S+/i,
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i, // scheme://user:pass@host
  /\b(sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/,
];

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isDangerousKey(key: string): boolean {
  const k = normalizeKey(key);
  if (SAFE_KEYS.has(k)) return false;
  return DANGEROUS_KEY_FRAGMENTS.some((f) => k.includes(f));
}

export function isDangerousValue(value: string): boolean {
  return DANGEROUS_VALUE_PATTERNS.some((re) => re.test(value));
}

export function sanitizeMetadata(input: unknown): { [key: string]: JsonValue } {
  if (input === undefined || input === null) return {};
  const out = sanitizeValue(input, 0, new Set());
  if (out !== undefined && out !== null && typeof out === "object" && !Array.isArray(out)) return out;
  return { value: out ?? null };
}

function sanitizeValue(value: unknown, depth: number, seen: Set<object>): JsonValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return isDangerousValue(value) ? REDACTED : value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }

  const obj = value as object;
  if (seen.has(obj)) return CIRCULAR;
  if (depth >= MAX_DEPTH) return MAX_DEPTH_MARKER;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeValue(item, depth + 1, seen) ?? null);
    }
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(obj).sort()) {
      if (isDangerousKey(key)) {
        result[key] = REDACTED;
        continue;
      }
      const v = sanitizeValue((obj as Record<string, unknown>)[key], depth + 1, seen);
      if (v !== undefined) result[key] = v;
    }
    return result;
  } finally {
    seen.delete(obj);
  }
}
