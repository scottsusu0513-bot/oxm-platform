-- 短影音與品牌內容行銷專區：顧問設定與申請案件。與 financeConsultants／
-- financeApplications、upgradeConsultants／upgradeApplications 完全獨立的
-- 資料表，不共用資料或狀態機。本檔案僅套用至本機 oxm 與 oxm_test，未套用
-- 至任何正式（production）資料庫。

CREATE TABLE `shortVideoConsultants` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(100) NOT NULL,
  `userId` int,
  `serviceAreas` json NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `shortVideoConsultants_id` PRIMARY KEY(`id`),
  CONSTRAINT `svc_user_id_uq` UNIQUE(`userId`)
);

CREATE TABLE `shortVideoCases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `companyNameSnapshot` varchar(200) NOT NULL,
  `companyAddressSnapshot` varchar(500) NOT NULL,
  `contactName` varchar(100) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `contactTime` varchar(100) NOT NULL,
  `servicesWanted` json NOT NULL,
  `isUnsure` boolean NOT NULL DEFAULT false,
  `primaryGoal` varchar(30) NOT NULL,
  `platforms` json NOT NULL,
  `noPlatformYet` boolean NOT NULL DEFAULT false,
  `additionalNotes` varchar(2000),
  `consentAgreed` boolean NOT NULL DEFAULT true,
  `status` enum('new','evaluating','proposal','in_progress','completed','deferred','no_interest','archived','unassigned') NOT NULL DEFAULT 'new',
  `assignedConsultantId` int,
  `notes` text,
  `statusTimeline` json,
  `lastUpdatedByUserId` int,
  `lastUpdatedByNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  `openFactoryId` int GENERATED ALWAYS AS (CASE WHEN `status` IN ('new','evaluating','proposal','in_progress','deferred','unassigned') THEN `factoryId` ELSE NULL END) VIRTUAL,
  CONSTRAINT `shortVideoCases_id` PRIMARY KEY(`id`),
  CONSTRAINT `svcase_open_factory_uq` UNIQUE(`openFactoryId`)
);

CREATE INDEX `svcase_status_created_idx` ON `shortVideoCases` (`status`, `createdAt`);
CREATE INDEX `svcase_consultant_idx` ON `shortVideoCases` (`assignedConsultantId`, `status`, `createdAt`);
CREATE INDEX `svcase_factory_idx` ON `shortVideoCases` (`factoryId`);
CREATE INDEX `svcase_last_updater_idx` ON `shortVideoCases` (`lastUpdatedByUserId`);

ALTER TABLE `shortVideoConsultants` ADD CONSTRAINT `shortVideoConsultants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
ALTER TABLE `shortVideoCases` ADD CONSTRAINT `shortVideoCases_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE;
ALTER TABLE `shortVideoCases` ADD CONSTRAINT `shortVideoCases_assignedConsultantId_shortVideoConsultants_id_fk` FOREIGN KEY (`assignedConsultantId`) REFERENCES `shortVideoConsultants`(`id`) ON DELETE SET NULL;
ALTER TABLE `shortVideoCases` ADD CONSTRAINT `shortVideoCases_lastUpdatedByUserId_users_id_fk` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
