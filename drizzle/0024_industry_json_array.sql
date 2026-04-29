-- 0024: Convert factories.industry from varchar(50) to JSON string[]
-- 例："金屬加工" → ["金屬加工"]，空字串 / NULL → []
--
-- 執行順序：
-- 1. 先備份資料庫（見 Render 操作指引）
-- 2. 執行本檔案中的每個區塊，每區塊執行後確認輸出正確再繼續

-- ══════════════════════════════════════════
-- STEP 1：新增暫存 JSON 欄位（安全，可重複執行）
-- ══════════════════════════════════════════
ALTER TABLE factories ADD COLUMN industry_new JSON;

-- ══════════════════════════════════════════
-- STEP 2：資料轉換
-- NULL 或空字串 → []，其餘字串 → ["原本的值"]
-- ══════════════════════════════════════════
UPDATE factories SET industry_new = CASE
  WHEN industry IS NULL OR industry = '' THEN JSON_ARRAY()
  ELSE JSON_ARRAY(industry)
END;

-- ══════════════════════════════════════════
-- STEP 3：驗證（執行後應該顯示 should_be_zero = 0）
-- 如果不是 0，禁止繼續執行
-- ══════════════════════════════════════════
SELECT COUNT(*) AS should_be_zero FROM factories WHERE industry_new IS NULL;

-- ══════════════════════════════════════════
-- STEP 4：隨機抽查轉換結果是否正確
-- ══════════════════════════════════════════
SELECT id, industry AS old_value, industry_new AS new_value FROM factories LIMIT 20;

-- ══════════════════════════════════════════
-- STEP 5：確認無誤後，刪除舊欄位（不可逆）
-- ══════════════════════════════════════════
ALTER TABLE factories DROP COLUMN industry;

-- ══════════════════════════════════════════
-- STEP 6：重命名新欄位，並加上 NOT NULL 約束
-- ══════════════════════════════════════════
ALTER TABLE factories CHANGE COLUMN industry_new industry JSON NOT NULL;

-- ══════════════════════════════════════════
-- STEP 7：最終驗證
-- ══════════════════════════════════════════
SELECT id, name, industry FROM factories LIMIT 20;
