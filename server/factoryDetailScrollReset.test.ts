import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * FactoryDetail.tsx 進頁 scroll reset 的回歸測試。
 *
 * 同 server/factoryContactLogin.test.ts 等既有做法：本專案 vitest 只涵蓋
 * environment: "node"，沒有 jsdom／React Testing Library，無法在這裡真的
 * render 元件、模擬 route change 再量測 window.scrollY。這裡改用原始碼內容
 * 斷言，鎖定這次要修的具體回歸情境與明確禁止項目：
 *   1. 進到 /factory/:id 這個 route／這個 factoryId 時，必須重置一次 scroll。
 *   2. 這個 reset 只能綁在 factoryId 這個邊界上，不能綁在一般會頻繁變動的
 *      factory 資料 state（isLoading／isFav／reviewData／myReview 等）上，
 *      否則收藏、評價、輪詢等操作會把使用者強制拉回頁首。
 *   3. 不得新增一個全站等級的 route-change scroll-to-top 機制（例如寫進
 *      App.tsx 的 Router／RouteTracker，變成每個頁面切換都重置）——這次刻意
 *      只在 FactoryDetail.tsx 局部處理，避免破壞 /search 這類頁面原本可能
 *      保留的瀏覽器 scroll restoration。
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("FactoryDetail.tsx: 進頁時重置 scroll 到頁首", () => {
  const source = readSource("client", "src", "pages", "FactoryDetail.tsx");

  it("存在一個只依賴 factoryId 的 useEffect 呼叫 window.scrollTo(0, 0)", () => {
    const effectMatch = source.match(/useEffect\(\(\) => \{\s*\n\s*if \(!factoryId\) return;\s*\n\s*window\.scrollTo\(0, 0\);\s*\n\s*\}, \[factoryId\]\);/);
    expect(effectMatch, "找不到以 factoryId 為邊界的 scroll reset useEffect").not.toBeNull();
  });

  it("scroll reset 的依賴陣列只有 factoryId，不包含 factory／isLoading／isFav／reviewData／myReview 等一般 state", () => {
    const effectMatch = source.match(/useEffect\(\(\) => \{\s*\n\s*if \(!factoryId\) return;\s*\n\s*window\.scrollTo\(0, 0\);\s*\n\s*\}, \[([^\]]*)\]\);/);
    expect(effectMatch).not.toBeNull();
    const deps = effectMatch![1].split(",").map(s => s.trim()).filter(Boolean);
    expect(deps).toEqual(["factoryId"]);
  });
});

describe("App.tsx: 沒有新增全站等級的 route-change scroll-to-top", () => {
  const source = readSource("client", "src", "App.tsx");

  it("Router／RouteTracker 沒有被加上 window.scrollTo 或其他全域 scroll reset 邏輯", () => {
    expect(source).not.toMatch(/window\.scrollTo/);
    expect(source).not.toMatch(/scrollRestoration/);
  });
});
