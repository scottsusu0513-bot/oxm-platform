-- 找消息（News）封面圖片與 PDF 附件（含下載期限／自動清理欄位）。純新增：
--   1. news 表新增三個選填欄位（封面圖片）
--   2. 新表 newsAttachments（PDF 附件 metadata，最多 5 份／篇，由 server 端限制，
--      含下載期限與自動清理排程所需欄位）
-- 不修改 0057／0058 已建立的欄位或表，不含任何 DROP／TRUNCATE／DELETE／UPDATE。
-- 尚未對正式環境執行過，這份檔案本身就是全新正式環境要一次建立的完整結構。

ALTER TABLE `news` ADD COLUMN `coverImageKey` varchar(300);
--> statement-breakpoint
ALTER TABLE `news` ADD COLUMN `coverImageUrl` varchar(1000);
--> statement-breakpoint
ALTER TABLE `news` ADD COLUMN `coverImageAlt` varchar(200);
--> statement-breakpoint
CREATE TABLE `newsAttachments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `newsId` int NOT NULL,
  `displayName` varchar(200) NOT NULL,
  `originalFileName` varchar(200) NOT NULL,
  `storageKey` varchar(300) NOT NULL,
  `mimeType` varchar(100) NOT NULL,
  `sizeBytes` int NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `uploadedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `expirationType` enum('after_publish_30d','custom','never') NOT NULL DEFAULT 'after_publish_30d',
  `downloadExpiresAt` timestamp NULL,
  `storageDeletedAt` timestamp NULL,
  `deleteAttempts` int NOT NULL DEFAULT 0,
  `lastDeleteAttemptAt` timestamp NULL,
  `deleteFailureReason` varchar(300),
  CONSTRAINT `newsAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `newsAttachments` ADD CONSTRAINT `newsAttachments_newsId_news_id_fk` FOREIGN KEY (`newsId`) REFERENCES `news`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `newsAttachments` ADD CONSTRAINT `newsAttachments_uploadedBy_users_id_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `news_attachments_news_id_idx` ON `newsAttachments` (`newsId`,`sortOrder`);
--> statement-breakpoint
CREATE INDEX `news_attachments_cleanup_idx` ON `newsAttachments` (`downloadExpiresAt`,`expirationType`,`storageDeletedAt`);
