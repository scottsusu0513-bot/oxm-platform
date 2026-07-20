-- 找消息（News）看板訂閱（純新增）：
--   新表 newsBoardSubscriptions，只存使用者對某個看板 boardKey 的明確覆寫
--   選擇（isSubscribed true/false）；沒有紀錄＝沿用系統預設，由應用層計算，
--   不在這張表或這支 migration 裡處理預設值。
-- 不修改 0057～0061 已建立的欄位或表，不含任何 DROP／TRUNCATE／DELETE／UPDATE。

CREATE TABLE `newsBoardSubscriptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `boardKey` varchar(100) NOT NULL,
  `isSubscribed` boolean NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `newsBoardSubscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `newsBoardSubscriptions` ADD CONSTRAINT `newsBoardSubscriptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX `news_board_sub_user_board_uq` ON `newsBoardSubscriptions` (`userId`,`boardKey`);
--> statement-breakpoint
CREATE INDEX `news_board_sub_user_idx` ON `newsBoardSubscriptions` (`userId`,`isSubscribed`);
