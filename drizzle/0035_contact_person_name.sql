-- 新增洽詢窗口欄位
-- contactPersonName: 使用者詢價、電話、站內訊息時第一位接洽的窗口
-- NULL 允許，既有工廠前端以 ownerName 做 fallback，不強制回填

ALTER TABLE `factories` ADD COLUMN `contactPersonName` varchar(100) NULL;
