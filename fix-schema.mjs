import mysql from 'mysql2/promise';

const pool = await mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 1,
});

try {
  const conn = await pool.getConnection();
  
  // 首先檢查 rejectionReason 欄位是否存在
  const [check] = await conn.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='factories' AND (COLUMN_NAME='rejectionReason' OR COLUMN_NAME='rejectionreason')");
  
  if (check.length > 0) {
    const fieldName = check[0].COLUMN_NAME;
    console.log(`Found field: ${fieldName}`);
    
    if (fieldName === 'rejectionReason') {
      // 需要重命名
      console.log("Renaming rejectionReason to rejectionreason...");
      await conn.execute("ALTER TABLE `factories` CHANGE COLUMN `rejectionReason` `rejectionreason` text");
      console.log("Renamed successfully");
    } else {
      console.log("Field already named correctly");
    }
  } else {
    console.log("No rejection field found, adding rejectionreason...");
    await conn.execute("ALTER TABLE `factories` ADD COLUMN `rejectionreason` text");
    console.log("Added successfully");
  }
  
  conn.release();
} catch (error) {
  console.error("Error:", error.message);
}

await pool.end();
