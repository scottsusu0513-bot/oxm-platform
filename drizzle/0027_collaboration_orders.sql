-- 合作確認單功能 migration

-- 1. 新增 collaborationOrders 資料表
CREATE TABLE `collaborationOrders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `factoryId` int NOT NULL,
  `buyerUserId` int NOT NULL,
  `createdByUserId` int NOT NULL,
  `productId` int NULL,
  `projectName` varchar(200) NOT NULL,
  `description` text NOT NULL,
  `depositDueDate` varchar(10) NULL,
  `productionStartDate` varchar(10) NULL,
  `expectedCompletionDate` varchar(10) NULL,
  `expectedShipmentDate` varchar(10) NULL,
  `finalPaymentDueDate` varchar(10) NULL,
  `note` text NULL,
  `status` enum('pending','accepted','rejected','in_progress','shipped','completed','cancelled') NOT NULL DEFAULT 'pending',
  `acceptedAt` timestamp NULL,
  `rejectedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `cancelledAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT `collaborationOrders_pk` PRIMARY KEY(`id`),
  CONSTRAINT `collaborationOrders_conversationId_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `collaborationOrders_factoryId_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `collaborationOrders_buyerUserId_fk` FOREIGN KEY (`buyerUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `collaborationOrders_createdByUserId_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `collaborationOrders_productId_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL
);

-- 2. messages 表新增 collaboration_order 訊息類型
ALTER TABLE `messages`
  MODIFY COLUMN `type` enum('text','co_manager_invite','product','pdf','collaboration_order') NOT NULL DEFAULT 'text';

-- 3. reviews 表新增合作確認單關聯欄位
ALTER TABLE `reviews`
  ADD COLUMN `collaborationOrderId` int NULL,
  ADD COLUMN `reviewType` enum('general','verified_order') NOT NULL DEFAULT 'general';
