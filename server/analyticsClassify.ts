/**
 * Analytics 2.0 — human / known_bot / suspicious 分類（純函式，無 I/O，見
 * 對話中「Human / Known Bot / Suspicious 判定規格」）。
 *
 * 三層分類：
 *   human      — 沒有命中已知 bot、也沒有命中可疑訊號，行為在合理範圍內。
 *                不代表「100% 證明是真人」，只代表「沒有找到不是真人的證據」。
 *   known_bot  — User-Agent 明確命中已知爬蟲清單（見 KNOWN_BOTS）。
 *   suspicious — 無法證明是 bot，但多項訊號組合起來高度不像正常使用者。
 *                不得在 UI 顯示成「Bot」。
 *
 * 刻意不做：即時 ASN 反查、reverse DNS 驗證（見對話中「本輪不要做昂貴或
 * 高延遲的即時 DNS 驗證」）——這裡只做零延遲、純字串/數值運算的判斷。
 */

// ───────────────────────── User-Agent 解析 ─────────────────────────

export type DeviceType = "desktop" | "mobile" | "tablet" | "other";
export type BrowserName = "Chrome" | "Safari" | "Edge" | "Firefox" | "Other";
export type OsName = "iOS" | "Android" | "Windows" | "macOS" | "Linux" | "Other";
export type Platform = "web" | "ios_app" | "android_app" | "other";

export interface ParsedUserAgent {
  deviceType: DeviceType;
  browser: BrowserName;
  os: OsName;
}

/**
 * 輕量、手刻 regex 解析（沒有引入新的 npm 套件，跟本專案既有慣例一致——
 * 見 shared/subIndustryKeywordMatch.ts 的說明「只允許明確、無歧義的規則，
 * 不做大量手寫」）。這不是完整瀏覽器指紋系統，只求覆蓋主流 UA 字串。
 */
export function parseUserAgent(ua: string): ParsedUserAgent {
  const s = ua || "";

  let os: OsName = "Other";
  if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X/i.test(s) && !/iPhone|iPad|iPod/i.test(s)) os = "macOS";
  else if (/Linux/i.test(s)) os = "Linux";

  let browser: BrowserName = "Other";
  if (/EdgA?\//i.test(s)) browser = "Edge";
  else if (/Firefox\//i.test(s) && !/Seamonkey/i.test(s)) browser = "Firefox";
  else if (/Chrome\//i.test(s) && !/EdgA?\/|OPR\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s) && !/Chrome\/|Chromium\//i.test(s)) browser = "Safari";

  let deviceType: DeviceType = "other";
  if (/iPad|Tablet(?!.*Mobile)/i.test(s)) deviceType = "tablet";
  else if (/Mobi|iPhone|Android.*Mobile/i.test(s)) deviceType = "mobile";
  else if (/Windows NT|Macintosh|X11.*Linux/i.test(s)) deviceType = "desktop";

  return { deviceType, browser, os };
}

/** Capacitor App 偵測——client 端會在請求裡標示自己是 App（見
 * `client/src/lib/analyticsClient.ts` 的 `platform` 欄位），server 端這裡
 * 只是把 client 回報的值收斂成合法列舉，不信任任意字串。App 內的 WebView
 * UA 本身看起來就是一般行動瀏覽器 UA（Capacitor 沒有魔改 UA 字串），不能
 * 只靠 UA 判斷是不是 App——這正是「不要因為 WebView UA／沒有 referrer／
 * direct traffic 就誤判 suspicious」的原因，platform 必須由 client 明確
 * 回報，而不是用 UA 猜測。 */
export function normalizePlatform(raw: unknown): Platform {
  if (raw === "ios_app" || raw === "android_app" || raw === "web") return raw;
  return "other";
}

// ───────────────────────── Known bot 判定 ─────────────────────────

const KNOWN_BOTS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /Googlebot/i, name: "Googlebot" },
  { pattern: /bingbot/i, name: "Bingbot" },
  { pattern: /GPTBot/i, name: "GPTBot" },
  { pattern: /ChatGPT-User/i, name: "ChatGPT-User" },
  { pattern: /PerplexityBot/i, name: "PerplexityBot" },
  { pattern: /AhrefsBot/i, name: "AhrefsBot" },
  { pattern: /SemrushBot/i, name: "SemrushBot" },
  { pattern: /facebookexternalhit/i, name: "facebookexternalhit" },
  { pattern: /Twitterbot/i, name: "Twitterbot" },
  { pattern: /Applebot/i, name: "Applebot" },
  { pattern: /YandexBot/i, name: "YandexBot" },
  { pattern: /Baiduspider/i, name: "Baiduspider" },
];

