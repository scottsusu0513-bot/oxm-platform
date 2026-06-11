/**
 * Test DB guard: ensures integration tests never run against a production database.
 *
 * Priority:
 *   1. TEST_DATABASE_URL  — always used if set
 *   2. DATABASE_URL       — only if host is localhost / 127.0.0.1
 *   3. Any other host     — rejected with a clear error (no credentials printed)
 *
 * The resolved URL is written back to process.env.DATABASE_URL so getDb() picks it up.
 * Call this module via vitest setupFiles before any test file imports the DB.
 */
import { config } from "dotenv";

config(); // load .env (no-op if already loaded)

const testUrl = process.env.TEST_DATABASE_URL;
const fallbackUrl = process.env.DATABASE_URL;

function isSafeHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function resolveTestDbUrl(): string {
  if (testUrl) {
    process.env.DATABASE_URL = testUrl;
    return testUrl;
  }

  if (!fallbackUrl) {
    throw new Error(
      "[test-db-guard] No DATABASE_URL or TEST_DATABASE_URL found. " +
      "Set TEST_DATABASE_URL to run integration tests.",
    );
  }

  if (!isSafeHost(fallbackUrl)) {
    // Do NOT print the URL — it contains credentials
    throw new Error(
      "[test-db-guard] DATABASE_URL points to a non-localhost host. " +
      "Set TEST_DATABASE_URL to a dedicated test database to run integration tests. " +
      "Running tests against a remote/production database is blocked.",
    );
  }

  // Localhost fallback is safe
  return fallbackUrl;
}

resolveTestDbUrl();
