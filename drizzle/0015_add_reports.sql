CREATE TABLE `reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factoryId` int NOT NULL,
  `userId` int NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `reports_factoryId_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `reports_userId_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);