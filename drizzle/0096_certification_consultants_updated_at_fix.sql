-- Shared Cleanup 修正：certificationConsultants.updatedAt 的實際 DB 欄位
-- 定義與 drizzle/schema.ts 宣告（`.defaultNow().onUpdateNow()`）不一致。
--
-- Root cause（已 audit，見對話紀錄）：這個欄位最初由 0074_iso_erp_marketing.sql
-- 建立——ISO Phase 2 當時已確認同一份 migration 檔案裡 certificationCases／
-- erpConsultants／erpCases 都有同樣缺陷，並在報告中明確標記
-- certificationConsultants「留到下一輪一併處理」；本檔案就是那一輪。0074
-- （跟 0073／0075／0078 一樣）不在 drizzle/meta/_journal.json 的紀錄裡（本機
-- 這幾個檔案是透過檔案直接執行套用到 oxm／oxm_test，不是走正常
-- `drizzle-kit migrate`），所以這裡延續 0093／0094／0095 建立的同一套
-- 「獨立 SQL 檔、手動套用」既有慣例，而不是嘗試用 `drizzle-kit migrate`
-- （journal 對不上，硬跑行為無法預期）。
--
-- 套用前已用 SHOW FULL COLUMNS 確認欄位目前實際型別／nullability／預設值：
-- `timestamp NOT NULL DEFAULT now()`，與 schema.ts 宣告的型別、nullable
-- 完全一致，只差 ON UPDATE 子句——這支 ALTER 是單純的 MODIFY COLUMN，只補
-- 上遺漏的 ON UPDATE CURRENT_TIMESTAMP，不改型別、不改 nullable、不改
-- 預設值語意、不動任何既有資料列——執行多次結果相同（idempotent），可安全
-- 重複套用。
--
-- 只套用到 local oxm / oxm_test，尚未套用至 production（本機環境沒有
-- production 資料庫連線可用，也沒有這個權限）——0093／0094／0095 目前也
-- 仍是同樣的 pending 狀態；production 套用留待這一輪 Release Plan 統一
-- 處理，並由有權限的人另外確認 production 現況、走正式部署流程。

ALTER TABLE `certificationConsultants`
  MODIFY COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
