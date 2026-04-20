ALTER TABLE `factories` ADD `status` enum('pending','approved','rejected') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `isApproved`;