import type { Express, NextFunction, Request, Response } from "express";

/**
 * 靜態資源請求判斷：/assets/ 底下的任何檔案，或帶有常見靜態檔副檔名的路徑。
 *
 * 這類請求在 express.static 找不到檔案時必須回真正的 404，絕不能落到 SPA
 * fallback 回 200 + index.html——否則部署後持有舊 HTML 的使用者／爬蟲動態
 * import 舊 chunk hash 時會拿到 text/html，模組載入失敗後整頁變成 ErrorBoundary
 * 的「發生錯誤，請重新整理頁面」（正式站 audit 實測 /assets/*.js 回 200
 * text/html）。
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "css", "map", "json", "txt", "xml", "webmanifest",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp4", "webm", "mp3", "wav", "pdf", "wasm", "zip",
]);

export function isStaticAssetRequestPath(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) return false;
  return STATIC_ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/** 必須註冊在 express.static 之後、SPA catch-all 之前。 */
export function setupStaticAssetMiss404(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isStaticAssetRequestPath(req.path)) return next();
    res.status(404).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("Not Found");
  });
}

const NOINDEX_FOLLOW_META = `<meta name="robots" content="noindex,follow" data-oxm-not-found="true">`;

/** 未知路由的 SPA shell：注入 noindex,follow（React 端 NotFound 頁照常渲染）。 */
export function injectNotFoundNoIndex(html: string): string {
  if (html.includes('data-oxm-not-found="true"')) return html;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `  ${NOINDEX_FOLLOW_META}\n  </head>`)
    : `${NOINDEX_FOLLOW_META}${html}`;
}
