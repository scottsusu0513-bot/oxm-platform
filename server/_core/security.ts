import { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";

/**
 * 安全 headers middleware
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
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    noSniff: true,
    xssFilter: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  // 自訂安全 headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
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
