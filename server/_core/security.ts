import { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { ENV } from "./env";

/**
 * 安全 headers middleware
 *
 * Phase 7.3（見對話中「LAN Development Security」root cause）：helmet 的
 * Content-Security-Policy 預設會加上 upgrade-insecure-requests——這個指令會
 * 讓瀏覽器把頁面上所有子資源請求自動改寫成 https。正式站全站本來就是
 * https，這條指令保留完全沒有影響；但本機開發用 plain http 提供服務，這條
 * 指令會讓瀏覽器把 /@vite/client、/src/main.tsx 等改寫成不存在的
 * https://<host>:3000/...，導致整個 React app 完全無法載入。只有
 * localhost／127.0.0.1 因為瀏覽器把 loopback 視為天生可信任（potentially
 * trustworthy origin）才沒觸發這個改寫，LAN IP 真機測試會直接整頁壞掉、只
 * 剩 prerender fallback 文字（見對話中的 root cause 診斷）。HSTS
 * （Strict-Transport-Security）是同一類問題：告訴瀏覽器「這個 host 以後
 * 永遠只能用 https 連」，本機開發用 plain http 提供服務不該送出這個
 * header。兩者都只在 ENV.isProduction 為 true 時維持原本設定，非正式環境
 * 明確關閉，不影響正式站安全策略；沿用專案既有的 ENV.isProduction
 * （server/_core/env.ts）判斷方式，不新增第二套環境判斷。
 */
export function setupSecurityHeaders(app: Express) {
  // Helmet 基礎安全 headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "fonts.googleapis.com"],
        // blob: 用於瀏覽器端 URL.createObjectURL()——找消息後台選擇封面圖片後、
        // 儲存草稿真正上傳前的本機預覽（見 AdminNews.tsx 的 stagedCoverPreviewUrl），
        // 檔案來源是使用者自己選的本機檔案，不是外部網址，允許 blob: 不會擴大
        // 任何跨站資源注入風險。
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "data:", "https:", "fonts.gstatic.com"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        // 只在正式環境維持 helmet 預設的 upgrade-insecure-requests；非正式
        // 環境明確設 null 關閉（helmet 文件記載的標準關閉寫法），讓本機
        // plain http 開發（含 LAN IP 真機測試）的子資源請求不被改寫成 https。
        upgradeInsecureRequests: ENV.isProduction ? [] : null,
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    noSniff: true,
    xssFilter: true,
    // 正式環境維持原本 HSTS 設定；非正式環境關閉，本機 plain http 開發不
    // 應該送出「以後永遠只能用 https」這個長效指示。
    hsts: ENV.isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  }));

  // 自訂安全 headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    // 這裡原本跟上面 helmet 的 hsts 選項重複設定同一個 header——保留正式站
    // 既有行為不變，但同樣需要依環境關閉，否則即使 helmet 的 hsts 選項被
    // 關掉，這裡仍會在非正式環境送出 Strict-Transport-Security。
    if (ENV.isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    next();
  });
}

/**
 * 隱藏預覽頁 noindex header：只針對明確列出的 route 精準比對（req.path 完全
 * 相等，不是前綴比對，避免波及其他頁面），加上
 * X-Robots-Tag: noindex, nofollow, noarchive, nosnippet。這是除了頁面內
 * `<meta name="robots">` 之外的第二層防線——即使爬蟲不執行 JS 也能看到這個
 * HTTP header。刻意不透過 robots.txt Disallow 排除這些路徑：一旦被
 * Disallow，爬蟲根本不會抓取頁面，也就看不到這裡的 noindex 指令，反而更難
 * 讓已索引的頁面被移除索引。绝不可把這個清單擴大到整個網站（例如用萬用字元
 * 比對 `/`），只能是明確列出的隱藏預覽頁 path。
 */
const NOINDEX_EXACT_PATHS = new Set<string>([
  "/certification-center", "/certification-center/apply",
  "/erp-optimization", "/erp-optimization/apply",
  "/short-video-marketing", "/short-video-marketing/apply",
]);

