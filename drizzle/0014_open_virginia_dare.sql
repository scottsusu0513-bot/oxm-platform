ALTER TABLE `factories` MODIFY COLUMN `status` enum('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `factories` ADD `avatarUrl` text;