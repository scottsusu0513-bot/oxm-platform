-- Add factoryId column to upgradeApplications to track which OXM factory submitted the application
ALTER TABLE upgradeApplications
  ADD COLUMN factoryId INT NULL AFTER notes,
  ADD INDEX ua_factory_idx (factoryId);
