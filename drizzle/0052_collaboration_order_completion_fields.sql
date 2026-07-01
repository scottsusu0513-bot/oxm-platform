ALTER TABLE `collaborationOrders`
  ADD COLUMN `completedByUserId` int NULL,
  ADD COLUMN `completionNote` text NULL;
