import { Express, Request, Response, NextFunction } from "express";

/**
 * 永久移除（HTTP 410 Gone）的路徑。
 *
 * 這裡列出的內容是「主動、永久下架，且沒有真正等價的替代頁面」——所以不
 * redirect（到 /search 或首頁都不算等價內容）、不回 200 soft-404，直接回
 * 410，讓搜尋引擎明確知道此 URL 內容已永久移除、可以從索引移除。
 *
 * 目前唯一項目：原「找代工指南」Blog。涵蓋 /blog 列表頁與所有 /blog/* 舊
 * 文章路徑（含已不存在的舊 slug）。比對限定在 /blog 本身與 /blog/ 開頭，
 * 不會波及任何其他路由——一般不存在的路由仍走既有 SPA fallback 行為
 * （200 + 前端 NotFound 畫面），完全不受這裡影響。
 *
 * 若日後還有其他「曾公開、現在永久移除且無替代頁」的內容，往
 * GONE_PATH_PREFIXES 增加項目即可，不需另建第二套機制。
 */
const GONE_PATH_PREFIXES = ["/blog"] as const;

/** pathname 是否屬於「永久移除」路徑（bare path 或其子路徑）。 */
export function isGonePath(pathname: string): boolean {
  return GONE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * 410 頁面的完整 HTML。刻意做成不依賴 client/index.html 模板的獨立小頁：
 * - `<meta name="robots" content="noindex, nofollow">`：即使爬蟲不執行 JS
 *   也能辨識（再搭配下面 middleware 額外送出的 X-Robots-Tag HTTP header
 *   形成雙層 noindex）。
 * - 給人看的說明文字，以及回首頁／搜尋工廠的連結（是連結，不是 redirect）。
 */
export const GONE_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>內容已移除｜OXM</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans TC",sans-serif;background:#fafafa;color:#1f2937;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  main{max-width:480px;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .75rem}
  p{line-height:1.7;color:#4b5563;margin:0 0 1.5rem}
  a{display:inline-block;margin:0 .35rem;padding:.6rem 1.15rem;border-radius:9999px;background:linear-gradient(to right,#f97316,#f59e0b);color:#fff;text-decoration:none;font-weight:600;font-size:.95rem}
</style>
</head>
<body>
<main>
<h1>此頁面內容已永久移除</h1>
<p>「找代工指南」相關文章已於 OXM 下架，且不再提供。你可以直接前往 OXM 尋找台灣工廠與工作室。</p>
<a href="/">回首頁</a>
<a href="/search">搜尋工廠</a>
</main>
</body>
</html>
`;

/**
 * 在所有 SPA fallback（server/_core/vite.ts 的 setupVite／serveStatic 內的
 * `app.use("*", ...)`）之前攔截「永久移除」路徑，對 GET／HEAD 回 410 Gone。
 * 其他 HTTP method 或非清單路徑一律 next()，不改變任何既有行為。
 */
export function setupGoneRoutes(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isGonePath(req.path)) return next();
    res.status(410);
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("html").send(GONE_HTML);
  });
}
