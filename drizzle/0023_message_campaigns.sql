CREATE TABLE `messageCampaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `title` varchar(200) NOT NULL,
  `content` text NOT NULL,
  `senderId` int NOT NULL,
  `targetType` enum('all_users','all_factory_managers','single') NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `messageCampaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messageRecipients` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaignId` int NOT NULL,
  `receiverId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `messageRecipients_id` PRIMARY KEY(`id`),
  CONSTRAINT `mc_campaign_receiver_uq` UNIQUE(`campaignId`, `receiverId`)
);
--> statement-breakpoint
ALTER TABLE `messageCampaigns` ADD CONSTRAINT `messageCampaigns_senderId_fk` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `messageRecipients` ADD CONSTRAINT `messageRecipients_campaignId_fk` FOREIGN KEY (`campaignId`) REFERENCES `messageCampaigns`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `messageRecipients` ADD CONSTRAINT `messageRecipients_receiverId_fk` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE;
