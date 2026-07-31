/**
 * Fail-closed DB safety gate for server/financeOptimization.test.ts.
 *
 * This is a pure, dependency-free module (no DB connection, no imports from
 * db.ts) so its logic can be unit tested in isolation without ever touching
 * a real database — see financeIntegrationTestDbGuard.test.ts.
 *
 * Every check below must pass before financeOptimization.test.ts performs
 * any INSERT/UPDATE/DELETE. A single failing condition throws immediately.
 * Checking "host is localhost" alone is NOT sufficient — an SSH/port-forward
 * tunnel can make a remote production database appear as localhost — so this
 * also requires the database NAME to be an explicitly approved local test
 * database, NODE_ENV to be "test", and an explicit opt-in flag to be set.
 *
 * Error messages only ever include the parsed host/database (never
 * credentials or the full connection string).
 */

export interface FinanceTestDbSafetyInput {
  nodeEnv: string | undefined;
  optInFlag: string | undefined;
  databaseUrl: string | undefined;
  /** Defaults to ["oxm_test"]. Override only for tests of this module itself. */
  allowedTestDatabaseNames?: string[];
}

export interface FinanceTestDbSafetyResult {
  ok: boolean;
  host?: string;
  database?: string;
  reason?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
export const DEFAULT_ALLOWED_TEST_DATABASE_NAMES = ["oxm_test"];
export const REQUIRED_OPT_IN_VALUE = "1";
export const REQUIRED_NODE_ENV = "test";

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Pure check — never throws, never logs. Returns a structured result so
 * callers (and unit tests) can inspect exactly which condition failed
 * without relying on string-matching an error message.
 */
export function checkFinanceIntegrationTestDbSafety(
  input: FinanceTestDbSafetyInput,
): FinanceTestDbSafetyResult {
  if (input.nodeEnv !== REQUIRED_NODE_ENV) {
    return {
      ok: false,
      reason: `NODE_ENV must be "${REQUIRED_NODE_ENV}" (got ${JSON.stringify(input.nodeEnv ?? null)})`,
    };
  }

  if (input.optInFlag !== REQUIRED_OPT_IN_VALUE) {
    return {
      ok: false,
      reason: `FINANCE_INTEGRATION_TESTS_CONFIRMED must be "${REQUIRED_OPT_IN_VALUE}" (explicit opt-in flag missing or wrong value)`,
    };
  }

  if (!input.databaseUrl) {
    return { ok: false, reason: "no database URL was provided (FINANCE_TEST_DATABASE_URL is not set)" };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.databaseUrl);
  } catch {
    return { ok: false, reason: "database URL could not be parsed as a valid URI" };
  }

  const host = parsed.hostname;
  if (!isLoopbackHost(host)) {
    return { ok: false, host, reason: `host "${host}" is not an approved loopback host (localhost/127.0.0.1/::1)` };
  }

  const database = parsed.pathname.replace(/^\//, "");
  const allowed = input.allowedTestDatabaseNames ?? DEFAULT_ALLOWED_TEST_DATABASE_NAMES;
  if (!database || !allowed.includes(database)) {
    return {
      ok: false,
      host,
      database,
      reason: `database "${database || "(empty)"}" is not an approved test database name (allowed: ${allowed.join(", ")})`,
    };
  }

  return { ok: true, host, database };
}

/**
 * Throwing wrapper for use at the top of the integration test file. Must be
 * called before any db.ts function is invoked (getDb() is a lazy singleton
 * that reads process.env.DATABASE_URL on first call — calling this first,
 * synchronously, at module scope guarantees no connection can be opened
 * before the gate has run).
 */
export function assertFinanceIntegrationTestDbSafety(
  input: FinanceTestDbSafetyInput,
): { host: string; database: string } {
  const result = checkFinanceIntegrationTestDbSafety(input);
  if (!result.ok) {
    throw new Error(
      `[finance-integration-test-db-guard] Refusing to run — ${result.reason}. ` +
      `(resolved host=${result.host ?? "?"}, database=${result.database ?? "?"})`,
    );
  }
  return { host: result.host!, database: result.database! };
}
