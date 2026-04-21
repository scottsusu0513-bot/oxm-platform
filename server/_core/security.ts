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
        imgSrc: ["'self'", "data:", "https:"],
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
 * 圖片上傳驗證
 */
export async function validateImageUpload(file: Buffer): Promise<{ valid: boolean; error?: string }> {
  if (!file || file.length === 0) {
    return { valid: false, error: "檔案為空" };
  }

  // 檢查大小 (5MB)
  if (file.length > 5 * 1024 * 1024) {
    return { valid: false, error: "檔案大小超過 5MB" };
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
