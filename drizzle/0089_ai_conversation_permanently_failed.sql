-- Phase 11.2（見對話中「二十二、Failed Summary Retention」「二十三、Permanent
-- Failed Visibility」）：收尾摘要持續失敗（LLM 持續性錯誤、內容觸發穩定的
-- 解析失敗等）原本會無上限重試，retryCount 一直累加、raw conversation 永久
-- 保留卻沒有任何人看得到——這是 Phase 11.1 Audit 認定的 P1 Data Governance
-- 缺口。新增 'permanently_failed' 狀態：重試達到上限
-- （server/jobs/retryFailedAiSummaries.ts 的 MAX_RETRY_COUNT）後，
-- markConversationSummaryFailed 會把狀態改成這個值，讓 retry job 之後不會
-- 再撿到它（getFailedConversations 只查 status='failed'）——但原文依然保留，
-- 不會因為「達到重試上限」就默默丟掉企業資料；只是變成需要人工判斷的
-- governance 案件（見 Admin AI 管理頁新增的 permanentlyFailedSummaryCount）。
--
-- 遷移編號說明：0088_ai_enterprise_memory_factory_scope.sql 已經套用在本機
-- dev DB（oxm）與本機測試 DB（oxm_test），依專案慣例不回頭改寫已套用的歷史
-- migration。只對本機兩個 DB 執行，不碰 production。

ALTER TABLE `aiConversations` MODIFY COLUMN `status` enum('active','failed','permanently_failed') NOT NULL DEFAULT 'active';
