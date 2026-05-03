CREATE TABLE `inquiryBatches` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `title` varchar(50) NOT NULL,
  `message` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  `updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now(),
  CONSTRAINT `inquiryBatches_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `inquiryBatchItems` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `batchId` int NOT NULL,
  `factoryId` int NOT NULL,
  `conversationId` int,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  CONSTRAINT `inquiryBatchItems_batchId_fk` FOREIGN KEY (`batchId`) REFERENCES `inquiryBatches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `inquiryBatchItems_factoryId_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `inquiryBatchItems_conversationId_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE SET NULL
);
