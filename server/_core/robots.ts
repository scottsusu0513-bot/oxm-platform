import type { Express, NextFunction, Request, Response } from "express";

/**
 * robots.txt 內容。
 *
 * /api/trpc/ 必須允許抓取：公開頁（工廠詳情、商品、搜尋結果、SEO landing
 * page 的工廠清單）都是 React 透過 tRPC 取資料，Googlebot 渲染頁面時會遵守
 * robots.txt，被 Disallow 的 fetch 根本不會送出——先前 `Disallow: /api/trpc`
 * 讓爬蟲渲染出來的工廠頁全部變成「找不到此工廠」。
 *
 * Google 採「最長路徑優先」：`Allow: /api/trpc/` 比 `Disallow: /api` 長，
 * 因此只放行 tRPC，其餘 /api（OAuth callback、cron、logout 等）維持禁止。
 * API 回應本身不應出現在搜尋結果，由 setupApiNoIndexHeader 的
 * X-Robots-Tag: noindex 處理（noindex 只影響「這個 URL 是否被索引」，不影響
 * Googlebot 在渲染 HTML 頁面時使用它的回應）。
 */
export const ROBOTS_TXT =
  "User-agent: *\n" +
  "Allow: /\n" +
  "\n" +
  "Disallow: /admin\n" +
  "Disallow: /admin/\n" +
  "Disallow: /admin-message\n" +
  "Disallow: /messages\n" +
  "Disallow: /chat\n" +
  "Disallow: /dashboard\n" +
  "Disallow: /register-factory\n" +
  "Disallow: /favorites\n" +
  "Disallow: /member\n" +
  "Disallow: /orders\n" +
  "Disallow: /notifications\n" +
  "Disallow: /verify-email\n" +
  "Allow: /api/trpc/\n" +
  "Disallow: /api\n" +
  "\n" +
  "Sitemap: https://www.oxmmatch.com/sitemap.xml\n";

/** 所有 /api 回應一律 X-Robots-Tag: noindex，避免 API 網址本身被收錄。 */
export function setupApiNoIndexHeader(app: Express) {
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Robots-Tag", "noindex");
    next();
  });
}
