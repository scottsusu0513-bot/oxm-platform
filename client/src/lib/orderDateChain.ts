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

/** 往前找最近一個已填的日期欄位（回傳欄位名，不是值）；都沒填則回傳 null。 */
function findPrecedingFilledField(
  field: OrderDateChainField,
  values: Partial<OrderDateChainValues>,
): OrderDateChainField | null {
  const idx = ORDER_DATE_CHAIN_FIELDS.indexOf(field);
  for (let i = idx - 1; i >= 0; i--) {
    if (values[ORDER_DATE_CHAIN_FIELDS[i]]) return ORDER_DATE_CHAIN_FIELDS[i];
  }
  return null;
}

/** 指定欄位可選的最小日期＝往前找最近一個已填的日期欄位；都沒填則不限制（undefined）。 */
export function getMinDateForField(
  field: OrderDateChainField,
  values: Partial<OrderDateChainValues>,
): string | undefined {
  const precedingField = findPrecedingFilledField(field, values);
  return precedingField ? values[precedingField] : undefined;
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

/**
 * 日期欄位變更的第二層防護：原生 <input type="date"> 的 min 屬性在部分手機瀏覽器／
 * Capacitor Android・iOS 的原生日期選擇器上不一定會擋掉更早的日期（min 仍有帶入，但
 * picker UI 本身可能允許滑到 min 之前，或不會視覺反灰），所以 onChange 拿到值之後
 * 一定要在這裡重新驗證一次，不能只依賴瀏覽器/原生元件的行為。
 *
 * 若選到的日期早於「往前找到的最近一個已填日期」，直接拒絕（不寫入 state，呼叫端應
 * 顯示 message 並保留原本的值，不可讓不合法日期進入 state）；合法則沿用
 * applyDateChainChange 清空後續已失效的日期。三個表單（ChatPage.tsx ×2、
 * OrderDetail.tsx ×1）都必須呼叫這個函式，不要各自複製一套規則。
 */
export function handleOrderDateFieldChange(
  values: OrderDateChainValues,
  field: OrderDateChainField,
  newValue: string,
):
  | { ok: true; next: OrderDateChainValues; clearedFields: OrderDateChainField[] }
  | { ok: false; message: string } {
  if (newValue) {
    const precedingField = findPrecedingFilledField(field, values);
    if (precedingField) {
      const minDate = values[precedingField];
      if (minDate && newValue < minDate) {
        return {
          ok: false,
          message: `${ORDER_DATE_FIELD_LABELS[field]}不得早於${ORDER_DATE_FIELD_LABELS[precedingField]}`,
        };
      }
    }
  }
  const { next, clearedFields } = applyDateChainChange(values, field, newValue);
  return { ok: true, next, clearedFields };
}

/**
 * 把 YYYY-MM-DD 字串解析成「本地時區」的 Date（年月日直接用 Date(year, month-1, day)
 * 建構子，不經過任何字串轉時間戳/UTC 的路徑），避免 new Date("2026-07-01") 這種寫法
 * 在部分瀏覽器把日期字串當 UTC 午夜解析、換算回本地時區後偏移一天的問題。
 */
export function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

/**
 * 把 Date 格式化回 YYYY-MM-DD，一律用本地時區的 getFullYear/getMonth/getDate，
 * 不使用 date.toISOString().slice(0, 10)（那會先轉成 UTC，在 UTC+8 等時區可能
 * 把午夜前後的日期換算偏移一天）。
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
