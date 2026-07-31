-- ===== 企業財務優化專區：顧問設定 + 申請案件 =====
-- 與企業升級中心（upgradeConsultants / upgradeApplications）完全獨立的資料模型，
-- 不共用流程與狀態機。顧問授權完全由「financeConsultants 是否有一筆該 userId 的
-- 有效紀錄」決定，不使用固定 email／userId／前端條件；既有 upgradeConsultants
-- 資料不受影響，不會因本次 migration 意外取得財務案件權限。
-- 上線前由管理員手動執行，不可在 production 自動執行。

CREATE TABLE `financeConsultants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `userId` int,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_financeConsultants_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
-- UNIQUE 而非一般 index：避免同一 userId 被重複綁定到多筆顧問紀錄（會讓「系統
-- 只有一位啟用中顧問時自動指派」的判斷失準）。MySQL UNIQUE INDEX 允許多筆
-- NULL，尚未綁定的顧問列可以同時存在，不受此限制。
CREATE UNIQUE INDEX `fc_user_id_uq` ON `financeConsultants` (`userId`);
--> statement-breakpoint

-- financeApplications.openFactoryId：VIRTUAL generated column，等於 factoryId 時
-- status 屬於未結案狀態（new/evaluating/deferred），否則為 NULL。搭配 UNIQUE INDEX，
-- MySQL 對 NULL 值免除唯一性約束，因此可靠地在 DB 層保證「同一工廠最多一筆未結案
-- 財務案件」，且不影響已結案（not_interested/won）的歷史案件與後續重新申請。
CREATE TABLE `financeApplications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factoryId` int NOT NULL,
  `companyNameSnapshot` varchar(200) NOT NULL,
  `companyAddressSnapshot` varchar(500) NOT NULL,
  `contactName` varchar(100) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `contactTime` varchar(100) NOT NULL,
  `consentAgreed` boolean NOT NULL DEFAULT true,
  `status` enum('new','evaluating','deferred','not_interested','won') NOT NULL DEFAULT 'new',
  `assignedConsultantId` int,
  `notes` text,
  `statusTimeline` json,
  `lastUpdatedByUserId` int,
  `lastUpdatedByNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  `openFactoryId` int GENERATED ALWAYS AS (CASE WHEN `status` IN ('new','evaluating','deferred') THEN `factoryId` ELSE NULL END) VIRTUAL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_financeApplications_factory` FOREIGN KEY (`factoryId`) REFERENCES `factories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_financeApplications_consultant` FOREIGN KEY (`assignedConsultantId`) REFERENCES `financeConsultants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financeApplications_lastUpdatedBy` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fa_open_factory_uq` ON `financeApplications` (`openFactoryId`);
--> statement-breakpoint
CREATE INDEX `fa_status_created_idx` ON `financeApplications` (`status`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `fa_consultant_idx` ON `financeApplications` (`assignedConsultantId`, `status`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `fa_factory_idx` ON `financeApplications` (`factoryId`);
--> statement-breakpoint
CREATE INDEX `fa_last_updater_idx` ON `financeApplications` (`lastUpdatedByUserId`);
