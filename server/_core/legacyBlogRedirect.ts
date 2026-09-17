import { Express, Request, Response, NextFunction } from "express";
import { resolveLegacyBlogRedirect } from "@shared/seo/libraryPages";

/**
 * 舊 /blog/:slug → 新 /library/:slug 301 永久轉址（見任務定案「傳產圖書館
 * Phase 1 實作」）。只有 3 筆有對應新文章的舊 slug 會被轉走（見
 * shared/seo/libraryPages.ts 的 resolveLegacyBlogRedirect），其餘所有
 * /blog/* 路徑（含任何已不存在的舊 slug）完全不受這個 middleware 影響，
 * next() 交給下一個 middleware 處理。
 *
 * 必須註冊在 server/_core/goneRoutes.ts 的 setupGoneRoutes(app) 之前
 * （見 server/_core/index.ts 的呼叫順序）：goneRoutes 對整個 /blog 與
 * /blog/* 前綴一律攔截回 410，如果這個 middleware 註冊在它之後，這 3 筆
 * mapping 永遠不會被執行到（goneRoutes 會先攔截並直接 res.send()，不呼叫
 * next()）。兩個 middleware 都是在任何 SPA fallback（setupVite／
 * serveStatic）之前就註冊，因此 dev／prod 兩種啟動模式共用同一套順序，
 * 不需要分別在 vite.ts 的 dev/prod 分支各自處理一次。
 *
 * 查詢字串：這 3 篇舊文章網址沒有任何功能性 query（不是分頁頁面），因此
 * 不轉發 query string，直接捨棄（與 resolveLegacySubIndustryRedirect 對
 * Phase 1 子產業頁的既有行為一致）。
 */
export function setupLegacyBlogRedirect(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const pathname = req.path;
    const target = resolveLegacyBlogRedirect(pathname);
    if (!target) return next();
    res.redirect(301, target);
  });
}
