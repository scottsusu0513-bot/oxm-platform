-- 企業升級中心：新增「送審補助方案」欄位
-- submittedSubsidyProgram: SBIR / CITD / SIIR / 研發轉型補助 / 海外通路計畫 / 其他
-- submittedSubsidyProgramOther: 選「其他」時顧問手寫方案名稱

ALTER TABLE `upgradeApplications`
  ADD COLUMN `submittedSubsidyProgram` VARCHAR(50) NULL COMMENT '送審補助方案' AFTER `oxmCommissionAmount`,
  ADD COLUMN `submittedSubsidyProgramOther` VARCHAR(100) NULL COMMENT '其他補助方案說明' AFTER `submittedSubsidyProgram`;
