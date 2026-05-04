CREATE TABLE IF NOT EXISTS `reportStatusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reportStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reports` (
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
CREATE TABLE IF NOT EXISTS `supportTickets` (
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
CREATE TABLE IF NOT EXISTS `ticketStatusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
	`adminNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticketStatusHistory_id` PRIMARY KEY(`id`)
);
-- factories.subIndustry, users.phone/phoneVerified/notificationSettings/deletedAt
-- already exist in production (all in schema.ts, app running); ADD COLUMN removed
-- supportTickets FK removed to avoid duplicate constraint if table already existed
