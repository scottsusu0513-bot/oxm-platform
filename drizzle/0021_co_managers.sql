-- Phase 1: Co-manager feature
-- Add type and invitationId to messages table
ALTER TABLE `messages`
  ADD COLUMN `type` enum('text','co_manager_invite') NOT NULL DEFAULT 'text',
  ADD COLUMN `invitationId` int;

-- Factory co-manager invitations (history preserved, no unique constraint)
CREATE TABLE `factoryCoManagerInvitations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `inviterUserId` int NOT NULL,
  `inviteeUserId` int NOT NULL,
  `status` enum('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  `conversationId` int,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `respondedAt` timestamp,
  CONSTRAINT `factoryCoManagerInvitations_id` PRIMARY KEY(`id`),
  INDEX `idx_invitation_lookup` (`factoryId`, `inviteeUserId`, `status`)
);

-- Factory co-managers (soft delete via removedAt)
CREATE TABLE `factoryCoManagers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `userId` int NOT NULL,
  `invitedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `removedAt` timestamp,
  CONSTRAINT `factoryCoManagers_id` PRIMARY KEY(`id`),
  INDEX `idx_co_manager_lookup` (`factoryId`, `userId`)
);
