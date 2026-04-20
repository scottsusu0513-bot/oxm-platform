CREATE TABLE `announcements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `title` varchar(200) NOT NULL,
  `content` text NOT NULL,
  `type` enum('update','maintenance','news') NOT NULL DEFAULT 'news',
  `isPinned` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