/** 回傳命中的已知 bot 名稱，或 null（沒有命中）。刻意不用模糊的
 * `bot`/`crawler`/`spider` 關鍵字比對——那會誤傷一堆合法瀏覽器 UA 裡
 * 剛好包含類似字串的情況，只用明確列舉的清單（見對話中「不要只用非常
 * 模糊的 bot/crawler/spider 就直接封鎖」）。 */
export function matchKnownBot(ua: string): string | null {
  for (const { pattern, name } of KNOWN_BOTS) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

/** Automation / headless 工具特徵——這只是「加分訊號」的其中一項，不能
 * 單獨判定，見 computeSuspiciousScore。刻意不含 okhttp/axios/node-fetch
 * 這種行動 App 或一般 server-to-server SDK 常用、容易誤傷的字串。 */
const AUTOMATION_UA_PATTERNS: ReadonlyArray<RegExp> = [
  /HeadlessChrome/i,
  /Playwright/i,
  /Puppeteer/i,
  /Selenium/i,
  /PhantomJS/i,
  /^curl\//i,
  /^Wget\//i,
  /python-requests/i,
  /aiohttp/i,
];

export function hasAutomationUaSignature(ua: string): boolean {
  return AUTOMATION_UA_PATTERNS.some(p => p.test(ua));
}

// ───────────────────────── Referrer / UTM 來源分類 ─────────────────────────

export type SourceClassification =
  | "direct" | "app" | "google_organic" | "bing_organic" | "threads" | "facebook"
  | "instagram" | "line" | "chatgpt" | "perplexity" | "other_referral" | "unknown";

export interface ReferrerInput {
  referrer?: string | null;
  utmSource?: string | null;
  platform?: Platform;
}

/** 從 referrer/UTM 判斷流量來源分類。UTM 優先於 referrer 網域比對（使用者
 * 明確標記的行銷來源比瀏覽器自動帶的 referrer 更可信）。App 內導覽（沒有
 * `document.referrer`）明確標成 `app`，不是 `direct`，也不是 `unknown`——
 * 避免把 App 使用者的正常行為誤判成異常（見對話中「不要因為沒有 referrer
 * 就誤判成異常」）。 */
export function classifyReferrer(input: ReferrerInput): SourceClassification {
  const { referrer, utmSource, platform } = input;

  if (utmSource) {
    const u = utmSource.toLowerCase();
    if (u.includes("google")) return "google_organic";
    if (u.includes("bing")) return "bing_organic";
    if (u.includes("threads")) return "threads";
    if (u.includes("facebook") || u === "fb") return "facebook";
    if (u.includes("instagram") || u === "ig") return "instagram";
    if (u.includes("line")) return "line";
    if (u.includes("chatgpt") || u.includes("openai")) return "chatgpt";
    if (u.includes("perplexity")) return "perplexity";
    return "other_referral";
  }

  if (!referrer) {
    return platform === "ios_app" || platform === "android_app" ? "app" : "direct";
  }

  let host = "";
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (host.includes("oxmmatch.com")) return "direct"; // 站內導覽不算外部來源
  if (/(^|\.)google\./.test(host)) return "google_organic";
  if (/(^|\.)bing\.com$/.test(host)) return "bing_organic";
  if (/(^|\.)threads\.net$/.test(host)) return "threads";
  if (/(^|\.)facebook\.com$/.test(host) || host === "fb.me") return "facebook";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)line\.me$/.test(host)) return "line";
  if (/(^|\.)chatgpt\.com$/.test(host) || /(^|\.)openai\.com$/.test(host)) return "chatgpt";
  if (/(^|\.)perplexity\.ai$/.test(host)) return "perplexity";
  return "other_referral";
}

