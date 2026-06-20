-- 新增 ineligible（資格不符）狀態至 upgradeApplications.status enum
-- 上線前由管理員手動執行，不可在 production 自動執行
ALTER TABLE `upgradeApplications`
  MODIFY COLUMN `status`
  ENUM('new','viewed','contacted','consulting','submitted','completed','unassigned','archived','ineligible')
  NOT NULL DEFAULT 'new';
