-- Phase 2: 工廠審核相關表和欄位

-- 1. 創建工廠審核日誌表
CREATE TABLE IF NOT EXISTS `factory_review_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `action` enum('submitted','resubmitted','approved','rejected') NOT NULL,
  `note` text,
  `rejectReason` text,
  `reviewedBy` int,
  `submitCountSnapshot` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `factory_review_logs_id` PRIMARY KEY(`id`)
);

-- 2. 修改 factories 表，添加審核相關欄位
ALTER TABLE `factories` 
ADD COLUMN IF NOT EXISTS `status` enum('draft','pending','approved','rejected') DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS `submittedAt` timestamp NULL,
ADD COLUMN IF NOT EXISTS `reviewedAt` timestamp NULL,
ADD COLUMN IF NOT EXISTS `reviewedBy` int NULL,
ADD COLUMN IF NOT EXISTS `reviewNote` text NULL,
ADD COLUMN IF NOT EXISTS `rejectReason` text NULL,
ADD COLUMN IF NOT EXISTS `submitCount` int DEFAULT 0;

-- 3. 記錄遷移
INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ('0007_keen_meltdown', NOW());