export function extractReferrerHost(referrer?: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ───────────────────────── Suspicious score ─────────────────────────

/** 見對話中「Suspicious Score」——訊號 → 分數，0～100，非單一 boolean
 * 規則。分數本身跟權重都保留在回傳值裡（signals/score），方便未來 debug
 * 與調整權重，不是黑箱判定。 */
export interface SuspiciousSignalInput {
  automationUa: boolean;
  /** 同 ipHash 短時間（例如 5 分鐘）建立的 distinct visitorId 數。 */
  newVisitorIdsPerIpRecent: number;
  /** 同 ipHash 短時間（例如 1 分鐘）觸發的搜尋次數。 */
  searchesPerIpRecent: number;
  /** 是否偵測到固定節奏（事件間隔變異極低）。 */
  fixedIntervalPattern: boolean;
  /** 這個 session 目前為止，事件數 > 1 的 session 佔該來源全部 session 的比例
   *  是否偏低（大量 session 都只有單一事件）——由呼叫端預先算好的 boolean。 */
  mostlySingleEventSessions: boolean;
  /** 短時間內重複相同關鍵字搜尋的次數。 */
  repeatedQueryCount: number;
  /** 是否偵測到 factoryId 系統性枚舉（連續遞增/固定間隔造訪不同工廠頁）。 */
  factoryEnumeration: boolean;
  /** ASN 是否為常見雲端資料中心（本輪沒有 ASN 資料來源時一律 false，見
   *  對話中「不要做昂貴的即時 DNS/ASN 驗證」）。 */
  cloudAsn: boolean;
}

export type SuspiciousLevel = "human" | "suspicious_low" | "suspicious_medium" | "suspicious_high";

export interface SuspiciousResult {
  score: number;
  level: SuspiciousLevel;
  signals: string[];
}

/** 權重方向沿用對話中的建議，僅供參考、非固定死——保留在常數區塊方便未來
 * 調整，不散落在計算邏輯裡。 */
const WEIGHTS = {
  AUTOMATION_UA: 40,
  HIGH_NEW_VISITOR_RATE: 30, // 同 IP 5 分鐘 > 20 個新 visitorId
  SEARCH_RATE_SPIKE: 25, // 同 IP 1 分鐘大量搜尋
  FIXED_INTERVAL_REQUESTS: 15,
  MOSTLY_SINGLE_EVENT_SESSIONS: 10,
  REPEATED_QUERY: 15,
  FACTORY_ENUMERATION: 25,
  CLOUD_ASN: 10,
} as const;

const NEW_VISITOR_THRESHOLD = 20;
const SEARCH_RATE_THRESHOLD = 15;
const REPEATED_QUERY_THRESHOLD = 3;

export function computeSuspiciousScore(input: SuspiciousSignalInput): SuspiciousResult {
  let score = 0;
  const signals: string[] = [];

  if (input.automationUa) {
    score += WEIGHTS.AUTOMATION_UA;
    signals.push("AUTOMATION_UA");
  }
  if (input.newVisitorIdsPerIpRecent > NEW_VISITOR_THRESHOLD) {
    score += WEIGHTS.HIGH_NEW_VISITOR_RATE;
    signals.push("HIGH_NEW_VISITOR_RATE");
  }
  if (input.searchesPerIpRecent > SEARCH_RATE_THRESHOLD) {
    score += WEIGHTS.SEARCH_RATE_SPIKE;
    signals.push("SEARCH_RATE_SPIKE");
  }
  if (input.fixedIntervalPattern) {
    score += WEIGHTS.FIXED_INTERVAL_REQUESTS;
    signals.push("FIXED_INTERVAL_REQUESTS");
  }
  if (input.mostlySingleEventSessions) {
    score += WEIGHTS.MOSTLY_SINGLE_EVENT_SESSIONS;
    signals.push("MOSTLY_SINGLE_EVENT_SESSIONS");
  }
  if (input.repeatedQueryCount >= REPEATED_QUERY_THRESHOLD) {
    score += WEIGHTS.REPEATED_QUERY;
    signals.push("REPEATED_QUERY");
  }
  if (input.factoryEnumeration) {
    score += WEIGHTS.FACTORY_ENUMERATION;
    signals.push("FACTORY_ENUMERATION");
  }
  if (input.cloudAsn) {
    score += WEIGHTS.CLOUD_ASN;
    signals.push("CLOUD_ASN");
  }

  score = Math.min(100, score);

  let level: SuspiciousLevel;
  if (score >= 80) level = "suspicious_high";
  else if (score >= 60) level = "suspicious_medium";
  else if (score >= 30) level = "suspicious_low";
  else level = "human";

  return { score, level, signals };
}

/** Dashboard／完整 Analytics 顯示用的三層彙總（見對話中「Dashboard 可以
 * 統一顯示可疑流量，完整 Analytics 才細分」）。known_bot 永遠優先於
 * suspicious score（已經明確識別出是哪個已知 bot，不需要再算可疑分數）。 */
export type FinalClassification = "human" | "known_bot" | "suspicious";

export function finalizeClassification(knownBotName: string | null, suspiciousLevel: SuspiciousLevel): FinalClassification {
  if (knownBotName) return "known_bot";
  if (suspiciousLevel !== "human") return "suspicious";
  return "human";
}
