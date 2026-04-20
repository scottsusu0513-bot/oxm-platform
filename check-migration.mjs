import mysql from 'mysql2/promise';

const pool = await mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 1,
});

try {
  const conn = await pool.getConnection();
  
  // 檢查欄位是否存在
  const [result1] = await conn.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='factories' AND COLUMN_NAME='rejectionReason'");
  console.log("rejectionReason exists:", result1.length > 0);
  
  const [result2] = await conn.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='factories' AND COLUMN_NAME='rejectionreason'");
  console.log("rejectionreason exists:", result2.length > 0);
  
  conn.release();
} catch (error) {
  console.error("Error:", error.message);
}

await pool.end();
