-- Phase 2 QA 修正：certificationCases.updatedAt 的實際 DB 欄位定義與
-- drizzle/schema.ts 宣告（`.defaultNow().onUpdateNow()`）不一致。
--
-- Root cause（已 audit，見對話紀錄）：這個欄位最初由 0074_iso_erp_marketing.sql
-- 建立，該檔案生成當下漏掉了 ON UPDATE CURRENT_TIMESTAMP 子句（同一份
-- migration 檔裡 certificationConsultants／erpConsultants／erpCases 三張表的
-- updatedAt 欄位也有同樣缺陷，但本次修正範圍刻意只處理
-- certificationCases，其餘三張表留到下一輪一併處理，不在這裡擴大範圍）。
-- 0074／0075／0078 這幾個 migration 本身也不在 drizzle/meta/_journal.json
-- 的紀錄裡（本機這幾個檔案是透過檔案直接執行套用到 oxm／oxm_test，不是走
-- 正常 `drizzle-kit migrate`），所以這裡延續同樣「獨立 SQL 檔、手動套用」
-- 的既有慣例，而不是嘗試用 `drizzle-kit migrate`（journal 對不上，硬跑
-- 行為無法預期）。
--
-- 這支 ALTER 是單純的 MODIFY COLUMN，只補上遺漏的 ON UPDATE
-- CURRENT_TIMESTAMP，不改型別、不改 nullable、不改預設值語意、不動任何
-- 既有資料列——執行多次結果相同（idempotent），可安全重複套用。
--
-- 只套用到 local oxm / oxm_test，尚未套用至 production（本機環境沒有
-- production 資料庫連線可用，也沒有這個權限）——production 是否已有
-- certificationCases 這張表本身都待確認（0074 註解明寫「未套用至任何正式
-- 資料庫」）；套用 production 前必須由有權限的人另外確認 production 現況
-- 並走正式部署流程。

ALTER TABLE `certificationCases`
  MODIFY COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
