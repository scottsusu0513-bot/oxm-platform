ALTER TABLE `collaborationOrders`
  ADD COLUMN `earlyCompletedAt` timestamp NULL,
  ADD COLUMN `earlyCompletedByUserId` int NULL,
  ADD COLUMN `earlyShippedAt` timestamp NULL,
  ADD COLUMN `earlyShippedByUserId` int NULL;

CREATE TABLE `collaborationOrderRepeatRequests` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `originalOrderId` int NOT NULL,
  `conversationId` int NOT NULL,
  `requestedByUserId` int NOT NULL,
  `requestedAsFactoryId` int NULL,
  `status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_corr_order` FOREIGN KEY (`originalOrderId`) REFERENCES `collaborationOrders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_corr_conv` FOREIGN KEY (`conversationId`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_corr_user` FOREIGN KEY (`requestedByUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
