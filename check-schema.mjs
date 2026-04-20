import mysql from 'mysql2/promise';

const pool = await mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 1,
});

try {
  const conn = await pool.getConnection();
  const [columns] = await conn.execute("DESCRIBE `factories`");
  console.log("Factories table columns:");
  columns.forEach(col => {
    console.log(`  ${col.Field}: ${col.Type}`);
  });
  conn.release();
} catch (error) {
  console.error("Error:", error.message);
}

await pool.end();
