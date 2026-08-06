-- ISO 與低碳認證專區：動態分類／服務項目目錄。
-- 與既有徽章系統（factories.certificationBadges 等）完全獨立的新資料表，
-- 不修改、不刪除任何既有徽章欄位或資料。schema-only：不含任何 INSERT，
-- 九項初始資料由 server/db.ts 的 ensureCertificationServiceCatalogSeeded()
-- 在啟動時以「先查詢、不存在才插入」的方式冪等寫入，避免 migration 重複
-- 執行時重複插入。
CREATE TABLE `certificationServiceCategories` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `certificationServiceCategories_id` PRIMARY KEY(`id`),
  CONSTRAINT `certificationServiceCategories_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `certificationServiceItems` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(50) NOT NULL,
  `badgeCode` varchar(50),
  `categoryId` int NOT NULL,
  `name` varchar(200) NOT NULL,
  `type` varchar(50) NOT NULL,
  `shortDescription` text NOT NULL,
  `applicableNeeds` json NOT NULL,
  `applicableIndustries` json NOT NULL,
  `versionNote` varchar(300),
  `iconKey` varchar(100),
  `serviceEnabled` boolean NOT NULL DEFAULT true,
  `consultEnabled` boolean NOT NULL DEFAULT true,
  `status` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `certificationServiceItems_id` PRIMARY KEY(`id`),
  CONSTRAINT `certificationServiceItems_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `certificationServiceItems`
  ADD CONSTRAINT `certificationServiceItems_categoryId_fk`
  FOREIGN KEY (`categoryId`) REFERENCES `certificationServiceCategories`(`id`);
--> statement-breakpoint
CREATE INDEX `csi_category_idx` ON `certificationServiceItems` (`categoryId`, `status`, `sortOrder`);
--> statement-breakpoint
CREATE INDEX `csi_status_idx` ON `certificationServiceItems` (`status`, `serviceEnabled`);
