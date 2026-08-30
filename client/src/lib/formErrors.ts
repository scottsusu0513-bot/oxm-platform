/**
 * 財務優化／ISO／ERP／短影音四個服務的申請表與顧問／管理員 mutation 共用的
 * 表單錯誤訊息 helper。
 *
 * 背景：server 端 zod input schema 驗證失敗時，tRPC（本專案沒有自訂
 * errorFormatter，走預設行為）會把整包 ZodError issues 陣列序列化進
 * `error.message`（Zod v4 issue 範例：
 * `[{"origin":"string","code":"too_big","maximum":100,...}]`），四個服務的
 * 表單原本一律 `toast.error(err.message)`，等於把這段技術性 JSON 直接丟給
 * 一般使用者看。
 *
 * 設計取捨：不去猜測每一種 Zod code 對應的欄位語意，而是先看 issue 本身的
 * `message` 是不是已經是專案自己在 schema 裡寫好的中文提示（`.refine()` 的
 * 自訂訊息、`.regex(pattern, "電話格式不正確")` 這類自訂訊息）——只要包含
 * 中文字，直接照樣顯示，不覆蓋掉這些原本就寫得很好的訊息；只有真正沒有
 * 自訂訊息、Zod 自動生成的英文技術訊息（例如純 `.max(100)`／`.min(1)` 沒帶
 * 訊息參數）才轉換成下面這幾種通用中文提示。這樣不用維護一份「每個欄位
 * 名稱對應中文說明」的巨大對照表，也不會誤蓋掉既有的好訊息。
 */

interface ZodIssueLike {
  code?: string;
  message?: string;
  path?: (string | number)[];
}

const CJK_PATTERN = /[一-鿿]/;

const ZOD_CODE_FALLBACK_MESSAGES: Record<string, string> = {
  too_big: "輸入內容過長，請縮短後再試。",
  too_small: "請確認必填欄位皆已填寫。",
  invalid_type: "請確認必填欄位皆已填寫。",
  invalid_string: "格式不正確，請重新確認。",
  invalid_enum_value: "選擇的項目無效，請重新選擇。",
  invalid_value: "選擇的項目無效，請重新選擇。",
  invalid_union: "選擇的項目無效，請重新選擇。",
};

/** 嘗試把一段字串解析成 Zod issues 陣列；不是這個形狀就回傳 null。 */
function tryParseZodIssues(message: string): ZodIssueLike[] | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(
      (i): i is ZodIssueLike => !!i && typeof i === "object" && typeof (i as ZodIssueLike).code === "string",
    )) {
      return parsed;
    }
  } catch {
    // 不是合法 JSON，就不是 Zod issues 陣列。
  }
  return null;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

/**
 * 把 tRPC mutation 的 onError 錯誤轉成適合直接顯示給一般使用者的中文訊息。
 *
 * - server 端已經明確寫好中文訊息的情況（TRPCError({ message: "..." })、
 *   zod `.refine()`／`.regex()` 自訂訊息）：原樣顯示，不覆蓋。
 * - server 端 zod 驗證失敗但沒有自訂訊息（純技術性英文訊息／raw JSON）：
 *   依 Zod issue code 對應成通用中文提示。
 * - 其他無法辨識的情況：使用呼叫端提供的 fallbackMessage。
 */
export function getFriendlyFormError(error: unknown, fallbackMessage = "送出失敗，請稍後再試。"): string {
  const rawMessage = extractMessage(error);
  if (!rawMessage) return fallbackMessage;

  const issues = tryParseZodIssues(rawMessage);
  if (issues) {
    const first = issues[0];
    if (first.message && CJK_PATTERN.test(first.message)) return first.message;
    if (first.code && ZOD_CODE_FALLBACK_MESSAGES[first.code]) return ZOD_CODE_FALLBACK_MESSAGES[first.code];
    return fallbackMessage;
  }

  // 非 Zod raw JSON——多半是 server 端已經明確寫好的安全中文訊息
  // （TRPCError 的 message），或本來就是可以直接顯示的一般錯誤，原樣顯示。
  if (CJK_PATTERN.test(rawMessage)) return rawMessage;
  return fallbackMessage;
}