/**
 * 七大主入口的「準備開放中」Coming Soon 頁（找人才 /talent、找形象 /brand、
 * 找討論 /community，見 client/src/components/SectionComingSoon.tsx）：跟
 * 上面完全隱藏的預覽頁不同，這三頁本身是正式主要入口、有真實品牌內容與
 * 清楚頁面目的，只是文案篇幅較短、尚未有正式功能——只需要暫時 noindex，但
 * 仍允許爬蟲追蹤頁面上的連結（follow），不像上面的隱藏預覽頁需要完全
 * nofollow/noarchive/nosnippet。日後正式開放、內容補齊後，只要從這個清單
 * 移除即可恢復索引，不需要改動其他地方。
 *
 * /community 只精準比對 bare path，不影響 /community/:spaceCode/... 等子
 * 路徑——那些子路徑目前只有 canAccessCommunity() 允許的使用者才能實際看到
 * 內容，且未被任何公開連結或 sitemap 曝光。
 */
const NOINDEX_FOLLOW_EXACT_PATHS = new Set<string>([
  "/talent",
  "/brand",
  "/community",
]);

export function setupNoIndexRoutes(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (NOINDEX_EXACT_PATHS.has(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    } else if (NOINDEX_FOLLOW_EXACT_PATHS.has(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, follow");
    }
    next();
  });
}

/**
 * Origin 檢查 middleware（CSRF 防護）
 */
export function setupOriginCheck(app: Express) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && allowedOrigins.length === 0) {
    console.warn("[security] WARNING: ALLOWED_ORIGINS is not set in production. All cross-origin requests will be blocked.");
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    const isSameOrigin = (o: string) => {
      try {
        return new URL(o).host === req.get("host");
      } catch {
        return false;
      }
    };

    const isOriginAllowed = (o: string) => {
      if (isSameOrigin(o)) return true;
      if (allowedOrigins.length === 0) return !isProd;
      return allowedOrigins.includes(o);
    };

    // 設定 CORS headers：只反射白名單內的 origin
    if (origin && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    // 處理 OPTIONS 預檢請求
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    // 只檢查 POST/PUT/DELETE 請求
    if (["POST", "PUT", "DELETE"].includes(req.method)) {
      // Apple Sign in with Apple uses response_mode=form_post, so Apple's server
      // POSTs to our callback from appleid.apple.com. The route is already
      // CSRF-protected by the DB-validated state parameter — skip origin check.
      if (req.path === "/api/oauth/apple/callback") {
        return next();
      }
      if (origin && !isOriginAllowed(origin)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
      if (referer && allowedOrigins.length > 0) {
        try {
          const refererOrigin = new URL(referer).origin;
          if (!isSameOrigin(refererOrigin) && !allowedOrigins.includes(refererOrigin)) {
            return res.status(403).json({ error: "Referer not allowed" });
          }
        } catch {
          return res.status(403).json({ error: "Invalid referer" });
        }
      }
    }

    next();
  });
}

/**
 * 圖片上傳驗證。maxBytes 預設 5MB，維持既有所有呼叫端目前的行為不變；
 * 找消息封面／內文圖片需要 10MB 上限，會明確傳入這個參數覆蓋預設值。
 */
export async function validateImageUpload(file: Buffer, maxBytes = 5 * 1024 * 1024): Promise<{ valid: boolean; error?: string }> {
  if (!file || file.length === 0) {
    return { valid: false, error: "檔案為空" };
  }

  if (file.length > maxBytes) {
    return { valid: false, error: `檔案大小超過 ${Math.round(maxBytes / (1024 * 1024))}MB` };
  }

  // 檢查 magic number
  const validMagicNumbers = [
    { magic: Buffer.from([0xFF, 0xD8, 0xFF]), type: "JPEG" },
    { magic: Buffer.from([0x89, 0x50, 0x4E, 0x47]), type: "PNG" },
    { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]), type: "WEBP" }, // RIFF
  ];

  const isValid = validMagicNumbers.some(({ magic }) => {
    return file.slice(0, magic.length).equals(magic);
  });

  if (!isValid) {
    return { valid: false, error: "不支持的圖片格式，僅支持 JPG、PNG、WEBP" };
  }

  return { valid: true };
}
