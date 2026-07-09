// 合作確認單製作階段：只能由「進入下一階段」手動操作推進，日期抵達不會自動改變。
//
// 5 個日期欄位對應「里程碑」：
//   depositDueDate         首款到期日（僅供顯示參考，不作為任何階段轉換的判斷依據——見下方說明）
//   productionStartDate    原定製作開始日
//   expectedCompletionDate 預計完成日
//   expectedShipmentDate   預計出貨日
//   finalPaymentDueDate    尾款到期日
//
// 階段設計為 4 個進行中階段 + 完成（不額外拆出語意重複的「待完成」階段）：
//   awaiting_deposit       等待首款：訂單已成立，等待買方付訂金。
//   in_production          製作中：訂金已確認，工廠正在製作。
//   awaiting_shipment      待出貨：製作完成，等待出貨（涵蓋「製作完成／待出貨」）。
//   awaiting_final_payment 待結款：已出貨，等待尾款（涵蓋「已出貨／待尾款」）。
//   completed              已完成（awaiting_final_payment → completed 由既有「完成訂單」流程
//                          markCollaborationOrderComplete 處理，不透過本模組的 advanceStage）。
//
// currentStage 只在 status='accepted'（含其後的 in_progress/shipped 等中間態）期間有意義；
// 訂單建立時（pending）尚未有 currentStage；status 進入 completed 時一併寫入 'completed'。
export const COLLABORATION_ORDER_STAGES = [
  "awaiting_deposit",
  "in_production",
  "awaiting_shipment",
  "awaiting_final_payment",
  "completed",
] as const;

export type CollaborationOrderStage = (typeof COLLABORATION_ORDER_STAGES)[number];

export const COLLABORATION_ORDER_STAGE_LABELS: Record<CollaborationOrderStage, string> = {
  awaiting_deposit: "等待首款",
  in_production: "製作中",
  awaiting_shipment: "待出貨",
  awaiting_final_payment: "待結款",
  completed: "已完成",
};

// 合法的下一階段（不可跳階，也不可從 completed 再推進）。
// awaiting_final_payment 之後的「完成」刻意不列在這裡——交由既有「完成訂單」流程處理，
// 避免同時存在兩個都能把訂單寫成 completed 的入口（見 markCollaborationOrderComplete 的
// currentStage 檢查）。
export const COLLABORATION_ORDER_NEXT_STAGE: Partial<Record<CollaborationOrderStage, CollaborationOrderStage>> = {
  awaiting_deposit: "in_production",
  in_production: "awaiting_shipment",
  awaiting_shipment: "awaiting_final_payment",
};

export type CollaborationOrderDateField =
  | "depositDueDate"
  | "productionStartDate"
  | "expectedCompletionDate"
  | "expectedShipmentDate"
  | "finalPaymentDueDate";

// 每個階段「離開時」對應的預計節點日期欄位（不是進入時的日期）：
//   awaiting_deposit       等待首款 → 原定製作開始日 productionStartDate 到了才視為提早進入製作中
//                          （已跟產品確認：即使首款已收，只要還沒到原定開工日就按下推進，仍算提早）
//   in_production          製作中 → 預計完成日 expectedCompletionDate 到了，預期已製作完成，轉入待出貨
//   awaiting_shipment      待出貨 → 預計出貨日 expectedShipmentDate 到了，預期已出貨，轉入待結款
//   awaiting_final_payment 待結款 → 尾款到期日 finalPaymentDueDate 到了，可完成訂單（既有流程）
// depositDueDate 只作為時間軸上的參考資訊顯示，不對應任何一次階段轉換的判斷
// （首款是否已收由人員自行確認，不透過欄位推算）。
export const COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD: Partial<Record<CollaborationOrderStage, CollaborationOrderDateField>> = {
  awaiting_deposit: "productionStartDate",
  in_production: "expectedCompletionDate",
  awaiting_shipment: "expectedShipmentDate",
  awaiting_final_payment: "finalPaymentDueDate",
};

/**
 * 提早判斷：今天（YYYY-MM-DD 字串）早於節點日期 → true；等於或晚於 → false。
 * 沒有節點日期（null/undefined）→ false（不顯示提早警語，允許直接推進）。
 */
export function isStageTransitionEarly(todayStr: string, expectedDate: string | null | undefined): boolean {
  return !!expectedDate && todayStr < expectedDate;
}
