// 台灣統一編號（8 碼數字）格式正規化與檢查碼驗證。
//
// 純函式，不讀 process.env、不碰 DB——server（server/routers.ts 的
// factory.create）與 client（FactoryRegister.tsx）都直接 import 這支檔案，
// 確保前後端用同一套驗證邏輯，不會出現「前端說有效、後端拒絕」或反過來的
// 不一致。
//
// 只驗證「必填時的格式是否正確」，不做任何遮罩／加密——統一編號是公開的
// 工商登記資訊，不是需要保護的個資（見這次任務的需求：不遮罩、不加密）。

/** 去除前後空白。刻意只 trim，不自動轉換全形數字為半形——全形數字視為
 * 格式錯誤，要求使用者自己輸入半形數字，不做隱性轉換猜測使用者意圖。 */
export function normalizeTaxId(value: string): string {
  return value.trim();
}

const TAX_ID_WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;

function digitSum(product: number): number {
  return Math.floor(product / 10) + (product % 10);
}

/**
 * 標準台灣統一編號檢查碼演算法：
 *   1. 8 碼數字各自乘上對應權重 [1,2,1,2,1,2,4,1]
 *   2. 若乘積為兩位數，兩位數字相加（例如 18 → 1+8=9）
 *   3. 8 組結果加總，總和為 10 的倍數即為有效
 *   4. 特例：第 7 碼（index 6）為 7 時，總和 +1 後為 10 的倍數也算有效
 *      （財政部公告的已知例外，歷史上少數統編的檢查碼算法差異）
 *
 * @param value 必須已經是 normalizeTaxId() 處理過的字串（僅 trim，未做其他
 *   轉換）——這裡仍會用 regex 完整檢查格式，呼叫端不需要事先確認格式。
 */
export function isValidTaiwanTaxId(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += digitSum(digits[i] * TAX_ID_WEIGHTS[i]);
  }
  if (sum % 10 === 0) return true;
  if (digits[6] === 7 && (sum + 1) % 10 === 0) return true;
  return false;
}
