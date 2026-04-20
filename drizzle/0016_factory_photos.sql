CREATE TABLE IF NOT EXISTS `factoryPhotos` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `factoryId` int NOT NULL,
  `url` text NOT NULL,
  `caption` varchar(200),
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
);
