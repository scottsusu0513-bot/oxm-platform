ALTER TABLE `messages` MODIFY COLUMN `type` enum('text','co_manager_invite','product','pdf') NOT NULL DEFAULT 'text';
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `attachmentData` json;
