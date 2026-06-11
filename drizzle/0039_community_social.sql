-- Community Phase 2A: board follows, factory follows, content follows,
-- reactions, mentions, and community notifications.

CREATE TABLE `communityBoardFollows` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `spaceCode` varchar(50) NOT NULL,
  `notifyNewDiscussions` boolean NOT NULL DEFAULT TRUE,
  `notifyNewBids` boolean NOT NULL DEFAULT FALSE,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `cbf_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cbf_user_space_uq` (`userId`, `spaceCode`)
);

CREATE INDEX `cbf_space_idx` ON `communityBoardFollows` (`spaceCode`);
CREATE INDEX `cbf_user_idx` ON `communityBoardFollows` (`userId`);

CREATE TABLE `factoryFollows` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NOT NULL,
  `notifyNewDiscussions` boolean NOT NULL DEFAULT TRUE,
  `notifyNewBids` boolean NOT NULL DEFAULT FALSE,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ff_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ff_factoryId_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `ff_user_factory_uq` (`userId`, `factoryId`)
);

CREATE INDEX `ff_factory_idx` ON `factoryFollows` (`factoryId`);
CREATE INDEX `ff_user_idx` ON `factoryFollows` (`userId`);

CREATE TABLE `communityContentFollows` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `contentType` varchar(20) NOT NULL DEFAULT 'discussion',
  `contentId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `ccf_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `ccf_user_content_uq` (`userId`, `contentType`, `contentId`)
);

CREATE INDEX `ccf_content_idx` ON `communityContentFollows` (`contentType`, `contentId`);
CREATE INDEX `ccf_user_idx` ON `communityContentFollows` (`userId`);

CREATE TABLE `communityReactions` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `targetType` varchar(20) NOT NULL,
  `targetId` int NOT NULL,
  `reactionType` varchar(20) NOT NULL DEFAULT 'helpful',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cr_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cr_user_target_uq` (`userId`, `targetType`, `targetId`, `reactionType`)
);

CREATE INDEX `cr_target_idx` ON `communityReactions` (`targetType`, `targetId`);
CREATE INDEX `cr_user_idx` ON `communityReactions` (`userId`);

CREATE TABLE `communityMentions` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `sourceType` varchar(20) NOT NULL,
  `sourceId` int NOT NULL,
  `mentionedUserId` int NULL,
  `mentionedFactoryId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cm_mentionedUserId_fk` FOREIGN KEY (`mentionedUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `cm_mentionedFactoryId_fk` FOREIGN KEY (`mentionedFactoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  -- Exactly one of mentionedUserId / mentionedFactoryId must be set (XOR)
  CONSTRAINT `cm_xor_target` CHECK (
    (`mentionedUserId` IS NOT NULL AND `mentionedFactoryId` IS NULL)
    OR
    (`mentionedUserId` IS NULL AND `mentionedFactoryId` IS NOT NULL)
  ),
  -- MySQL allows multiple NULLs in unique indexes; the XOR CHECK ensures only one column
  -- is non-NULL per row, making these effectively (sourceType, sourceId, target) unique
  UNIQUE KEY `cm_source_user_uq` (`sourceType`, `sourceId`, `mentionedUserId`),
  UNIQUE KEY `cm_source_factory_uq` (`sourceType`, `sourceId`, `mentionedFactoryId`)
);

CREATE INDEX `cm_source_idx` ON `communityMentions` (`sourceType`, `sourceId`);
CREATE INDEX `cm_user_idx` ON `communityMentions` (`mentionedUserId`);
CREATE INDEX `cm_factory_idx` ON `communityMentions` (`mentionedFactoryId`);

CREATE TABLE `communityNotifications` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `recipientUserId` int NOT NULL,
  -- actorUserId / actorFactoryId: no FK — actor may be deleted, keep notification
  `actorUserId` int NULL,
  `actorFactoryId` int NULL,
  `eventType` varchar(50) NOT NULL,
  `eventGroup` varchar(50) NOT NULL,
  -- postId / commentId: no FK — post may be hard deleted
  `postId` int NULL,
  `commentId` int NULL,
  `spaceCode` varchar(50) NULL,
  `titleSnapshot` varchar(200) NULL,
  `actorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `actorFactoryNameSnapshot` varchar(200) NULL,
  `message` text NOT NULL,
  `dedupeKey` varchar(200) NOT NULL,
  `isRead` boolean NOT NULL DEFAULT FALSE,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL,
  CONSTRAINT `cn_recipientUserId_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cn_dedupe_uq` (`dedupeKey`)
);

CREATE INDEX `cn_recipient_unread_idx` ON `communityNotifications` (`recipientUserId`, `isRead`, `createdAt`);
CREATE INDEX `cn_recipient_created_idx` ON `communityNotifications` (`recipientUserId`, `createdAt`);
CREATE INDEX `cn_post_idx` ON `communityNotifications` (`postId`);
CREATE INDEX `cn_comment_idx` ON `communityNotifications` (`commentId`);
