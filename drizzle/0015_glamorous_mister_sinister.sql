ALTER TABLE `factories` ADD `businessType` enum('factory','studio') DEFAULT 'factory' NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `operationStatus` enum('normal','busy','full') DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `certified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `avgResponseHours` decimal(8,2);--> statement-breakpoint
ALTER TABLE `factories` ADD `weekdayHours` varchar(50);--> statement-breakpoint
ALTER TABLE `factories` ADD `weekendHours` varchar(50);--> statement-breakpoint
ALTER TABLE `factories` ADD `businessNote` text;--> statement-breakpoint
ALTER TABLE `products` ADD `priceType` enum('range','fixed','market') DEFAULT 'range' NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `reply` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `repliedAt` timestamp;