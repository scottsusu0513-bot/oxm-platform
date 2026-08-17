-- Phase 5 可靠性修正（Handoff submission linkage）：consumedAt 重新定義為
-- 「這個 AI Handoff 已經成功用來提交正式案件」，不再等同「assessment pending
-- row 建立成功」。submittedCaseId + serviceKey（既有欄位）構成 polymorphic
-- case reference——五個服務案件表各自獨立、不同 table，故意不建 FK（沿用
-- aiHandoffContexts.sourceConversationId／aiCaseAssessments.caseId 同一種
-- 「跨表引用不建錯誤 FK」慣例）。submittedAt 記錄正式送件時間，供追溯。
ALTER TABLE aiHandoffContexts
  ADD COLUMN submittedCaseId INT NULL,
  ADD COLUMN submittedAt TIMESTAMP NULL;

-- Missing assessment recovery 用這個複合索引找「已送件、但還沒有對應
-- assessment」的 handoff（見對話中「五、新增 Missing Assessment Recovery」）。
CREATE INDEX ahc_submitted_case_idx ON aiHandoffContexts (serviceKey, submittedCaseId);
