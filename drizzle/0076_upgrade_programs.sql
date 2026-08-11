-- 政府補助專區「公開方案目錄」。
-- 只新增獨立方案表，不修改 upgradeApplications、upgradeConsultants、案件狀態、
-- 顧問分派或任何送件資料。既有五項資料由 server 啟動時的冪等 seed 建立，
-- 唯一來源為 shared/upgradePrograms.ts，避免 SQL 與應用程式各維護一份文案。
--
-- 本 migration 本輪只建立檔案，不應在未取得正式資料庫操作授權前執行。

CREATE TABLE `upgradePrograms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(100) NOT NULL,
  `title` varchar(200) NOT NULL,
  `shortTitle` varchar(100),
  `description` text NOT NULL,
  `targetAudience` text,
  `highlights` json NOT NULL,
  `badge` varchar(80),
  `statusLabel` varchar(100),
  `visualKey` varchar(50) NOT NULL DEFAULT 'funding',
  `maxFundingLabel` varchar(100),
  `imageUrl` text,
  `ctaLabel` varchar(80) NOT NULL DEFAULT '免費評估資格',
  `displayOrder` int NOT NULL DEFAULT 0,
  `enabled` boolean NOT NULL DEFAULT true,
  `archivedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `upgradePrograms_id` PRIMARY KEY (`id`),
  CONSTRAINT `upgradePrograms_slug_unique` UNIQUE (`slug`),
  INDEX `up_public_list_idx` (`enabled`, `archivedAt`, `displayOrder`)
);
