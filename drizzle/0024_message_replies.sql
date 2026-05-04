CREATE TABLE `messageReplies` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaignId` int NOT NULL,
  `userId` int NOT NULL,
  `content` text NOT NULL,
  `senderRole` enum('user','admin') NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `messageReplies_id` PRIMARY KEY(`id`),
  INDEX `idx_message_replies_thread` (`campaignId`, `userId`)
);
--> statement-breakpoint
ALTER TABLE `messageReplies` ADD CONSTRAINT `messageReplies_campaignId_fk` FOREIGN KEY (`campaignId`) REFERENCES `messageCampaigns`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `messageReplies` ADD CONSTRAINT `messageReplies_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE;
