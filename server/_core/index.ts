import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { setupSecurityHeaders, setupOriginCheck } from "./security";
import { apiLimiter, loginLimiter, uploadLimiter, messageLimiter, submitReviewLimiter, adminLimiter } from "./rateLimit";
import { COOKIE_NAME } from "@shared/const";
import { getDb } from "../db";

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

  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ limit: "15mb", extended: true }));

  console.log("[boot] registering oauth routes");
  app.use("/api/", apiLimiter);

  // Route-level rate limits（比 apiLimiter 更嚴格的特定路徑）
  app.use("/api/oauth", loginLimiter);
  app.use("/api/trpc/admin.", adminLimiter);
  app.use((req, _res, next) => {
    const path = req.path;
    if (/factory\.uploadAvatar|factory\.uploadPhoto|product\.uploadImage/.test(path)) {
      return uploadLimiter(req, _res, next);
    }
    if (path.includes("chat.send")) {
      return messageLimiter(req, _res, next);
    }
    if (path.includes("factory.submitForReview")) {
      return submitReviewLimiter(req, _res, next);
    }
    next();
  });

  registerOAuthRoutes(app);

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
  });
}

startServer().catch((err) => {
  console.error("[boot] Server failed to start:", err);
  if (err instanceof Error) {
    console.error("[boot] Error stack:", err.stack);
  }
  process.exit(1);
});
