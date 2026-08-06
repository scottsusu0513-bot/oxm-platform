-- ISO 與低碳認證專區 + ERP 與產線優化專區：顧問設定與申請案件。與
-- financeConsultants／shortVideoConsultants 等完全獨立的資料表，不共用資料
-- 或狀態機。本檔案僅套用至本機 oxm 與 oxm_test，未套用至任何正式
-- （production）資料庫。

CREATE TABLE `certificationConsultants` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(100) NOT NULL,
  `userId` int,
  `serviceAreas` json NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `certificationConsultants_id` PRIMARY KEY(`id`),
  CONSTRAINT `cc_user_id_uq` UNIQUE(`userId`)
);

CREATE TABLE `certificationCases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `companyNameSnapshot` varchar(200) NOT NULL,
  `companyAddressSnapshot` varchar(500) NOT NULL,
  `contactName` varchar(100) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `contactTime` varchar(100) NOT NULL,
  `servicesWanted` json NOT NULL,
  `isUnsure` boolean NOT NULL DEFAULT false,
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
  CONSTRAINT `certificationCases_id` PRIMARY KEY(`id`),
  CONSTRAINT `ccase_open_factory_uq` UNIQUE(`openFactoryId`)
);

CREATE INDEX `ccase_status_created_idx` ON `certificationCases` (`status`, `createdAt`);
CREATE INDEX `ccase_consultant_idx` ON `certificationCases` (`assignedConsultantId`, `status`, `createdAt`);
CREATE INDEX `ccase_factory_idx` ON `certificationCases` (`factoryId`);
CREATE INDEX `ccase_last_updater_idx` ON `certificationCases` (`lastUpdatedByUserId`);

ALTER TABLE `certificationConsultants` ADD CONSTRAINT `certificationConsultants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
ALTER TABLE `certificationCases` ADD CONSTRAINT `certificationCases_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE;
ALTER TABLE `certificationCases` ADD CONSTRAINT `certificationCases_assignedConsultantId_fk` FOREIGN KEY (`assignedConsultantId`) REFERENCES `certificationConsultants`(`id`) ON DELETE SET NULL;
ALTER TABLE `certificationCases` ADD CONSTRAINT `certificationCases_lastUpdatedByUserId_users_id_fk` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

CREATE TABLE `erpConsultants` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(100) NOT NULL,
  `userId` int,
  `serviceAreas` json NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `erpConsultants_id` PRIMARY KEY(`id`),
  CONSTRAINT `ec_user_id_uq` UNIQUE(`userId`)
);

CREATE TABLE `erpCases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `companyNameSnapshot` varchar(200) NOT NULL,
  `companyAddressSnapshot` varchar(500) NOT NULL,
  `contactName` varchar(100) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `contactTime` varchar(100) NOT NULL,
  `needType` enum('erp_adoption','line_optimization','integrated','unsure') NOT NULL,
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
  CONSTRAINT `erpCases_id` PRIMARY KEY(`id`),
  CONSTRAINT `ecase_open_factory_uq` UNIQUE(`openFactoryId`)
);

CREATE INDEX `ecase_status_created_idx` ON `erpCases` (`status`, `createdAt`);
CREATE INDEX `ecase_consultant_idx` ON `erpCases` (`assignedConsultantId`, `status`, `createdAt`);
CREATE INDEX `ecase_factory_idx` ON `erpCases` (`factoryId`);
CREATE INDEX `ecase_last_updater_idx` ON `erpCases` (`lastUpdatedByUserId`);

ALTER TABLE `erpConsultants` ADD CONSTRAINT `erpConsultants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
ALTER TABLE `erpCases` ADD CONSTRAINT `erpCases_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE;
ALTER TABLE `erpCases` ADD CONSTRAINT `erpCases_assignedConsultantId_erpConsultants_id_fk` FOREIGN KEY (`assignedConsultantId`) REFERENCES `erpConsultants`(`id`) ON DELETE SET NULL;
ALTER TABLE `erpCases` ADD CONSTRAINT `erpCases_lastUpdatedByUserId_users_id_fk` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
