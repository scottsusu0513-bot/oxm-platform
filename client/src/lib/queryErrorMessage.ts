/**
 * 查詢失敗時給使用者看的中文訊息：429 顯示「請求較多」，其他（500、網路中斷
 * 等）一律「載入失敗」。刻意不顯示 error.message——那可能是伺服器端的技術
 * 訊息，不該直接暴露給使用者。
 */
export const RATE_LIMITED_MESSAGE = "目前請求較多，請稍後再試";
export const GENERIC_LOAD_FAILED_MESSAGE = "載入失敗，請重新嘗試";

type ErrorWithData = { data?: { code?: unknown; httpStatus?: unknown } | null } | null | undefined;

function errorData(error: unknown) {
  return (error as ErrorWithData)?.data ?? null;
}

export function isRateLimitedError(error: unknown): boolean {
  const data = errorData(error);
  return data?.httpStatus === 429 || data?.code === "TOO_MANY_REQUESTS";
}

export function getQueryErrorMessage(error: unknown): string {
  return isRateLimitedError(error) ? RATE_LIMITED_MESSAGE : GENERIC_LOAD_FAILED_MESSAGE;
}

/**
 * 4xx（含 429）重試只會再失敗或加重限流，直接交給錯誤畫面的「重新嘗試」；
 * 5xx／網路錯誤維持最多重試 2 次。
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = errorData(error)?.httpStatus;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return failureCount < 2;
}
