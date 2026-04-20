ALTER TABLE `factories` MODIFY COLUMN `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `submittedAt`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `reviewedBy`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `reviewNote`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `rejectReason`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN `submitCount`;