CREATE TABLE IF NOT EXISTS `pageViews` (
  `id` int NOT NULL AUTO_INCREMENT,
  `visitorId` varchar(64) NOT NULL,
  `date` varchar(10) NOT NULL,
  `hour` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `visitor_date_hour_idx` (`visitorId`, `date`, `hour`)
);
