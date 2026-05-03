ALTER TABLE `factories` MODIFY COLUMN `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN IF EXISTS `submittedAt`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN IF EXISTS `reviewedBy`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN IF EXISTS `reviewNote`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN IF EXISTS `rejectReason`;--> statement-breakpoint
ALTER TABLE `factories` DROP COLUMN IF EXISTS `submitCount`;