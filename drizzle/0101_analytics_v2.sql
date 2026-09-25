-- Analytics 2.0（見對話中「OXM Analytics 2.0」）——新增 3 張表，純 CREATE
-- TABLE，不 ALTER／不 DROP／不動任何既有表或既有資料。舊 `pageViews` 表
-- 完全保留、繼續運作，不受影響。
--
-- 這支 migration 是手寫的，不是用 `drizzle-kit generate` 自動產生——本機
-- 開發用的 local MySQL（`oxm`）目前的實際 schema 跟 production 不同步
-- （production 的完整歷史是透過另一個流程逐步套用的），對 local DB 跑
-- `drizzle-kit generate` 會被誤判成「幾乎所有既有表都不存在」，產生一份
-- 會嘗試重建整個 schema（含幾十張 production 已經存在的表）的危險
-- migration 檔案——已確認並丟棄，不使用那份自動產生的檔案，改成這支只含
-- 3 張新表、手動核對過欄位定義與 drizzle/schema.ts 完全一致的乾淨版本。
--
-- 套用前提醒：本檔案本輪只產生，未對 production 執行。套用時機與方式
-- （`pnpm db:push` 或人工在 Railway MySQL 執行）待使用者確認後再進行。

CREATE TABLE `analyticsSessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sessionKey` varchar(36) NOT NULL,
  `visitorId` varchar(64) NOT NULL,
  `ipHash` varchar(64),
  `ipPrefix` varchar(50),
  `userAgent` varchar(500),
  `deviceType` varchar(10),
  `browser` varchar(20),
  `os` varchar(20),
  `platform` varchar(15),
  `referrer` text,
  `referrerHost` varchar(255),
  `utmSource` varchar(255),
  `utmMedium` varchar(255),
  `utmCampaign` varchar(255),
  `utmContent` varchar(255),
  `utmTerm` varchar(255),
  `sourceClassification` varchar(20),
  `classification` varchar(15) NOT NULL DEFAULT 'human',
  `knownBotName` varchar(50),
  `suspiciousScore` int NOT NULL DEFAULT 0,
  `suspiciousSignals` json,
  `eventCount` int NOT NULL DEFAULT 0,
  `startedAt` timestamp NOT NULL DEFAULT (now()),
  `lastEventAt` timestamp NOT NULL DEFAULT (now()),
  `date` varchar(10) NOT NULL,
  CONSTRAINT `analyticsSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `analytics_sessions_date_idx` ON `analyticsSessions` (`date`);
--> statement-breakpoint
CREATE INDEX `analytics_sessions_visitor_idx` ON `analyticsSessions` (`visitorId`);
--> statement-breakpoint
CREATE INDEX `analytics_sessions_ip_started_idx` ON `analyticsSessions` (`ipHash`, `startedAt`);
--> statement-breakpoint
CREATE INDEX `analytics_sessions_classification_date_idx` ON `analyticsSessions` (`classification`, `date`);
--> statement-breakpoint

CREATE TABLE `analyticsEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sessionRowId` int NOT NULL,
  `visitorId` varchar(64) NOT NULL,
  `eventType` varchar(15) NOT NULL,
  `pathname` varchar(500),
  `queryString` varchar(1000),
  `pageType` varchar(20),
  `factoryId` int,
  `isLandingPage` boolean NOT NULL DEFAULT false,
  `prevPathname` varchar(500),
  `keyword` varchar(200),
  `keywordNormalized` varchar(200),
  `filtersJson` json,
  `useAIMode` boolean,
  `resultCount` int,
  `classification` varchar(15) NOT NULL,
  `date` varchar(10) NOT NULL,
  `hour` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `analyticsEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `analyticsEvents_sessionRowId_fk` FOREIGN KEY (`sessionRowId`) REFERENCES `analyticsSessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `analytics_events_date_hour_idx` ON `analyticsEvents` (`date`, `hour`);
--> statement-breakpoint
CREATE INDEX `analytics_events_type_date_idx` ON `analyticsEvents` (`eventType`, `date`);
--> statement-breakpoint
CREATE INDEX `analytics_events_session_idx` ON `analyticsEvents` (`sessionRowId`);
--> statement-breakpoint
CREATE INDEX `analytics_events_visitor_date_idx` ON `analyticsEvents` (`visitorId`, `date`);
--> statement-breakpoint
CREATE INDEX `analytics_events_factory_date_idx` ON `analyticsEvents` (`factoryId`, `date`);
--> statement-breakpoint
CREATE INDEX `analytics_events_keyword_date_idx` ON `analyticsEvents` (`keywordNormalized`, `date`);
--> statement-breakpoint

CREATE TABLE `analyticsSecurityEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `eventType` varchar(40) NOT NULL,
  `severity` varchar(10) NOT NULL,
  `ipHash` varchar(64),
  `asn` varchar(20),
  `visitorId` varchar(64),
  `sessionRowId` int,
  `userAgent` varchar(500),
  `path` varchar(500),
  `signals` json,
  `suspiciousScore` int,
  `actionTaken` varchar(30),
  `date` varchar(10) NOT NULL,
  `hour` int NOT NULL,
  `detectedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `analyticsSecurityEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `analytics_security_date_hour_idx` ON `analyticsSecurityEvents` (`date`, `hour`);
--> statement-breakpoint
CREATE INDEX `analytics_security_event_type_idx` ON `analyticsSecurityEvents` (`eventType`);
--> statement-breakpoint
CREATE INDEX `analytics_security_ip_hash_idx` ON `analyticsSecurityEvents` (`ipHash`);
