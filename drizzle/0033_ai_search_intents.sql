CREATE TABLE `aiSearchIntents` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `normalizedQuery` VARCHAR(200) NOT NULL,
  `mainIndustries`  JSON NOT NULL,
  `subIndustries`   JSON NOT NULL,
  `productKeywords` JSON NOT NULL,
  `searchSynonyms`  JSON NOT NULL,
  `confidence`      DECIMAL(4,3) NOT NULL DEFAULT 0,
  `aiProvider`      VARCHAR(50) NOT NULL DEFAULT 'openai',
  `aiModel`         VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  `hitCount`        INT NOT NULL DEFAULT 0,
  `lastUsedAt`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_normalizedQuery` (`normalizedQuery`),
  INDEX `idx_lastUsedAt` (`lastUsedAt`)
);
