-- 找消息（News）跨產業資訊看板（純新增）：
--   news 表新增 isCrossIndustry 布林欄位，跟既有 isImportant／isCompetition／
--   isExhibition 同一層級，預設 false，not null，additive、可重跑安全（IF NOT
--   EXISTS 語意由 drizzle-kit 產生的 journal 保證只套用一次，這裡另外用
--   ALTER TABLE ADD COLUMN，MySQL 8 不支援 ADD COLUMN IF NOT EXISTS，故靠
--   0061/0062 同樣的「先確認未套用過才執行」流程手動把關，不在 SQL 本身加
--   條件判斷）。
-- 不修改 0057～0062 已建立的欄位或表，不含任何 DROP／TRUNCATE／DELETE／UPDATE。

ALTER TABLE `news` ADD COLUMN `isCrossIndustry` boolean NOT NULL DEFAULT false;
