-- Add source column to oauthStates
ALTER TABLE `oauthStates` ADD COLUMN `source` varchar(32) NULL;

-- App login ticket table for mobile OAuth flow
CREATE TABLE `appLoginTickets` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ticket` varchar(128) NOT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL DEFAULT NULL,
  `userAgent` text,
  `ip` varchar(64),
  UNIQUE KEY `app_login_ticket_uq` (`ticket`)
);
