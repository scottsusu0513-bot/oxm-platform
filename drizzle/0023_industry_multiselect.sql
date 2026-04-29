-- 0023: 重構產業欄位
-- industry (varchar) → industryMain (JSON string[])
-- subIndustry (JSON string[]) → industrySub (JSON string[])
-- 新增 capabilities (JSON string[])
-- 舊「塑膠 / 橡膠」自動轉換為 industryMain = ["塑膠", "橡膠 / 矽膠"]

-- Step 1: 建立 industryMain，從舊 industry varchar 遷移資料
ALTER TABLE factories ADD COLUMN industryMain JSON;
UPDATE factories
SET industryMain = CASE
  WHEN industry = '塑膠 / 橡膠' THEN JSON_ARRAY('塑膠', '橡膠 / 矽膠')
  WHEN industry IS NOT NULL AND industry != '' THEN JSON_ARRAY(industry)
  ELSE JSON_ARRAY()
END;
ALTER TABLE factories MODIFY COLUMN industryMain JSON NOT NULL;
ALTER TABLE factories DROP COLUMN industry;

-- Step 2: 建立 industrySub，從舊 subIndustry 遷移資料
ALTER TABLE factories ADD COLUMN industrySub JSON;
UPDATE factories SET industrySub = COALESCE(subIndustry, JSON_ARRAY());
ALTER TABLE factories MODIFY COLUMN industrySub JSON NOT NULL DEFAULT (JSON_ARRAY());
ALTER TABLE factories DROP COLUMN subIndustry;

-- Step 3: 新增 capabilities 欄位（預設空陣列）
ALTER TABLE factories ADD COLUMN capabilities JSON NOT NULL DEFAULT (JSON_ARRAY());
