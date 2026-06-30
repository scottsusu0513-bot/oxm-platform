-- Phase 3B：合作確認單接受身分欄位
-- 舊資料不回填；查詢時 acceptedAsType IS NULL 視同 'user'

ALTER TABLE `collaborationOrders`
  ADD COLUMN `acceptedAsType` enum('user','factory') NULL,
  ADD COLUMN `acceptedAsFactoryId` int NULL,
  ADD COLUMN `acceptedByUserId` int NULL;
