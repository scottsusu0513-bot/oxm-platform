import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerDevLoginRoutes } from "./devLogin";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { setupSecurityHeaders, setupOriginCheck } from "./security";
import { apiLimiter, loginLimiter, uploadLimiter, messageLimiter, submitReviewLimiter, adminLimiter, searchLimiter, reportLimiter } from "./rateLimit";
import { COOKIE_NAME } from "@shared/const";
import { INDUSTRY_SLUGS, PHASE1_SUB_INDUSTRY_PAGES } from "../../shared/constants";
import { escapeXmlText } from "@shared/seo/xml";
import { getDb, getApprovedFactoriesForSitemap, ensureConsultantsSeeded } from "../db";
import { runCollaborationOrderOverdueEmailCheck } from "../orderOverdueCheck";

async function startServer() {
  console.log("[boot] startServer called");
  console.log("[boot] NODE_ENV =", process.env.NODE_ENV);
  console.log("[boot] PORT =", process.env.PORT);

  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);

  console.log("[boot] applying security headers");
  setupSecurityHeaders(app);
  console.log("[boot] applying origin check");
  setupOriginCheck(app);

  // 圖片上傳及含 avatarUrl 的工廠建立/更新路由放寬到 15 MB，其他 API 限制 100 KB
  app.use((req, res, next) => {
    const path = req.path ?? "";
    if (/uploadAvatar|uploadPhoto|uploadImage|uploadCoverImage|uploadBadgeEvidence|factory\.create|factory\.update/.test(path)) {
      return express.json({ limit: "15mb" })(req, res, next);
    }
    return express.json({ limit: "100kb" })(req, res, next);
  });
  app.use(express.urlencoded({ limit: "100kb", extended: true }));

  console.log("[boot] registering oauth routes");
  app.use("/api/", apiLimiter);

  // Route-level rate limits（比 apiLimiter 更嚴格的特定路徑）
  app.use("/api/oauth", loginLimiter);
  app.use("/api/trpc/admin.", adminLimiter);
  app.use((req, _res, next) => {
    const path = req.path;
    // factory.uploadBadgeEvidence 刻意不在這裡比對——它的限流是依已驗證的
    // ctx.user.id 計算（每人每小時 20 次），用 server/_core/trpc.ts 的
    // badgeEvidenceUploadProcedure（tRPC middleware）實作，與這裡其餘三種
    // 圖片上傳共用的 IP-based uploadLimiter（10 次/小時）完全獨立分離，
    // 兩邊互不消耗彼此的配額。
    if (/factory\.uploadAvatar|factory\.uploadPhoto|product\.uploadImage/.test(path)) {
      return uploadLimiter(req, _res, next);
    }
    if (path.includes("chat.send")) {
      return messageLimiter(req, _res, next);
    }
    if (path.includes("factory.submitForReview")) {
      return submitReviewLimiter(req, _res, next);
    }
    if (path.includes("factory.search")) {
      return searchLimiter(req, _res, next);
    }
    if (path.includes("report.create")) {
      return reportLimiter(req, _res, next);
    }
    next();
  });

  registerOAuthRoutes(app);
  registerDevLoginRoutes(app);

  app.get("/api/health", async (_req, res) => {
    res.set({
      "Cache-Control": "no-store, no-cache, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    try {
      await getDb();
    } catch {
      // DB wake-up best-effort; don't fail health check
    }
    res.status(200).json({ status: "ok" });
  });

  // Standalone logout route — does NOT go through tRPC/httpBatchLink
  app.post("/api/logout", (req, res) => {
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
    const secure = isLocal ? "" : "; Secure";
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({ success: true });
  });

  // ── Phase 4D: 訂單逾期 Email 排程觸發入口 ─────────────────────────────
  // 驗證方式：POST + header x-cron-secret: <ORDER_OVERDUE_CRON_SECRET>
  // 未設定 secret 時回 503；secret 不符時回 401；不接受 GET
  app.post("/api/cron/order-overdue-email-check", async (req, res) => {
    const secret = process.env.ORDER_OVERDUE_CRON_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "Cron endpoint not configured (ORDER_OVERDUE_CRON_SECRET not set)" });
    }
    const provided = req.headers["x-cron-secret"];
    if (!provided || provided !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await runCollaborationOrderOverdueEmailCheck();
      console.log("[cron] order-overdue-email-check completed:", JSON.stringify(result));
      return res.status(200).json(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cron] order-overdue-email-check error:", msg);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // ── robots.txt ─────────────────────────────────────────────────────────
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(
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
      "Disallow: /api\n" +
      "Disallow: /api/trpc\n" +
      "\n" +
      "Sitemap: https://www.oxmmatch.com/sitemap.xml\n"
    );
  });

  // ── sitemap.xml ─────────────────────────────────────────────────────────
  app.get("/sitemap.xml", async (_req, res) => {
    const BASE = "https://www.oxmmatch.com";
    const today = new Date().toISOString().slice(0, 10);

    // lastmod 省略時不輸出 <lastmod> 標籤，避免對沒有真實更新時間的固定頁
    // 偽造成「每次請求都是今天」；既有呼叫則明確傳入 today，維持原本行為不變。
    const entry = (loc: string, priority: string, changefreq: string, lastmod?: string) =>
      `  <url>\n    <loc>${escapeXmlText(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

    const urls: string[] = [];

    // 固定公開頁
    urls.push(entry(`${BASE}/`, "1.0", "daily", today));
    urls.push(entry(`${BASE}/about`, "0.6", "monthly"));
    urls.push(entry(`${BASE}/search`, "0.9", "daily", today));
    urls.push(entry(`${BASE}/announcements`, "0.6", "weekly", today));
    urls.push(entry(`${BASE}/privacy`, "0.3", "monthly", today));
    urls.push(entry(`${BASE}/terms`, "0.3", "monthly", today));

    // Blog / 找代工指南
    urls.push(entry(`${BASE}/blog`, "0.7", "weekly", today));
    urls.push(entry(`${BASE}/blog/oem-vs-odm`, "0.6", "weekly", today));
    urls.push(entry(`${BASE}/blog/what-is-moq`, "0.6", "weekly", today));
    urls.push(entry(`${BASE}/blog/first-time-factory-guide`, "0.6", "weekly", today));

    // 主產業頁
    for (const slug of Object.values(INDUSTRY_SLUGS)) {
      urls.push(entry(`${BASE}/industry/${slug}`, "0.8", "weekly", today));
    }

    // 子產業頁（Phase 1）
    for (const { industrySlug, subSlug } of PHASE1_SUB_INDUSTRY_PAGES) {
      urls.push(entry(`${BASE}/industry/${industrySlug}/${subSlug}`, "0.7", "weekly", today));
    }

    // 已審核工廠頁
    try {
      const approved = await getApprovedFactoriesForSitemap();
      for (const f of approved) {
        const lastmod = f.updatedAt instanceof Date
          ? f.updatedAt.toISOString().slice(0, 10)
          : today;
        urls.push(entry(`${BASE}/factory/${f.id}`, "0.7", "weekly", lastmod));
      }
    } catch {
      // DB 暫時不可用時跳過工廠 URL，仍回傳靜態部分
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.join("\n") +
      `\n</urlset>`;

    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  console.log("[boot] registering trpc");
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  console.log("[boot] before setupVite / serveStatic");
  try {
    if (process.env.NODE_ENV === "development") {
      console.log("[boot] entering setupVite");
      await setupVite(app, server);
      console.log("[boot] setupVite done");
    } else {
      console.log("[boot] entering serveStatic");
      serveStatic(app);
      console.log("[boot] serveStatic done");
    }
  } catch (err) {
    console.error("[boot] setupVite/serveStatic failed:", err);
    throw err;
  }

  console.log("[boot] before listen");
  const port = parseInt(process.env.PORT || "3000", 10);
  console.log("[boot] listening on port", port);

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[boot] Port ${port} is already in use. Please kill the process using this port.`);
    } else {
      console.error("[boot] Server error:", err);
    }
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[boot] Server running on http://0.0.0.0:${port}/`);
    ensureConsultantsSeeded().catch(err => console.error("[boot] consultant seed failed:", err));
  });
}

startServer().catch((err) => {
  console.error("[boot] Server failed to start:", err);
  if (err instanceof Error) {
    console.error("[boot] Error stack:", err.stack);
  }
  process.exit(1);
});
