-- Phase 3A: Community Bid tables
-- communityBids: main bid record with full status lifecycle
-- communityBidIndustries: cross-industry bid → target industry mapping
-- communityBidReviewHistory: immutable audit trail of every review action

CREATE TABLE `communityBids` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `spaceCode` varchar(50) NOT NULL,
  `authorUserId` int NULL,
  `authorFactoryId` int NULL,
  `authorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `authorFactoryNameSnapshot` varchar(200) NULL,
  `authorRoleSnapshot` varchar(50) NULL,
  `title` varchar(200) NOT NULL,
  `description` text NOT NULL,
  `quantity` varchar(200) NULL,
  `material` varchar(200) NULL,
  `specifications` text NULL,
  `sampleRequired` boolean NOT NULL DEFAULT FALSE,
  `desiredDeliveryDate` varchar(100) NULL,
  `deliveryLocation` varchar(200) NULL,
  `budgetMin` int NULL,
  `budgetMax` int NULL,
  `images` json NOT NULL DEFAULT ('[]'),
  `pinnedProductIds` json NOT NULL DEFAULT ('[]'),
  `durationHours` int NOT NULL,
  `status` enum('draft','pending_review','rejected','active','cancelled','ended') NOT NULL DEFAULT 'draft',
  `publishedAt` timestamp NULL,
  `deadline` timestamp NULL,
  `rejectionReason` varchar(1000) NULL,
  `reviewedByUserId` int NULL,
  `reviewedAt` timestamp NULL,
  `deletedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `cb_authorUserId_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `cb_authorFactoryId_fk` FOREIGN KEY (`authorFactoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE INDEX `cb_space_status_idx` ON `communityBids` (`spaceCode`, `status`, `createdAt`);
CREATE INDEX `cb_author_user_idx` ON `communityBids` (`authorUserId`);
CREATE INDEX `cb_status_idx` ON `communityBids` (`status`, `publishedAt`);
CREATE INDEX `cb_deadline_idx` ON `communityBids` (`deadline`);

-- Cross-industry bids must list at least one target industry (not cross-industry itself).
-- Regular bids leave this table empty; the spaceCode on communityBids already implies the industry.
CREATE TABLE `communityBidIndustries` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `bidId` int NOT NULL,
  `spaceCode` varchar(50) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cbi_bidId_fk` FOREIGN KEY (`bidId`) REFERENCES `communityBids`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cbi_bid_space_uq` (`bidId`, `spaceCode`)
);

CREATE INDEX `cbi_space_idx` ON `communityBidIndustries` (`spaceCode`);

-- Immutable audit log.
-- actorUserId: nullable FK (ON DELETE SET NULL) so the record survives admin account deletion.
-- actorNameSnapshot: captures the actor name at the time of action for permanent auditability.
-- bidStatusBefore / bidStatusAfter: full state transition for compliance traceability.
CREATE TABLE `communityBidReviewHistory` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `bidId` int NOT NULL,
  `actorUserId` int NULL,
  `actorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `action` enum('submitted','approved','rejected','withdrawn') NOT NULL,
  `reason` varchar(1000) NULL,
  `bidStatusBefore` varchar(30) NOT NULL DEFAULT '',
  `bidStatusAfter` varchar(30) NOT NULL DEFAULT '',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cbrh_bidId_fk` FOREIGN KEY (`bidId`) REFERENCES `communityBids`(`id`) ON DELETE CASCADE,
  CONSTRAINT `cbrh_actorUserId_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL
);

CREATE INDEX `cbrh_bid_idx` ON `communityBidReviewHistory` (`bidId`);
