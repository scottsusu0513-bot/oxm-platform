import {
  ORDER_DATE_CHAIN_FIELDS,
  ORDER_DATE_FIELD_LABELS,
  validateOrderDateChain,
  type OrderDateChainField,
} from "@shared/orderDateChain";

export { ORDER_DATE_CHAIN_FIELDS, ORDER_DATE_FIELD_LABELS, validateOrderDateChain };
export type { OrderDateChainField };

// 前端表單用：所有欄位一律是字串（空字串代表未填），跟 shared 版本的 nullable 型別分開，
// 方便直接綁定 <input type="date"> 的 value。
export type OrderDateChainValues = Record<OrderDateChainField, string>;

/** 指定欄位可選的最小日期＝往前找最近一個已填的日期欄位；都沒填則不限制（undefined）。 */
export function getMinDateForField(
  field: OrderDateChainField,
  values: Partial<OrderDateChainValues>,
): string | undefined {
  const idx = ORDER_DATE_CHAIN_FIELDS.indexOf(field);
  for (let i = idx - 1; i >= 0; i--) {
    const v = values[ORDER_DATE_CHAIN_FIELDS[i]];
    if (v) return v;
  }
  return undefined;
}

/**
 * 使用者變更某個日期欄位後，清空所有「已早於新前置日期」的後續欄位，
 * 避免畫面保留無效日期直到送出才報錯。回傳更新後的完整物件與被清空的欄位清單。
 */
export function applyDateChainChange(
  values: OrderDateChainValues,
  changedField: OrderDateChainField,
  newValue: string,
): { next: OrderDateChainValues; clearedFields: OrderDateChainField[] } {
  const next: OrderDateChainValues = { ...values, [changedField]: newValue };
  const clearedFields: OrderDateChainField[] = [];
  if (newValue) {
    const idx = ORDER_DATE_CHAIN_FIELDS.indexOf(changedField);
    for (let i = idx + 1; i < ORDER_DATE_CHAIN_FIELDS.length; i++) {
      const laterField = ORDER_DATE_CHAIN_FIELDS[i];
      const laterValue = next[laterField];
      if (laterValue && laterValue < newValue) {
        next[laterField] = "";
        clearedFields.push(laterField);
      }
    }
  }
  return { next, clearedFields };
}
