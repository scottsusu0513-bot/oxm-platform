CREATE TABLE IF NOT EXISTS `productCategories` (
    `id` int AUTO_INCREMENT PRIMARY KEY,
    `factoryId` int NOT NULL,
    `name` varchar(100) NOT NULL,
    `sortOrder` int NOT NULL DEFAULT 0,
    `createdAt` timestamp NOT NULL DEFAULT NOW(),
    FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
  );
ALTER TABLE `products` ADD COLUMN `categoryId` int NULL;
ALTER TABLE `products` ADD CONSTRAINT `fk_product_category` FOREIGN KEY (`categoryId`) REFERENCES `productCategories`(`id`) ON DELETE SET NULL;
