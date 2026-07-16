import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { buildFactoryMeta, injectMetaIntoHtml, parseFactoryPath, stripQueryString } from "./ogMeta";
import { injectPublicPageSeo } from "./publicPageMeta";
import { injectPrerenderedBody } from "./prerenderedBody";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  // vite.config.ts 匯出的是 defineConfig((env) => {...}) 的函式形式（讓
  // isDev/command 判斷式能正確依 command 決定要不要加 dev-only 的
  // vitePluginManusDebugCollector()）。直接 `{...viteConfig}` 對一個函式做
  // spread 只會拿到空物件 {}（函式沒有自己的可列舉屬性），等於 root／
  // resolve.alias／plugins／build 全部被靜默丟棄，Vite 會退回預設把 root
  // 當成 process.cwd()（專案根目錄），導致完全解析不到實際在 client/ 底下
  // 的 client/src/main.tsx，dev server 對外看起來像是「main.tsx 找不到檔案」
  // ——這正是本機預覽出現純 HTML、Tailwind/React 都沒載入的根本原因。
  // 修正方式：若是函式形式，先呼叫它取得實際 config 物件，再展開。
  const resolvedViteConfig =
    typeof viteConfig === "function"
      ? await viteConfig({ command: "serve", mode: "development" })
      : viteConfig;

  const vite = await createViteServer({
    ...resolvedViteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      let page = await vite.transformIndexHtml(url, template);

      // /factory/:id gets factory-specific OG/Twitter meta injected so link
      // previews (LINE/FB/Threads/etc.) show the business, not the generic
      // site card. All other routes are untouched.
      // Note: req.path is not usable here — app.use("*", ...) mounts the
      // handler such that Express folds the whole matched path into
      // req.baseUrl, leaving req.path as just "/". Derive the pathname from
      // req.originalUrl instead.
      const pathname = stripQueryString(req.originalUrl);
      const factoryPath = parseFactoryPath(pathname);
      if (factoryPath) {
        const meta = await buildFactoryMeta(factoryPath.rawId, pathname);
        page = injectMetaIntoHtml(page, meta);
      } else {
        // 固定公開頁（目前為 "/" 與 "/about"）：不查資料庫，直接用
        // shared/seo 常數注入 title／description／canonical／OG／JSON-LD。
        // 其他路由（沒有專屬 SEO 設定）保留原本的 index.html 預設值不變。
        const seoPage = injectPublicPageSeo(page, pathname);
        if (seoPage !== null) page = seoPage;

        // GEO 第二階段 B：/about 額外把 build-time 產生的靜態正文片段塞進
        // <div id="root">，讓爬蟲不執行 JS 也能讀到主要正文。dev 環境若還沒
        // 跑過 pnpm build／pnpm prerender:about，片段檔案不存在時安全地回傳
        // null，不影響其餘行為。
        const bodyPage = injectPrerenderedBody(page, pathname);
        if (bodyPage !== null) page = bodyPage;
      }

      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // index: false — 否則 express.static 會在 "/" 直接自動吐出 index.html
  // （靠自己的 ETag/Last-Modified 邏輯），完全繞過下面的 catch-all，導致
  // "/" 永遠拿不到 SEO 注入。停用自動 index 後，"/" 一律落到 catch-all，
  // 由我們自己決定要不要注入、並統一走同一份快取字串。其他實際存在的靜態
  // 檔案（JS/CSS/圖片等）不受影響，仍由這個 middleware 正常提供。
  app.use(express.static(distPath, { index: false }));

  const indexPath = path.resolve(distPath, "index.html");

  // index.html 內容在 production 不會變（每次部署都是全新 build），啟動後
  // 第一次用到時讀一次、快取在記憶體裡，後續每個 request 只做輕量字串替換，
  // 不再重複打磁碟。factory／固定公開頁的注入都共用同一份快取字串。
  let cachedTemplate: string | null = null;
  async function getCachedTemplate(): Promise<string> {
    if (cachedTemplate === null) {
      cachedTemplate = await fs.promises.readFile(indexPath, "utf-8");
    }
    return cachedTemplate;
  }

  // fall through to index.html if the file doesn't exist
  app.use("*", async (req, res) => {
    // req.path is unusable under app.use("*", ...) — Express folds the
    // whole matched path into req.baseUrl, leaving req.path as "/". Derive
    // the pathname from req.originalUrl instead.
    const pathname = stripQueryString(req.originalUrl);

    // /factory/:id: inject factory-specific OG/Twitter meta into the same
    // static index.html before sending, so social crawlers (which don't run
    // the client bundle) see the business preview. Any failure here falls
    // straight back to the plain SPA file — never a 500.
    const factoryPath = parseFactoryPath(pathname);
    if (factoryPath) {
      try {
        const template = await getCachedTemplate();
        const meta = await buildFactoryMeta(factoryPath.rawId, pathname);
        const page = injectMetaIntoHtml(template, meta);
        res.status(200).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic factory meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // 固定公開頁（目前為 "/" 與 "/about"）：不查資料庫，直接用 shared/seo
    // 常數注入 title／description／canonical／OG／JSON-LD。其餘所有路由
    // （沒有專屬 SEO 設定的 SPA fallback）一律直接吐出同一份快取字串，不做
    // 任何字串處理，也不再重新命中磁碟；任何失敗才退回 res.sendFile 當最後
    // 保底。
    try {
      const template = await getCachedTemplate();
      let page = injectPublicPageSeo(template, pathname) ?? template;
      // GEO 第二階段 B：/about 額外把 build-time 產生的靜態正文片段塞進
      // <div id="root">，讓爬蟲不執行 JS 也能讀到主要正文；片段檔案不存在
      // （例如尚未執行過 pnpm build）時安全地略過，不影響其餘行為。
      const bodyPage = injectPrerenderedBody(page, pathname);
      if (bodyPage !== null) page = bodyPage;
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (err) {
      console.error(
        "[publicPageMeta] serveStatic public page SEO injection failed:",
        err instanceof Error ? err.message : String(err)
      );
      res.sendFile(indexPath);
    }
  });
}
