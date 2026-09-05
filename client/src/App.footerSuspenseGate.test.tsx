// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, lazy } from "react";
import fs from "node:fs";
import path from "node:path";
import { Footer } from "./components/Footer";
import { isFooterExcludedPath } from "./lib/footerRoutes";

/**
 * 「Footer 在 route lazy-loading 期間先閃出來」的回歸測試（OXM Footer Route
 * Flash — Phase 2）。
 *
 * 根因（見 Phase 1 Audit）：App.tsx 原本把 <FooterGate/> 掛在 <Router/> 的
 * 兄弟節點，落在 <Suspense> 邊界之外。每次切換到本次 session 尚未載入過的
 * lazy page，<Suspense> 顯示 fallback（<AppLoading/>）的同時，Footer 仍然
 * 持續存在，兩者疊加的高度比使用者原本的 scrollY 還矮，瀏覽器會把 scrollY
 * clamp 到這個暫時文件的底部——使用者因此先看到一整塊 Footer，才看到真正的
 * 新頁面。修正方式是把 <FooterGate/> 移進 <Suspense> 內、跟 <Switch> 同一層，
 * 讓它跟頁面內容一起被 Suspense 接管：loading 期間兩者一起被 fallback 取代，
 * ready 之後兩者一起出現。
 *
 * 這裡分兩層驗證：
 * 1. 原始碼斷言：鎖定 App.tsx 的 <FooterGate/> 確實在 <Suspense> 內、
 *    <Switch> 之後，不是 App() 裡 <Router/> 的兄弟節點（防止未來被搬回去）。
 * 2. 行為驗證：用真正的 React Suspense + 真正的 Footer 元件（jsdom + RTL），
 *    重現同樣的「Suspense 內有一個尚未 resolve 的 lazy 元件 + Footer 同層」
 *    結構，證明 loading 期間 Footer 真的不會出現、resolve 後才一起出現——
 *    純文字斷言測不出這種「邏輯正確但 React 渲染時機不對」的問題。
 */

function readAppSource(): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "App.tsx"), "utf-8");
}

describe("App.tsx（原始碼斷言）: FooterGate 在 Suspense 內、跟 Switch 同一層", () => {
  const source = readAppSource();

  it("Router() 的 <Suspense> 內，<FooterGate/> 緊接在 </Switch>（外層是 BUG 2 loading-shell 的 min-h-screen 包裹 div）之後、</Suspense> 之前", () => {
    // BUG 2（新頁面偶發先看到 Footer、最後卡在頁尾）修正：<Switch> 外面多包了
    // 一層 min-h-screen 的 div，保證頁面內容區至少一個視窗高，但 <FooterGate/>
    // 仍然必須在同一個 <Suspense> 內、緊接在這層 wrapper 之後，不能被搬到
    // <Suspense> 外面（那就是 Phase 1/2 修過的原始 bug）。
    const match = source.match(/<Suspense fallback=\{<PageFallback \/>\}>[\s\S]*?<div className="min-h-screen">\s*<Switch>[\s\S]*?<\/Switch>\s*<\/div>\s*<FooterGate \/>\s*<\/Suspense>/);
    expect(match, "找不到「min-h-screen wrapper 內的 </Switch> 後緊接 <FooterGate/>，且兩者都在同一個 <Suspense> 內」的結構").not.toBeNull();
  });

  it("App() 本體不再直接掛 <FooterGate/>（不是 <Router/> 的兄弟節點——那是修正前的錯誤結構）", () => {
    const appBodyMatch = source.match(/function App\(\) \{[\s\S]*?<Router \/>\s*\n\s*<AppBottomNav \/>/);
    expect(appBodyMatch, "找不到 App() 本體裡 <Router/> 到 <AppBottomNav/> 這段").not.toBeNull();
    expect(appBodyMatch![0]).not.toMatch(/<FooterGate \/>/);
  });

  it("FooterGate 的 route 排除邏輯（isFooterExcludedPath）沒有被繞過或重寫", () => {
    expect(source).toMatch(/function FooterGate\(\) \{\s*\n\s*const \[pathname\] = useLocation\(\);\s*\n\s*if \(isFooterExcludedPath\(pathname\)\) return null;\s*\n\s*return <Footer \/>;\s*\n\s*\}/);
  });
});

describe("Suspense + Footer 同層時的實際渲染行為（jsdom + React Testing Library）", () => {
  afterEach(() => cleanup());

  function makeControllableLazy(label: string) {
    let resolveFn!: () => void;
    const promise = new Promise<void>((resolve) => { resolveFn = resolve; });
    const LazyComp = lazy(() =>
      promise.then(() => ({ default: () => <div data-testid="page">{label}</div> }))
    );
    return { LazyComp, resolve: resolveFn };
  }

  it("修正後的結構（Footer 跟 lazy page 同在 Suspense 內）：loading 期間 Footer 不存在，resolve 後才一起出現", async () => {
    const { LazyComp, resolve } = makeControllableLazy("新頁面內容");

    render(
      <Suspense fallback={<div data-testid="app-loading">AppLoading</div>}>
        <LazyComp />
        <Footer />
      </Suspense>
    );

    // Loading 階段：只有 fallback，Footer（真正的 Footer 元件）不得出現。
    expect(screen.getByTestId("app-loading")).toBeTruthy();
    expect(screen.queryByText("台灣傳統產業資源媒合平台")).toBeNull();
    expect(document.querySelector("footer")).toBeNull();

    resolve();
    await waitFor(() => expect(screen.getByTestId("page")).toBeTruthy());

    // Ready 之後：頁面內容與 Footer 一起出現，fallback 消失。
    expect(screen.queryByTestId("app-loading")).toBeNull();
    expect(document.querySelector("footer")).toBeTruthy();
    expect(screen.getByText("台灣傳統產業資源媒合平台")).toBeTruthy();
  });

  it("修正前的錯誤結構（Footer 放在 Suspense 外）：loading 期間 Footer 仍然會顯示——這正是本次修的 bug，僅作對照", async () => {
    const { LazyComp, resolve } = makeControllableLazy("新頁面內容");

    render(
      <>
        <Suspense fallback={<div data-testid="app-loading">AppLoading</div>}>
          <LazyComp />
        </Suspense>
        <Footer />
      </>
    );

    expect(screen.getByTestId("app-loading")).toBeTruthy();
    // 對照組：Footer 在 Suspense 外，loading 期間依然存在（這就是根因）。
    expect(document.querySelector("footer")).toBeTruthy();

    resolve();
    await waitFor(() => expect(screen.getByTestId("page")).toBeTruthy());
  });

  it("route 排除清單內的路徑（例如 /dashboard）即使跟 lazy page 一起放在 Suspense 內，ready 後 Footer 依然不顯示", async () => {
    const { LazyComp, resolve } = makeControllableLazy("dashboard 內容");
    const pathname = "/dashboard";

    function FooterGateForTest() {
      if (isFooterExcludedPath(pathname)) return null;
      return <Footer />;
    }

    render(
      <Suspense fallback={<div data-testid="app-loading">AppLoading</div>}>
        <LazyComp />
        <FooterGateForTest />
      </Suspense>
    );

    resolve();
    await waitFor(() => expect(screen.getByTestId("page")).toBeTruthy());

    expect(document.querySelector("footer")).toBeNull();
  });
});
