-- Add annual revenue, enterprise-firm status, and prior subsidy application
-- fields to government subsidy applications.
-- Columns are nullable to preserve compatibility with existing applications.
ALTER TABLE `upgradeApplications`
  ADD COLUMN `annualRevenue` varchar(30) NULL AFTER `capitalAmount`,
  ADD COLUMN `isEnterpriseFirm` boolean NULL AFTER `factoryType`,
  ADD COLUMN `hasAppliedForGovernmentSubsidy` boolean NULL AFTER `governmentAwardName`;
