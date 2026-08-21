-- 工廠統一編號（見 shared/taxId.ts）：只有新建立工廠（factory.create）強制
-- 必填，既有工廠一律維持 NULL，不做任何 backfill——不得幫既有正式工廠捏造
-- 一個統一編號。factory.update／submitRevision／admin 審核流程都不要求、
-- 也不驗證這個欄位，只有建立當下的 server 端 zod schema 會擋。
--
-- 欄位 nullable、無 default、無 unique constraint。varchar(8) 只存標準
-- 8 碼數字格式（正規化、trim 後的字串），格式與檢查碼驗證邏輯見
-- shared/taxId.ts 的 normalizeTaxId／isValidTaiwanTaxId。
--
-- 只新增欄位，不 UPDATE、不 backfill、不 DROP、不 RENAME、不加 NOT NULL、
-- 不加 default 任何既有欄位。
--
-- 只套用到 local oxm / oxm_test，不套 production。

ALTER TABLE `factories`
  ADD COLUMN `taxId` varchar(8) NULL;
