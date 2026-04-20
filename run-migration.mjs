import mysql from 'mysql2/promise';

const pool = await mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 1,
});

try {
  const conn = await pool.getConnection();
  await conn.execute("ALTER TABLE `factories` ADD `rejectionreason` text");
  await conn.execute("ALTER TABLE `factories` DROP COLUMN `rejectionReason`");
  console.log("Migration completed successfully");
  conn.release();
} catch (error) {
  console.error("Migration error:", error.message);
}

await pool.end();
