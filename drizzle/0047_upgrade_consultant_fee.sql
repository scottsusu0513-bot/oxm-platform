-- 企業升級中心：新增顧問服務費與 OXM 抽成欄位
-- consultantFeeMode: "percentage"（成數）或 "fixed"（固定金額）
-- consultantFeePercentage: 成數百分比，例如 10.00 代表 10%
-- consultantFeeAmount: 顧問服務費金額（元），後端計算或顧問直填
-- oxmCommissionRate: OXM 抽成比例（%），預設 10
-- oxmCommissionAmount: OXM 收入（元），後端計算

ALTER TABLE `upgradeApplications`
  ADD COLUMN `consultantFeeMode` VARCHAR(20) NULL COMMENT '"percentage" or "fixed"' AFTER `approvedSubsidyAmount`,
  ADD COLUMN `consultantFeePercentage` DECIMAL(5,2) NULL COMMENT '服務費成數 0-100' AFTER `consultantFeeMode`,
  ADD COLUMN `consultantFeeAmount` INT NULL COMMENT '顧問服務費金額（元）' AFTER `consultantFeePercentage`,
  ADD COLUMN `oxmCommissionRate` DECIMAL(5,2) NULL DEFAULT '10.00' COMMENT 'OXM 抽成比例 %' AFTER `consultantFeeAmount`,
  ADD COLUMN `oxmCommissionAmount` INT NULL COMMENT 'OXM 收入（元）' AFTER `oxmCommissionRate`;
