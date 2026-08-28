-- Phase 2 QA 修正：erpCases.updatedAt／erpConsultants.updatedAt 的實際 DB
-- 欄位定義與 drizzle/schema.ts 宣告（`.defaultNow().onUpdateNow()`）不一致。
--
-- Root cause（已 audit，見對話紀錄與 ISO Phase 2 的 0093_certification_
-- cases_updated_at_fix.sql）：這兩個欄位最初都由 0074_iso_erp_marketing.sql
-- 建立，該檔案生成當下漏掉了 ON UPDATE CURRENT_TIMESTAMP 子句（同一份
-- migration 檔裡 certificationConsultants／certificationCases 兩張表也有
-- 同樣缺陷；certificationCases 已在 ISO Phase 2 的 0093 修正，
-- certificationConsultants 仍未修，不在本次範圍）。0074／0075／0078 這幾個
-- migration 本身也不在 drizzle/meta/_journal.json 的紀錄裡（本機這幾個檔案
-- 是透過檔案直接執行套用到 oxm／oxm_test，不是走正常 `drizzle-kit
-- migrate`），所以這裡延續 0093 建立的同一套「獨立 SQL 檔、手動套用」既有
-- 慣例，而不是嘗試用 `drizzle-kit migrate`（journal 對不上，硬跑行為無法
-- 預期）。
--
-- 套用前已用 SHOW FULL COLUMNS 逐一確認兩個欄位目前實際型別／nullability／
-- 預設值：`timestamp NOT NULL DEFAULT now()`，與 schema.ts 宣告的型別、
-- nullable 完全一致，只差 ON UPDATE 子句——這兩支 ALTER 都是單純的 MODIFY
-- COLUMN，只補上遺漏的 ON UPDATE CURRENT_TIMESTAMP，不改型別、不改
-- nullable、不改預設值語意、不動任何既有資料列——執行多次結果相同
-- （idempotent），可安全重複套用。
--
-- 只套用到 local oxm / oxm_test，尚未套用至 production（本機環境沒有
-- production 資料庫連線可用，也沒有這個權限）——ISO Phase 2 的 0093 目前
-- 也仍是同樣的 pending 狀態；production 套用留待所有服務 QA 完成後，一次
-- 整理成正式 migration release，並由有權限的人另外確認 production 現況、
-- 走正式部署流程。

ALTER TABLE `erpCases`
  MODIFY COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `erpConsultants`
  MODIFY COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
