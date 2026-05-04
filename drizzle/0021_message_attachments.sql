ALTER TABLE `messages` MODIFY COLUMN `type` enum('text','co_manager_invite','product','pdf') NOT NULL DEFAULT 'text';
-- messages.attachmentData already exists in production; ADD COLUMN removed
