/**
 * 工廠「官方網站」欄位 → 可安全放進 <a href> 的外部網址（見對話「FactoryResultCard
 * nested <a> / href="無"」）。
 *
 * factories.website 是自由輸入字串（FactoryRegister／FactoryDashboard 直接送出、
 * server 只驗 z.string()），實際資料包含「無」這類 placeholder；也可能有人只填
 * 「example.com」「www.example.com」。規則：
 *   - null／undefined／空字串／純空白 → null。
 *   - placeholder（沿用 FactoryDetailView 原本 isValidUrl 已經在處理的值：
 *     「無」「N/A」「-」，大小寫不敏感）→ null。
 *   - http:// 或 https:// 開頭 → 驗證後原樣保留（去頭尾空白）。
 *   - 其他 scheme（javascript:、data:、mailto:、ftp: …）→ null。
 *   - 沒有 scheme → 補成 https://。
 *   - 解析失敗、或 hostname 不含「.」（例如「https://無」「localhost」）→ null。
 * 回傳 null 代表「沒有有效網站」，呼叫端不得產生可點擊連結。
 */
const WEBSITE_PLACEHOLDERS = new Set(["無", "n/a", "-"]);

// scheme 後面緊接數字的是「host:port」（例如 example.com:8080），不是 scheme。
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const HTTP_SCHEME = /^https?:\/\//i;

export function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || WEBSITE_PLACEHOLDERS.has(value.toLowerCase())) return null;
  if (/\s/.test(value)) return null;

  let candidate: string;
  if (HTTP_SCHEME.test(value)) {
    candidate = value;
  } else if (OTHER_SCHEME.test(value) || value.startsWith("//")) {
    return null;
  } else {
    candidate = `https://${value}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
  } catch {
    return null;
  }
  return candidate;
}
