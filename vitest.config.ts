import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Phase 7.1（見對話中「Testing」）：client／shared 這兩個 glob 只收
    // 純函式的 deterministic 單元測試（不需要 DOM／React render，node
    // environment 就能跑），不是引入 jsdom／React Testing Library 之類的
    // 元件渲染測試——真正的元件渲染驗收仍然是本輪的手動 Mobile／Desktop
    // 驗收（見報告「三十五」）。
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    setupFiles: ["server/test-db-guard.ts"],
  },
});
