-- 找消息（產業情報／News）——獨立於 announcements／loginPopups 的新資料表。
-- 純新增（CREATE TABLE／ADD CONSTRAINT／CREATE INDEX），不含任何 DROP、
-- TRUNCATE、DELETE 或既有資料表的 UPDATE。

CREATE TABLE `news` (
  `id` int AUTO_INCREMENT NOT NULL,
  `slug` varchar(200) NOT NULL,
  `title` varchar(200) NOT NULL,
  `summary` varchar(500) NOT NULL,
  `content` text NOT NULL,
  `status` enum('draft','published','withdrawn') NOT NULL DEFAULT 'draft',
  `isImportant` boolean NOT NULL DEFAULT false,
  `isCompetition` boolean NOT NULL DEFAULT false,
  `isExhibition` boolean NOT NULL DEFAULT false,
  `publishedAt` timestamp NULL,
  `firstPublishedAt` timestamp NULL,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `news_id` PRIMARY KEY(`id`),
  CONSTRAINT `news_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `newsIndustries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `newsId` int NOT NULL,
  `industryName` varchar(50) NOT NULL,
  CONSTRAINT `newsIndustries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newsNotifications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `newsId` int NOT NULL,
  `userId` int NOT NULL,
  `channel` enum('email','push') NOT NULL,
  `status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
  `error` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `sentAt` timestamp NULL,
  CONSTRAINT `newsNotifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `news` ADD CONSTRAINT `news_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `newsIndustries` ADD CONSTRAINT `newsIndustries_newsId_news_id_fk` FOREIGN KEY (`newsId`) REFERENCES `news`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `newsNotifications` ADD CONSTRAINT `newsNotifications_newsId_news_id_fk` FOREIGN KEY (`newsId`) REFERENCES `news`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `newsNotifications` ADD CONSTRAINT `newsNotifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `news_status_published_idx` ON `news` (`status`,`publishedAt`);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_industry_uq` ON `newsIndustries` (`newsId`,`industryName`);
--> statement-breakpoint
CREATE INDEX `news_industry_lookup_idx` ON `newsIndustries` (`industryName`);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_notif_uq` ON `newsNotifications` (`newsId`,`userId`,`channel`);
--> statement-breakpoint
CREATE INDEX `news_notif_status_idx` ON `newsNotifications` (`status`);
