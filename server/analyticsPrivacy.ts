/**
 * Analytics 2.0 隱私邊界（Batch 3.12）。
 *
 * 前端送來的 queryString／referrer 原本原樣寫入 DB（最多 1000／2000 字）。站內部分
 * 網址的 querystring 帶有一次性憑證或識別碼（email 驗證 token、App 登入 ticket、帳號
 * 連結 link、OAuth code／state、AI handoff id…），外站 referrer 也可能夾帶對方網站的
 * 參數——這些都不該進入分析資料。改為：
 *   - queryString：只保留明確列入白名單、對分析有意義的參數（搜尋條件、分頁、UTM）
 *   - referrer：只保留 origin＋pathname（去掉 query／fragment／帳密），非 http(s) 丟棄
 *   - filters：只保留少量、原始型別的值，避免任意大物件
 * 在 server 端統一處理，舊版／被竄改的前端也無法繞過。
 */
export const ANALYTICS_QUERY_PARAM_ALLOWLIST: ReadonlySet<string> = new Set([
  "q", "keyword", "industry", "subIndustry", "region", "category", "businessType", "mfgMode",
  "capitalLevel", "sortBy", "sort", "page", "sample", "smallBatch", "aiSearch", "tab",
  "factoryId", "productId",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

const MAX_PARAM_VALUE_LENGTH = 200;

export function sanitizeAnalyticsQueryString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  let params: URLSearchParams;
  try { params = new URLSearchParams(qs); } catch { return null; }
  const kept = new URLSearchParams();
  params.forEach((value, key) => {
    if (ANALYTICS_QUERY_PARAM_ALLOWLIST.has(key)) kept.append(key, value.slice(0, MAX_PARAM_VALUE_LENGTH));
  });
  const out = kept.toString();
  // 保留呼叫端原本的格式（前端送 location.search，帶 "?"）
  return out ? `${raw.startsWith("?") ? "?" : ""}${out}`.slice(0, 1000) : null;
}

export function sanitizeReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.origin}${url.pathname}`.slice(0, 500);
}

const MAX_FILTER_KEYS = 20;
const MAX_FILTER_ARRAY = 20;

export function sanitizeAnalyticsFilters(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw).slice(0, MAX_FILTER_KEYS)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_PARAM_VALUE_LENGTH);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    else if (Array.isArray(value)) {
      out[key] = value.filter(v => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))
        .slice(0, MAX_FILTER_ARRAY)
        .map(v => (typeof v === "string" ? v.slice(0, MAX_PARAM_VALUE_LENGTH) : v));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
