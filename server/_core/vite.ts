import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { buildFactoryMeta, buildNewsMeta, buildRegionIndustryMeta, injectMetaIntoHtml, parseFactoryPath, parseNewsPath, stripQueryString, extractQueryString, DEFAULT_OG_IMAGE } from "./ogMeta";
import { injectPublicPageSeo } from "./publicPageMeta";
import { injectPrerenderedBody, injectDynamicSemanticBody } from "./prerenderedBody";
import { parseIndustryPath, buildIndustryPageMeta } from "@shared/seo/industryPages";
import { parseRegionIndustryPath, resolveRegionIndustry, buildRegionIndustryPageContent } from "@shared/seo/regionIndustryPages";
import { buildSearchPageMeta } from "@shared/seo/searchPage";

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
      let statusCode = 200;
      if (factoryPath) {
        const meta = await buildFactoryMeta(factoryPath.rawId, pathname);
        statusCode = meta.status;
        page = injectMetaIntoHtml(page, meta);
      } else if (pathname === "/search") {
        // /search：純字串查表（無 DB），無參數可索引並自我 canonical，帶任何
        // 篩選參數一律 noindex,follow——原始 HTML 就要有這個結果，不能只靠
        // client 端 Helmet（那樣 Googlebot 沒執行 JS 就看不到 noindex）。
        // title／description／noindex 公式與 client 端 Search.tsx 共用同一份
        // shared/seo/searchPage.ts，見該檔案內的說明。
        const searchMeta = buildSearchPageMeta(extractQueryString(req.originalUrl));
        page = injectMetaIntoHtml(page, {
          title: searchMeta.title,
          description: searchMeta.description,
          image: DEFAULT_OG_IMAGE,
          url: searchMeta.canonical,
          status: 200,
          noindex: searchMeta.noindex,
        });
        // GEO Phase 3A：固定的 H1＋intro 語意殼（不含搜尋結果），所有查詢
        // 參數組合都注入同一份 build-time 片段，見 scripts/prerender-search.ts。
        const searchBodyPage = injectPrerenderedBody(page, pathname);
        if (searchBodyPage !== null) page = searchBodyPage;
      } else if (parseNewsPath(pathname)) {
        // /news/:slug 個別消息頁：DB-backed，與工廠頁共用同一套 marker-based
        // 注入函式，額外多帶 ogType="article" 與 NewsArticle JSON-LD。找不到
        // （不存在／草稿／已下架，getPublishedNewsBySlug 已經在 DB 層統一過濾
        // 成同一種「找不到」)一律 404 + noindex，不洩漏是哪一種狀態。
        const newsMeta = await buildNewsMeta(parseNewsPath(pathname)!.slug, pathname);
        statusCode = newsMeta.status;
        page = injectMetaIntoHtml(page, newsMeta);
      } else if (parseRegionIndustryPath(pathname)) {
        // /factories/:region/:industry：地區 × 主產業 SEO Landing Page。
        // DB-backed（是否至少 1 家 approved 公開工廠），與工廠頁／消息頁共用
        // 同一套 marker-based 注入函式；無效 region／industry slug 一律真
        // 404，合法但目前 0 筆結果一律 200+noindex（不是 404，見任務定案
        // 「三種頁面狀態」）。額外把固定 H1＋intro 語意殼動態注入
        // <div id="root">——這條路由是 22×13＝286 種組合，不適合比照
        // /search／/about 那樣為每個組合各自跑一支 build-time prerender
        // script，改成 request-time 直接算字串注入（純字串處理，不執行
        // renderToString）。
        const { regionSlug, industrySlug } = parseRegionIndustryPath(pathname)!;
        const regionIndustryMeta = await buildRegionIndustryMeta(regionSlug, industrySlug, pathname);
        statusCode = regionIndustryMeta.status;
        page = injectMetaIntoHtml(page, regionIndustryMeta);
        if (regionIndustryMeta.status === 200) {
          const resolved = resolveRegionIndustry(regionSlug, industrySlug);
          if (resolved) {
            const content = buildRegionIndustryPageContent(resolved);
            const bodyPage = injectDynamicSemanticBody(page, content.h1, content.intro, "region-industry");
            if (bodyPage !== null) page = bodyPage;
          }
        }
      } else {
        const industryPath = parseIndustryPath(pathname);
        const industryMeta = industryPath ? buildIndustryPageMeta(industryPath.slug, industryPath.subSlug) : null;
        if (industryMeta) {
          // /industry/:slug(/:sub)：純資料查表（無 DB），與工廠頁共用同一套
          // marker-based 注入函式，title／description／canonical 公式與
          // client 端 IndustryPage.tsx 的 Helmet 保持一致。slug 對不到任何
          // 已知產業時 industryMeta 為 null，落到下面的預設 index.html 不變。
          page = injectMetaIntoHtml(page, {
            title: industryMeta.title,
            description: industryMeta.description,
            image: DEFAULT_OG_IMAGE,
            url: industryMeta.canonical,
            status: 200,
            noindex: false,
          });
        } else {
          // 固定公開頁（目前為 "/"、"/about"、"/upgrade-center"）：不查資料庫，
          // 直接用 shared/seo 常數注入 title／description／canonical／OG／
          // JSON-LD。其他路由（沒有專屬 SEO 設定）保留原本的 index.html
          // 預設值不變。
          const seoPage = injectPublicPageSeo(page, pathname);
          if (seoPage !== null) page = seoPage;

          // GEO 第二階段 B：/about 額外把 build-time 產生的靜態正文片段塞進
          // <div id="root">，讓爬蟲不執行 JS 也能讀到主要正文。dev 環境若還沒
          // 跑過 pnpm build／pnpm prerender:about，片段檔案不存在時安全地回傳
          // null，不影響其餘行為。
          const bodyPage = injectPrerenderedBody(page, pathname);
          if (bodyPage !== null) page = bodyPage;
        }
      }

      res.status(statusCode).set({ "Content-Type": "text/html" }).end(page);
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
    // the client bundle) see the business preview. Also sets the real HTTP
    // status (200／404) from buildFactoryMeta so an invalid/missing/
    // non-approved factory id is a genuine 404, not a 200 with generic
    // fallback content (that combination is what Search Console reports as
    // a soft 404 — see server/factoryPageStatus.test.ts). Any *unexpected*
    // failure here (e.g. disk read error) still falls straight back to the
    // plain SPA file at 200 — never a 500, and never confused with the
    // intentional 404 path above.
    const factoryPath = parseFactoryPath(pathname);
    if (factoryPath) {
      try {
        const template = await getCachedTemplate();
        const meta = await buildFactoryMeta(factoryPath.rawId, pathname);
        const page = injectMetaIntoHtml(template, meta);
        res.status(meta.status).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic factory meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // /search：無參數可索引並自我 canonical，帶任何篩選參數一律
    // noindex,follow，原始 HTML（未執行 JS）就要有這個結果——見
    // shared/seo/searchPage.ts 與 client 端 Search.tsx 共用同一份規則。
    if (pathname === "/search") {
      try {
        const template = await getCachedTemplate();
        const searchMeta = buildSearchPageMeta(extractQueryString(req.originalUrl));
        let page = injectMetaIntoHtml(template, {
          title: searchMeta.title,
          description: searchMeta.description,
          image: DEFAULT_OG_IMAGE,
          url: searchMeta.canonical,
          status: 200,
          noindex: searchMeta.noindex,
        });
        // GEO Phase 3A：固定的 H1＋intro 語意殼（不含搜尋結果），所有查詢
        // 參數組合都注入同一份 build-time 片段，見 scripts/prerender-search.ts。
        const searchBodyPage = injectPrerenderedBody(page, pathname);
        if (searchBodyPage !== null) page = searchBodyPage;
        res.status(200).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic search meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // /news/:slug：DB-backed，與工廠頁共用同一套 marker-based 注入函式，
    // 額外多帶 ogType="article" 與 NewsArticle JSON-LD。找不到（不存在／
    // 草稿／已下架，getPublishedNewsBySlug 已經在 DB 層統一過濾成同一種
    // 「找不到」)一律 404 + noindex，不洩漏是哪一種狀態。
    const newsPath = parseNewsPath(pathname);
    if (newsPath) {
      try {
        const template = await getCachedTemplate();
        const meta = await buildNewsMeta(newsPath.slug, pathname);
        const page = injectMetaIntoHtml(template, meta);
        res.status(meta.status).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic news meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // /factories/:region/:industry：地區 × 主產業 SEO Landing Page，
    // DB-backed（是否至少 1 家 approved 公開工廠），與工廠頁／消息頁共用
    // 同一套 marker-based 注入函式。無效 slug 一律真 404；合法但目前 0 筆
    // 結果一律 200+noindex（不是 404，見任務定案「三種頁面狀態」）。額外把
    // 固定 H1＋intro 語意殼動態注入 <div id="root">（純字串處理，不執行
    // renderToString；286 種組合不適合比照 /search／/about 用 build-time
    // 靜態檔）。
    const regionIndustryPath = parseRegionIndustryPath(pathname);
    if (regionIndustryPath) {
      try {
        const template = await getCachedTemplate();
        const meta = await buildRegionIndustryMeta(regionIndustryPath.regionSlug, regionIndustryPath.industrySlug, pathname);
        let page = injectMetaIntoHtml(template, meta);
        if (meta.status === 200) {
          const resolved = resolveRegionIndustry(regionIndustryPath.regionSlug, regionIndustryPath.industrySlug);
          if (resolved) {
            const content = buildRegionIndustryPageContent(resolved);
            const bodyPage = injectDynamicSemanticBody(page, content.h1, content.intro, "region-industry");
            if (bodyPage !== null) page = bodyPage;
          }
        }
        res.status(meta.status).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic region-industry meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // /industry/:slug(/:sub)：純資料查表（無 DB），與工廠頁共用同一套
    // marker-based 注入函式；slug 對不到任何已知產業時 industryMeta 為
    // null，落到下面的固定公開頁／SPA fallback 分支，行為不變。
    const industryPath = parseIndustryPath(pathname);
    const industryMeta = industryPath ? buildIndustryPageMeta(industryPath.slug, industryPath.subSlug) : null;
    if (industryMeta) {
      try {
        const template = await getCachedTemplate();
        const page = injectMetaIntoHtml(template, {
          title: industryMeta.title,
          description: industryMeta.description,
          image: DEFAULT_OG_IMAGE,
          url: industryMeta.canonical,
          status: 200,
          noindex: false,
        });
        res.status(200).set({ "Content-Type": "text/html" }).end(page);
      } catch (err) {
        console.error(
          "[ogMeta] serveStatic industry meta injection failed:",
          err instanceof Error ? err.message : String(err)
        );
        res.sendFile(indexPath);
      }
      return;
    }

    // 固定公開頁（目前為 "/"、"/about"、"/upgrade-center"）：不查資料庫，
    // 直接用 shared/seo 常數注入 title／description／canonical／OG／
    // JSON-LD。其餘所有路由（沒有專屬 SEO 設定的 SPA fallback）一律直接
    // 吐出同一份快取字串，不做任何字串處理，也不再重新命中磁碟；任何失敗
    // 才退回 res.sendFile 當最後保底。
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
