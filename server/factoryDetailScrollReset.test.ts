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
 *
 * 第二個 describe block（App.tsx 全站 scroll 機制）曾經在這裡鎖定「不得新增
 * 全站等級的 route-change scroll-to-top」，原因是當時還沒有想到一個不會破壞
 * /search 這類頁面既有瀏覽器 scroll restoration 的全站作法，所以刻意只做
 * FactoryDetail.tsx 局部處理。後續「新頁面偶發先看到 Footer、最後卡在頁尾」
 * 的全站根因修正（見 client/src/lib/scrollRestoration.ts 的
 * decideScrollNavigationAction 完整說明）已經解掉這個顧慮：新增的
 * ScrollRestorationManager 明確只在「真正的新導航」（非 popstate、pathname
 * 真的改變）才捲頂，popstate（瀏覽器上一頁／下一頁）與同 pathname 一律
 * preserve，不會蓋掉搜尋結果→工廠頁→返回搜尋結果這類既有保留位置的體驗——
 * 也就是原本這個測試想避免的後果，用更完整的判斷邏輯正確處理掉了，而不是
 * 用同一個「整頁無條件捲頂」的天真作法重蹈覆轍。第二個 describe block因此
 * 改成鎖定新機制本身具備這個安全性質，而不是繼續完全禁止全站機制存在。
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

describe("App.tsx: 全站 scroll-to-top 機制必須是「只在真正新導航才觸發」的安全版本，不是無條件全域 reset", () => {
  const source = readSource("client", "src", "App.tsx");

  it("有掛載 ScrollRestorationManager，且是透過 decideScrollNavigationAction 這個可測的純函式決定要不要捲頂（不是直接無條件呼叫 window.scrollTo）", () => {
    expect(source).toMatch(/<ScrollRestorationManager \/>/);
    expect(source).toMatch(/import \{ decideScrollNavigationAction, hasExplicitScrollTarget, isHomeNavigationIntentState \} from "@\/lib\/scrollRestoration"/);
    // ScrollRestorationManager 內部呼叫 window.scrollTo(0, 0) 必须包在
    // decideScrollNavigationAction 回傳 "reset-to-top" 的分支裡，不是直接
    // 綁在每次 pathname 變化的 effect 最上層無條件執行。
    const managerMatch = source.match(/function ScrollRestorationManager\(\)[\s\S]*?\n\}/);
    expect(managerMatch, "找不到 ScrollRestorationManager 元件").not.toBeNull();
    expect(managerMatch![0]).toMatch(/if \(action === "reset-to-top"\)\s*\{\s*\n\s*window\.scrollTo\(0, 0\);/);
  });

  it("ScrollRestorationManager 有監聽瀏覽器原生 popstate，用來分辨新導航與返回／前進導航", () => {
    const managerMatch = source.match(/function ScrollRestorationManager\(\)[\s\S]*?\n\}/);
    expect(managerMatch).not.toBeNull();
    expect(managerMatch![0]).toMatch(/addEventListener\("popstate"/);
  });
});
