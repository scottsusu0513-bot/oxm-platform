ALTER TABLE `factories` RENAME COLUMN `rejectionreason` TO `rejectionReason`;--> statement-breakpoint
ALTER TABLE `factories` ADD `address` varchar(500) DEFAULT '' NOT NULL;