-- Migration 0018: member center
-- users 新增欄位
ALTER TABLE `users`
  ADD COLUMN `phone` varchar(30) NULL,
  ADD COLUMN `phoneVerified` boolean NOT NULL DEFAULT false,
  ADD COLUMN `notificationSettings` json NULL,
  ADD COLUMN `deletedAt` timestamp NULL;

-- reports 新增狀態欄位
ALTER TABLE `reports`
  ADD COLUMN `status` enum('pending','received','reviewing','processing','resolved') NOT NULL DEFAULT 'pending',
  ADD COLUMN `adminNote` text NULL;

-- 新增 supportTickets 表
CREATE TABLE `supportTickets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `type` varchar(50) NOT NULL,
  `subject` varchar(200) NOT NULL,
  `description` text NOT NULL,
  `status` enum('pending','received','reviewing','processing','resolved') NOT NULL DEFAULT 'pending',
  `adminNote` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `supportTickets_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
