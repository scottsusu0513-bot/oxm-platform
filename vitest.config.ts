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
    // Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：
    // 十個測試檔（見 grep `process\.env\.ADMIN_WHITELIST_EMAILS\s*=` --glob
    // '*.test.ts'）各自在 beforeAll 用真實的 ADMIN_WHITELIST_EMAILS 白名單
    // 機制驗證 db.getAdminUserIds()／isAdminUser() 的實際行為（刻意不 mock
    // 掉，因為要驗證的正是這個機制本身），因此需要暫時覆寫這個 process 的
    // process.env.ADMIN_WHITELIST_EMAILS。這個值是整個 Node process 共用、
    // 可變的全域狀態——多檔案並行時，即使覆寫本身已經搬到 beforeAll（讓
    // server/_core/env.ts 的 ENV.adminWhitelistEmails 從「模組載入當下算一次
    // 就凍結」改成「每次存取才重新讀」，修掉了「誰先 import 誰的值就凍結
    // 一整輪測試」這個更嚴重的 bug），不同檔案的 beforeAll／it() 仍可能在
    // 同一個 process 裡交錯執行，A 檔案剛設完自己的白名單，B 檔案的
    // beforeAll 就可能已經把它蓋成別的值。
    //
    // 已經 audit 並實測過三種不犧牲平行度的替代方案，全部無法可靠解決：
    // (1) 只做上面的 getter＋beforeAll 修正，不做任何排程調整——仍會 race
    //     （10 檔一起跑，連續 5 次各有數量不等的偶發失敗）。
    // (2) pool:"forks" + poolOptions.forks.isolate:true（Vitest 文件建議
    //     的「測試會改變全域狀態」情境）——同樣的檔案組合仍會 race。
    // (3) vitest.workspace.ts 把這 10 個檔案獨立成一個
    //     fileParallelism:false 的 project、其餘檔案維持平行——專案層級的
    //     fileParallelism 覆寫在這個 Vitest 版本並未真正生效，同一批檔案
    //     仍會交錯執行、仍會 race（重複驗證兩次，結果一致）。
    // 只有全域 fileParallelism:false 能重現到 100% 穩定（連續多次執行皆
    // 全線通過）。這會讓完整測試套件從約 37 秒變慢到約 175 秒（約 4.7
    // 倍）——這是已知、刻意接受的取捨，不是忽略效能，而是在「日常開發跑
    // 單一或少數測試檔幾乎沒有影響」（fileParallelism 只影響『同時執行的
    // 檔案數』，單檔執行不受影響）與「完整套件跑一次變慢」之間，選擇正確
    // 性優先——這正是使用者要求的「不要只是拿 --no-file-parallelism 把
    // race 藏起來，除非 audit 證明 architecture 必須如此」：上面三個
    // 不犧牲平行度的方案都已經實測失敗，才退回這個做法。
    fileParallelism: false,
  },
});
