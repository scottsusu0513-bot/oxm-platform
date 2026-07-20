-- 找消息（News）已讀紀錄（登入會員專用，訪客用 localStorage）。純新增：
--   新表 newsReads (newsId, userId) 唯一索引，NEW 徽章判斷「firstPublishedAt
--   未滿 168 小時 AND 尚未讀過」時要用到。
-- 不修改 0057～0060 已建立的欄位或表，不含任何 DROP／TRUNCATE／DELETE／UPDATE。

CREATE TABLE `newsReads` (
  `id` int AUTO_INCREMENT NOT NULL,
  `newsId` int NOT NULL,
  `userId` int NOT NULL,
  `readAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `newsReads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `newsReads` ADD CONSTRAINT `newsReads_newsId_news_id_fk` FOREIGN KEY (`newsId`) REFERENCES `news`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `newsReads` ADD CONSTRAINT `newsReads_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX `news_read_uq` ON `newsReads` (`newsId`,`userId`);
--> statement-breakpoint
CREATE INDEX `news_read_user_lookup_idx` ON `newsReads` (`userId`,`newsId`);
