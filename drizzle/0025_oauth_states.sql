CREATE TABLE `oauthStates` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `state` varchar(128) NOT NULL,
  `redirectTo` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp,
  `userAgent` text,
  `ip` varchar(64),
  UNIQUE KEY `oauth_state_uq` (`state`)
);
