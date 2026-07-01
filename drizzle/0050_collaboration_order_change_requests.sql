-- Phase 4B: 訂單日期修改申請
-- 工廠方提出修改，對方確認後才生效；舊資料不受影響

CREATE TABLE `collaborationOrderChangeRequests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orderId` int NOT NULL,
  `requestedByUserId` int NOT NULL,
  `status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `reason` text,
  `oldValuesJson` json NOT NULL,
  `newValuesJson` json NOT NULL,
  `acceptedAt` timestamp NULL,
  `rejectedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cocr_orderId` (`orderId`),
  CONSTRAINT `cocr_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `collaborationOrders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cocr_requestedByUserId_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
