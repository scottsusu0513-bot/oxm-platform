/**
 * CI only: build the current schema in an EMPTY, throwaway `oxm_test` MySQL
 * (GitHub Actions service container) and run the app's own boot-time seeds.
 *
 * Why not `pnpm db:push` / `drizzle-kit push`:
 *   - `db:push` runs `drizzle-kit migrate`, whose journal stops at 0028; later
 *     migrations were applied by hand, so it builds an outdated schema.
 *   - `drizzle-kit push` derives FK constraint names from table+column names;
 *     8 of them exceed MySQL's 64-character identifier limit, MySQL rejects
 *     them, and the remaining foreign keys (incl. ON DELETE CASCADE that tests
 *     rely on) are never created. Production's hand-written migrations use
 *     shorter names.
 *
 * So: take `drizzle-kit export` (DDL generated from drizzle/schema.ts, no DB
 * connection), shorten only over-long constraint names deterministically,
 * apply it, verify every table and foreign key exists, then run the same
 * idempotent seed functions the server runs at boot (server/_core/index.ts),
 * except consultant seeds (see main()).
 *
 * Refuses to run unless NODE_ENV=test and DATABASE_URL is 127.0.0.1/oxm_test.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

const MAX_IDENTIFIER = 64;

function assertCiTestDatabase(): string {
  const raw = process.env.DATABASE_URL ?? "";
  let url: URL | null = null;
  try { url = new URL(raw); } catch { url = null; }
  if (process.env.NODE_ENV !== "test" || !url || url.hostname !== "127.0.0.1" || url.pathname !== "/oxm_test") {
    throw new Error("Refusing: requires NODE_ENV=test and DATABASE_URL pointing at 127.0.0.1/oxm_test");
  }
  return raw;
}

function shortenIdentifier(name: string): string {
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_IDENTIFIER - hash.length - 1)}_${hash}`;
}

function exportSchemaDdl(): string {
  const out = execFileSync("pnpm", ["exec", "drizzle-kit", "export"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf("CREATE TABLE");
  if (start < 0) throw new Error("drizzle-kit export produced no CREATE TABLE statements");
  return out.slice(start);
}

async function main() {
  const databaseUrl = assertCiTestDatabase();

  let ddl = exportSchemaDdl();
  const expectedTables = (ddl.match(/^CREATE TABLE /gm) ?? []).length;
  const expectedForeignKeys = (ddl.match(/ FOREIGN KEY /g) ?? []).length;
  let renamed = 0;
  ddl = ddl.replace(/ADD CONSTRAINT `([^`]+)`/g, (whole, name: string) => {
    if (name.length <= MAX_IDENTIFIER) return whole;
    renamed++;
    return `ADD CONSTRAINT \`${shortenIdentifier(name)}\``;
  });

  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    const [[{ n: existing }]] = (await conn.query(
      "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    )) as unknown as [{ n: number }[]];
    if (Number(existing) !== 0) throw new Error(`Refusing: oxm_test is not empty (${existing} tables)`);

    await conn.query(ddl);

    const [[{ tables }]] = (await conn.query(
      "SELECT COUNT(*) tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    )) as unknown as [{ tables: number }[]];
    const [[{ fks }]] = (await conn.query(
      "SELECT COUNT(*) fks FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()",
    )) as unknown as [{ fks: number }[]];
    console.log(`schema: tables ${tables}/${expectedTables}, foreign keys ${fks}/${expectedForeignKeys}, shortened constraint names: ${renamed}`);
    if (Number(tables) !== expectedTables || Number(fks) !== expectedForeignKeys) {
      throw new Error("schema verification failed: table or foreign key count mismatch");
    }
  } finally {
    await conn.end();
  }

  // Same idempotent seeds the server runs on boot (server/_core/index.ts).
  const db = await import("../../server/db");
  const { ensureUpgradeProgramsSeeded } = await import("../../server/upgradePrograms");
  await db.ensureConsultantsSeeded();
  await db.ensureCertificationServiceCatalogSeeded();
  await ensureUpgradeProgramsSeeded();
  await db.closeDbPools();
  console.log("boot seeds applied");
}

main().catch((err) => {
  console.error("[bootstrap-test-db]", err instanceof Error ? err.message : err);
  process.exit(1);
});
