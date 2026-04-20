CREATE TABLE IF NOT EXISTS `users` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `openId` varchar(64) NOT NULL UNIQUE,
  `name` text,
  `email` varchar(320),
  `loginMethod` varchar(64),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `isFactoryOwner` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  `lastSignedIn` timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS `factories` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ownerId` int NOT NULL,
  `name` varchar(200) NOT NULL,
  `industry` varchar(50) NOT NULL,
  `mfgModes` json NOT NULL,
  `region` varchar(20) NOT NULL,
  `description` text,
  `capitalLevel` varchar(30) NOT NULL,
  `foundedYear` int,
  `ownerName` varchar(100),
  `phone` varchar(30),
  `website` varchar(500),
  `contactEmail` varchar(320),
  `address` varchar(500) NOT NULL DEFAULT '',
  `avgRating` decimal(3,2) DEFAULT '0',
  `reviewCount` int DEFAULT 0,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `submittedAt` timestamp NULL,
  `rejectionReason` text,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE IF NOT EXISTS `products` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `factoryId` int NOT NULL,
  `name` varchar(200) NOT NULL,
  `priceMin` decimal(12,2),
  `priceMax` decimal(12,2),
  `acceptSmallOrder` boolean NOT NULL DEFAULT false,
  `provideSample` boolean NOT NULL DEFAULT false,
  `description` text,
  `images` json DEFAULT ('[]'),
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `factoryId` int NOT NULL,
  `productId` int,
  `lastMessageAt` timestamp NOT NULL DEFAULT NOW(),
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS `messages` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `conversationId` int NOT NULL,
  `senderId` int NOT NULL,
  `senderRole` enum('user','factory') NOT NULL,
  `content` text NOT NULL,
  `isRead` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `reviews` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `factoryId` int NOT NULL,
  `userId` int NOT NULL,
  `rating` int NOT NULL,
  `comment` text,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `advertisements` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `factoryId` int NOT NULL,
  `industry` varchar(50) NOT NULL,
  `capitalLevel` varchar(30) NOT NULL,
  `region` varchar(20) NOT NULL,
  `extraRegions` json DEFAULT ('[]'),
  `isActive` boolean NOT NULL DEFAULT true,
  `startDate` timestamp NOT NULL,
  `endDate` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `favorites` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `factoryId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
);