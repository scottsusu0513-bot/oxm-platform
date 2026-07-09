// 合作確認單日期節點必須依流程先後排列：
// 首款付款 ≤ 製作開始 ≤ 預計完成 ≤ 預計出貨 ≤ 尾款結款（同一天允許）。
// 一律用 YYYY-MM-DD 字串比大小（本身就是字典序＝時間序），
// 不轉成 Date/UTC，避免時區造成日期偏移一天。
// 前後端共用同一份規則，前端只負責即時 UX，後端一律重新驗證，不可只信任前端。
export const ORDER_DATE_CHAIN_FIELDS = [
  "depositDueDate",
  "productionStartDate",
  "expectedCompletionDate",
  "expectedShipmentDate",
  "finalPaymentDueDate",
] as const;

export type OrderDateChainField = (typeof ORDER_DATE_CHAIN_FIELDS)[number];
export type OrderDateChainValues = Record<OrderDateChainField, string | null | undefined>;

export const ORDER_DATE_FIELD_LABELS: Record<OrderDateChainField, string> = {
  depositDueDate: "首款付款日期",
  productionStartDate: "製作開始日期",
  expectedCompletionDate: "預計完成日期",
  expectedShipmentDate: "預計出貨日期",
  finalPaymentDueDate: "尾款結款日期",
};

/**
 * 驗證日期順序是否合法（同一天允許，空值不參與比較）。
 * 回傳第一個違反順序的中文錯誤訊息；合法則回傳 null。
 */
export function validateOrderDateChain(values: OrderDateChainValues): string | null {
  let lastField: OrderDateChainField | null = null;
  let lastValue: string | null = null;
  for (const field of ORDER_DATE_CHAIN_FIELDS) {
    const v = values[field];
    if (!v) continue;
    if (lastValue && v < lastValue) {
      return `${ORDER_DATE_FIELD_LABELS[field]}不得早於${ORDER_DATE_FIELD_LABELS[lastField!]}`;
    }
    lastField = field;
    lastValue = v;
  }
  return null;
}
