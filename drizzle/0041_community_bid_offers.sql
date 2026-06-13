-- Phase 3B: Factory bid offers for community bid requests
-- communityBidOffers: one active offer per factory per bid (UNIQUE bidId + bidderFactoryId)
-- Bid author is prohibited from offering on their own request (enforced at router layer).
-- bidderFactoryId SET NULL if factory deleted; snapshot fields preserve identity for audit.
-- MySQL UNIQUE allows multiple NULLs, so SET NULL on concurrent deletes won't conflict.
-- lastUpdatedByUserId/Snapshot: who last mutated the offer (create/update/withdraw/resubmit).

CREATE TABLE `communityBidOffers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bidId` int NOT NULL,
  `bidderUserId` int NULL,
  `bidderFactoryId` int NULL,
  `bidderNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `bidderFactoryNameSnapshot` varchar(200) NOT NULL DEFAULT '',
  `bidderRoleSnapshot` varchar(50) NOT NULL DEFAULT 'owner',
  `amount` decimal(12, 0) NULL COMMENT 'NTD; DECIMAL not FLOAT to avoid rounding errors',
  `currency` varchar(10) NOT NULL DEFAULT 'TWD',
  `deliveryDays` int NULL,
  `moq` int NULL,
  `sampleAvailable` tinyint(1) NOT NULL DEFAULT 0,
  `proposal` text NOT NULL,
  `commercialTerms` text NULL,
  `images` json NOT NULL DEFAULT ('[]'),
  `pinnedProductIds` json NOT NULL DEFAULT ('[]'),
  `lastUpdatedByUserId` int NULL,
  `lastUpdatedByNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `status` enum('active','withdrawn','disqualified') NOT NULL DEFAULT 'active',
  `submittedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `withdrawnAt` timestamp NULL,
  `deletedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cbo_bid_factory_uq` (`bidId`, `bidderFactoryId`),
  KEY `cbo_bid_status_idx` (`bidId`, `status`),
  KEY `cbo_bidder_user_idx` (`bidderUserId`),
  KEY `cbo_bidder_factory_idx` (`bidderFactoryId`),
  KEY `cbo_last_updater_idx` (`lastUpdatedByUserId`),
  CONSTRAINT `cbo_bid_fk` FOREIGN KEY (`bidId`) REFERENCES `communityBids` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cbo_bidder_user_fk` FOREIGN KEY (`bidderUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cbo_bidder_factory_fk` FOREIGN KEY (`bidderFactoryId`) REFERENCES `factories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cbo_last_updater_fk` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
