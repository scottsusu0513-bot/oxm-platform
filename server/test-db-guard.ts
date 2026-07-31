/**
 * Test DB guard: ensures ALL tests run only against the approved local,
 * isolated test database — never production, never the shared dev database,
 * never any remote host.
 *
 * Fail-closed design: every candidate URL is validated the SAME way before
 * being used for anything (including before being written back to
 * process.env.DATABASE_URL) —
 *   1. NODE_ENV must be exactly "test".
 *   2. host must be loopback: localhost / 127.0.0.1 / ::1 (normalized).
 *   3. database name must be exactly "oxm_test" — this name is a hardcoded
 *      constant, not read from any environment variable, so it cannot be
 *      overridden by config.
 * TEST_DATABASE_URL is tried first, DATABASE_URL is the fallback; both paths
 * go through the identical validation above with no exceptions.
 *
 * Error messages only ever mention safe metadata (which env var, expected
 * vs. rejected host/database name) — never the full URL, credentials, or
 * any query/token content.
 *
 * Call this module via vitest setupFiles before any test file imports the DB.
 */
import { config } from "dotenv";

config(); // load .env (no-op if already loaded)

export const APPROVED_TEST_DATABASE_NAME = "oxm_test";
export const REQUIRED_NODE_ENV = "test";

export function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export interface TestDbGuardInput {
  nodeEnv: string | undefined;
  testDatabaseUrl: string | undefined;
  databaseUrl: string | undefined;
}

export interface TestDbGuardResult {
  ok: boolean;
  url?: string;
  label?: string;
  host?: string;
  database?: string;
  reason?: string;
}

/**
 * Pure, side-effect-free check — never throws, never touches process.env or
 * the network. Both TEST_DATABASE_URL and the DATABASE_URL fallback go
 * through this exact same validation; the approved database name is a
 * hardcoded constant (APPROVED_TEST_DATABASE_NAME), never read from any
 * environment variable, so it cannot be overridden.
 */
export function checkTestDbSafety(input: TestDbGuardInput): TestDbGuardResult {
  if (input.nodeEnv !== REQUIRED_NODE_ENV) {
    return { ok: false, reason: `NODE_ENV must be "${REQUIRED_NODE_ENV}" (got ${JSON.stringify(input.nodeEnv ?? null)})` };
  }

  const candidate = input.testDatabaseUrl
    ? { url: input.testDatabaseUrl, label: "TEST_DATABASE_URL" }
    : input.databaseUrl
      ? { url: input.databaseUrl, label: "DATABASE_URL" }
      : null;

  if (!candidate) {
    return { ok: false, reason: "no TEST_DATABASE_URL or DATABASE_URL was provided" };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate.url);
  } catch {
    return { ok: false, label: candidate.label, reason: `${candidate.label} could not be parsed as a valid URI` };
  }

  const host = parsed.hostname;
  if (!isLoopbackHost(host)) {
    return {
      ok: false,
      label: candidate.label,
      host,
      reason: `${candidate.label} host "${host}" is not an approved loopback host (localhost/127.0.0.1/::1)`,
    };
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (database !== APPROVED_TEST_DATABASE_NAME) {
    return {
      ok: false,
      label: candidate.label,
      host,
      database,
      reason: `${candidate.label} database "${database || "(empty)"}" must be exactly "${APPROVED_TEST_DATABASE_NAME}" (this name is a hardcoded constant, not overridable via env vars)`,
    };
  }

  return { ok: true, url: candidate.url, label: candidate.label, host, database };
}

/** Throwing wrapper used by the module-scope side effect below. */
export function assertTestDbSafety(input: TestDbGuardInput): { url: string; host: string; database: string } {
  const result = checkTestDbSafety(input);
  if (!result.ok) {
    // 只描述安全資訊（label、host、database、reason），絕不印出帳密、完整網址、token。
    throw new Error(`[test-db-guard] Refusing to run — ${result.reason}.`);
  }
  return { url: result.url!, host: result.host!, database: result.database! };
}

function resolveTestDbUrl(): string {
  const { url } = assertTestDbSafety({
    nodeEnv: process.env.NODE_ENV,
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    databaseUrl: process.env.DATABASE_URL,
  });
  process.env.DATABASE_URL = url;
  return url;
}

resolveTestDbUrl();
