/**
 * 一次性腳本：查詢並刪除測試用企業升級申請表單
 * 執行：node _delete_test_upgrade_application.cjs
 *
 * 執行流程：
 *  1. SELECT 符合條件的測試資料
 *  2. 列印查詢結果讓人工確認
 *  3. 確認後執行 DELETE
 *  4. 再次 SELECT 確認已刪除
 */

require("dotenv/config");
const mysql = require("mysql2/promise");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set in environment");
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    // ── Step 1: SELECT 測試資料 ────────────────────────────────────────────
    console.log("\n=== Step 1: 查詢疑似測試資料 ===");
    const [rows] = await conn.execute(
      `SELECT id, companyName, email, phone, status, createdAt
       FROM upgradeApplications
       WHERE companyName = 'TEST'
          OR email = 'scottsusu@oxmmatch.com'
          OR phone = '0202020202'
       ORDER BY id`
    );

    if (!rows.length) {
      console.log("✅ 未找到符合條件的測試資料，無需刪除。");
      return;
    }

    console.log(`找到 ${rows.length} 筆：`);
    rows.forEach((r) => {
      console.log(
        `  id=${r.id} | companyName=${r.companyName} | email=${r.email} | phone=${r.phone} | status=${r.status} | createdAt=${r.createdAt}`
      );
    });

    // ── Step 2: 確認只刪除明確測試資料 ────────────────────────────────────
    const ids = rows.map((r) => r.id);
    console.log(`\n=== Step 2: 準備刪除 id IN (${ids.join(", ")}) ===`);

    // ── Step 3: DELETE ─────────────────────────────────────────────────────
    const [delResult] = await conn.execute(
      `DELETE FROM upgradeApplications WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    console.log(`\n=== Step 3: 刪除完成，受影響列數：${delResult.affectedRows} ===`);

    // ── Step 4: 再次 SELECT 確認不存在 ────────────────────────────────────
    console.log("\n=== Step 4: 再次查詢確認已刪除 ===");
    const [verify] = await conn.execute(
      `SELECT id FROM upgradeApplications WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    if (!verify.length) {
      console.log("✅ 確認：資料庫中已無這些 id，刪除成功。");
    } else {
      console.error("❌ 警告：仍有剩餘資料！ids:", verify.map((r) => r.id));
    }

    // ── Step 5: 查詢刪除後的平台數據（目前欄位有限，pending migration 才有 factoryId/subsidyAmount）
    console.log("\n=== Step 5: 刪除後平台數據預覽（現有欄位）===");
    const [[stats]] = await conn.execute(
      `SELECT
         COUNT(*) AS totalApplications,
         SUM(CASE WHEN status IN ('accepted','submitted','rejected','approved','transforming','completed') THEN 1 ELSE 0 END) AS approvedCases,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedCases
       FROM upgradeApplications`
    );
    console.log(
      `  總申請數: ${stats.totalApplications} 件\n` +
      `  有過件: ${stats.approvedCases} 件\n` +
      `  已結案: ${stats.completedCases} 件`
    );
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("執行失敗：", e.message);
  process.exit(1);
});
