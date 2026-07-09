-- ============================================================================
-- 執行前請先在正式資料庫盤點現有資料，確認 accepted 訂單數量與可回填依據後再套用。
-- 建議先執行以下查詢（不會修改任何資料）：
--
--   SELECT status, COUNT(*) AS count FROM collaborationOrders GROUP BY status;
--
--   SELECT id, status, acceptedAt, earlyShippedAt, earlyCompletedAt, completedAt,
--          depositDueDate, productionStartDate, expectedCompletionDate,
--          expectedShipmentDate, finalPaymentDueDate
--     FROM collaborationOrders
--    WHERE status = 'accepted'
--    ORDER BY acceptedAt;
--
-- 若 accepted 數量為 0，此 migration 對 currentStage 完全沒有回填風險。
-- 若數量很少，建議由管理員人工核對後個別指定 currentStage，而不是整批猜測。
-- 若數量很多，需要另外設計依可靠欄位（如 earlyShippedAt/earlyCompletedAt）保守回填的
-- 後續 migration，本檔案本身「不」對 accepted 做任何猜測性回填。
-- ============================================================================

ALTER TABLE `collaborationOrders`
  ADD COLUMN `currentStage` enum('awaiting_deposit','in_production','awaiting_shipment','awaiting_final_payment','completed') NULL;

-- 舊訂單回填 currentStage（nullable，只在「可以確定、不需要猜測」時才給值）：
--   completed              -> 'completed'（唯一不需要猜測子階段的狀態：訂單真的已經完成，
--                             不涉及「完成前走到哪個階段」的猜測）
--   accepted               -> 保持 NULL（不做任何猜測性回填——見上方盤點查詢；已成立的舊訂單
--                             可能實際已經開始製作、完成、出貨或等待尾款，若整批寫成
--                             'awaiting_deposit' 會是錯誤且誤導性的資料。currentStage 是 nullable，
--                             UI 對 currentStage=null 的 accepted 訂單會維持原本「完成訂單」按鈕
--                             （沿用既有日期/提早出貨判斷），不會顯示新的「進入下一階段」/
--                             階段 timeline，直到有更精準的回填依據或管理員人工指定）
--   in_progress / shipped  -> NULL（本次任務前就已是「從未被任何程式路徑寫入」的舊列舉值，
--                             無法確認其歷史真實語意，寧可留白也不要偽造階段）
--   pending                -> NULL（尚未成立，沒有製作階段可言）
--   rejected               -> NULL（buyer 拒絕，從未進入製作流程）
--   cancelled              -> NULL（已取消，製作流程已中止）
--   cancel_requested       -> NULL（取消申請中，暫不視為仍在正常推進的製作流程）
UPDATE `collaborationOrders` SET `currentStage` = 'completed' WHERE `status` = 'completed';
-- accepted / pending / rejected / cancelled / cancel_requested / in_progress / shipped：
-- 維持 NULL，不需要額外 UPDATE

CREATE TABLE `collaborationOrderStageHistory` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `orderId` int NOT NULL,
  `actorUserId` int NULL,
  `actorNameSnapshot` varchar(100) NOT NULL DEFAULT '',
  `actorFactoryNameSnapshot` varchar(200) NOT NULL DEFAULT '',
  -- fromStage 允許 NULL：舊訂單（currentStage 從未被初始化）直接完成時，沒有真實的前一
  -- 階段可回填，一律寫 NULL，不偽造它曾經進入 awaiting_final_payment 或任何其他階段。
  `fromStage` varchar(30) NULL,
  `toStage` varchar(30) NOT NULL DEFAULT '',
  `note` varchar(1000) NULL,
  `isEarly` boolean NOT NULL DEFAULT false,
  `expectedDateAtTransition` varchar(10) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cosh_order` FOREIGN KEY (`orderId`) REFERENCES `collaborationOrders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cosh_user` FOREIGN KEY (`actorUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `cosh_order_idx` (`orderId`, `createdAt`)
);
