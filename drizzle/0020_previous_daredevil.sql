CREATE TABLE `pageViews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitorId` varchar(64) NOT NULL,
	`date` varchar(10) NOT NULL,
	`hour` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pageViews_id` PRIMARY KEY(`id`),
	CONSTRAINT `visitor_date_hour_idx` UNIQUE(`visitorId`,`date`,`hour`)
);
