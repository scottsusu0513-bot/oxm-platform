import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  // Hotfix 2：react() plugin 只有 .test.tsx（見下方 include）真正的元件
  // render 測試需要——它提供 JSX automatic runtime transform，這裡才不用在
  // 每個測試檔手動 import React。tsconfig.json 的 "jsx": "preserve" 本身不做
  // 轉換，main app 端的轉換一直是靠 vite.config.ts 自己的 react() plugin，
  // vitest.config.ts 原本沒有這個 plugin 是因為原本的 .test.ts 都是純函式
  // 測試、不含 JSX。
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Phase 7.1（見對話中「Testing」）：client／shared 這兩個 glob 原則上只收
    // 純函式的 deterministic 單元測試（不需要 DOM／React render，node
    // environment 就能跑）。
    // Hotfix 2（見對話「FAQ Accordion single-open」）：唯一例外是
    // `client/**/*.test.tsx`——這個副檔名專門保留給「真的需要 jsdom／React
    // Testing Library render＋互動」的少數迴歸測試（例如驗證 Radix Accordion
    // 在多個 category 共用同一個 open state 時，畫面上真的只會有一則展開），
    // 純字串比對既有的 source-assertion 測試已經證實會漏掉這類「邏輯正確但
    // CSS/DOM 行為壞掉」的 regression。個別測試檔用檔案開頭的
    // `// @vitest-environment jsdom` 指定環境，不影響其餘 `.test.ts` 檔案
    // 沿用的全域 "node" environment。
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "shared/**/*.test.ts",
    ],
    setupFiles: ["server/test-db-guard.ts"],
  },
});
