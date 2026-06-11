-- 商案討論區：貼文表 + 留言表
-- authorUserId 設為 nullable + ON DELETE SET NULL：使用者帳號刪除後，
-- 貼文與留言本體保留，僅清除關聯。作者顯示名稱由快照欄位補充。
CREATE TABLE `communityPosts` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `spaceCode` varchar(50) NOT NULL,
  `authorUserId` int,
  `authorFactoryId` int,
  `authorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `authorFactoryNameSnapshot` varchar(200),
  `authorRoleSnapshot` varchar(50),
  `title` varchar(200) NOT NULL,
  `content` text NOT NULL,
  `images` json NOT NULL DEFAULT ('[]'),
  `pinnedProductIds` json NOT NULL DEFAULT ('[]'),
  `commentsEnabled` boolean NOT NULL DEFAULT true,
  `isPinned` boolean NOT NULL DEFAULT false,
  `isLocked` boolean NOT NULL DEFAULT false,
  `isHidden` boolean NOT NULL DEFAULT false,
  `deletedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `communityPosts_authorUserId_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `communityPosts_authorFactoryId_fk` FOREIGN KEY (`authorFactoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE TABLE `communityComments` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `postId` int NOT NULL,
  `authorUserId` int,
  `authorFactoryId` int,
  `authorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `authorFactoryNameSnapshot` varchar(200),
  `authorRoleSnapshot` varchar(50),
  `content` text NOT NULL,
  `parentCommentId` int,
  `replyToUserId` int,
  `isHidden` boolean NOT NULL DEFAULT false,
  `deletedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `communityComments_postId_fk` FOREIGN KEY (`postId`) REFERENCES `communityPosts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `communityComments_authorUserId_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `communityComments_authorFactoryId_fk` FOREIGN KEY (`authorFactoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL,
  -- ON DELETE SET NULL: parent deleted → replies become orphaned top-level (soft delete preferred anyway)
  CONSTRAINT `communityComments_parentCommentId_fk` FOREIGN KEY (`parentCommentId`) REFERENCES `communityComments`(`id`) ON DELETE SET NULL,
  CONSTRAINT `communityComments_replyToUserId_fk` FOREIGN KEY (`replyToUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL
);

CREATE INDEX `cp_space_idx` ON `communityPosts` (`spaceCode`, `createdAt`);
CREATE INDEX `cp_author_user_idx` ON `communityPosts` (`authorUserId`);
CREATE INDEX `cc_post_idx` ON `communityComments` (`postId`, `createdAt`);
CREATE INDEX `cc_parent_idx` ON `communityComments` (`parentCommentId`);
