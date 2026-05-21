ALTER TABLE `messageCampaigns`
  ADD COLUMN `deletedAt` timestamp NULL,
  ADD COLUMN `deletedById` int NULL,
  ADD COLUMN `deleteReason` text NULL;
