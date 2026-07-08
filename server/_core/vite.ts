import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { buildFactoryMeta, injectMetaIntoHtml, parseFactoryPath, stripQueryString } from "./ogMeta";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
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

  app.use(express.static(distPath));

  const indexPath = path.resolve(distPath, "index.html");

  // fall through to index.html if the file doesn't exist
  app.use("*", async (req, res) => {
    // req.path is unusable under app.use("*", ...) — Express folds the
    // whole matched path into req.baseUrl, leaving req.path as "/". Derive
    // the pathname from req.originalUrl instead.
    const pathname = stripQueryString(req.originalUrl);
    const factoryPath = parseFactoryPath(pathname);
    if (!factoryPath) {
      res.sendFile(indexPath);
      return;
    }

    // /factory/:id: inject factory-specific OG/Twitter meta into the same
    // static index.html before sending, so social crawlers (which don't run
    // the client bundle) see the business preview. Any failure here falls
    // straight back to the plain SPA file — never a 500.
    try {
      const template = await fs.promises.readFile(indexPath, "utf-8");
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
  });
}
