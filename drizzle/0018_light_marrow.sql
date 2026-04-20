CREATE TABLE `reportStatusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reportStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`factoryId` int NOT NULL,
	`userId` int NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL DEFAULT 'pending',
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportTickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(50) NOT NULL,
	`subject` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL DEFAULT 'pending',
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticketStatusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticketStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `factories` ADD `subIndustry` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(30);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notificationSettings` json;--> statement-breakpoint
ALTER TABLE `users` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `supportTickets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;