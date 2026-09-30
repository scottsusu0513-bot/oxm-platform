// @vitest-environment jsdom
/**
 * AiShellGate：GlobalAiShell 只在第一次打開 AI 時才 dynamic import（Batch 3.3）。
 *
 * 修正前：AiShellGate 在 App 啟動時就 render lazy(GlobalAiShell)，React 立刻觸發
 * import——使用者沒碰 AI，每一頁也要下載約 900 KB raw 的 shell＋Markdown 依賴。
 *
 * 這裡把 GlobalAiShell 模組 mock 掉，用「模組 factory 被執行幾次」直接量測
 * dynamic import 本身有沒有被觸發（不是只看 DOM 裡有沒有面板）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

const counters = vi.hoisted(() => ({ importFactory: 0, mounts: 0, unmounts: 0 }));
// 目前這個測試所用的 context 實例（resetModules 之後每個測試各自一份）
const holder = vi.hoisted(() => ({ useAiShell: null as null | (() => { isOpen: boolean }) }));
const auth = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: auth.isAuthenticated, user: null, loading: false }) }));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn(), setData: vi.fn(), fetch: vi.fn() }) }) }),
      ai: {
        chat: { useMutation: mutation },
        createHandoff: { useMutation: mutation },
        entitlementStatus: { useQuery: () => ({ data: { kind: "guest" }, refetch: vi.fn() }) },
        releaseMode: { useQuery: () => ({ data: { mode: "live" } }) },
      },
    },
  };
});

// lazy() 與模組快取都是「每個模組實例只 import 一次」：每個測試都 resetModules
// 後重新載入 AiShellGate／context／launcher，才能各自觀察到「第一次」import。
let mods: {
  AiShellProvider: typeof import("@/contexts/AiShellContext").AiShellProvider;
  useAiShell: typeof import("@/contexts/AiShellContext").useAiShell;
  AiLauncherButton: typeof import("./AiLauncherButton").AiLauncherButton;
  AiShellGate: typeof import("./AiShellGate").AiShellGate;
};

/** 模擬 FAQ 這類「不是浮動按鈕」的外部 openShell 呼叫點。 */
function ExternalOpener() {
  const { openShell } = mods.useAiShell();
  return <button type="button" onClick={openShell}>FAQ 問 AI</button>;
}
function ContextProbe() {
  const ctx = mods.useAiShell();
  return <span data-testid="ctx">{typeof ctx.openShell === "function" && typeof ctx.closeShell === "function" ? "ready" : "missing"}</span>;
}
function renderApp() {
  const { AiShellProvider, AiLauncherButton, AiShellGate } = mods;
  return render(
    <AiShellProvider>
      <ContextProbe />
      <AiLauncherButton />
      <ExternalOpener />
      <AiShellGate />
    </AiShellProvider>,
  );
}
const launcher = () => screen.getByRole("button", { name: /OXM AI 對話/ });
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("@/components/ai/GlobalAiShell", async () => {
    counters.importFactory++;
    function GlobalAiShell() {
      const { isOpen } = holder.useAiShell!();
      const [draft, setDraft] = useState("");
      useEffect(() => { counters.mounts++; return () => { counters.unmounts++; }; }, []);
      if (!isOpen) return null;
      return (
        <div role="dialog" aria-label="OXM AI 對話">
          <input aria-label="draft" value={draft} onChange={e => setDraft(e.target.value)} />
        </div>
      );
    }
    return { GlobalAiShell };
  });

  const ctx = await import("@/contexts/AiShellContext");
  mods = {
    AiShellProvider: ctx.AiShellProvider,
    useAiShell: ctx.useAiShell,
    AiLauncherButton: (await import("./AiLauncherButton")).AiLauncherButton,
    AiShellGate: (await import("./AiShellGate")).AiShellGate,
  };
  holder.useAiShell = ctx.useAiShell;
  counters.importFactory = 0; counters.mounts = 0; counters.unmounts = 0;
  auth.isAuthenticated = false;
  window.history.replaceState(null, "", "/search");
});
afterEach(() => cleanup());

describe("AiShellGate：互動觸發的 lazy mount", () => {
  it("A／F／H：初始關閉 → GlobalAiShell 模組完全沒有被 import；launcher 與 context 已可用", async () => {
    renderApp();
    await flush();
    expect(counters.importFactory).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher()).toBeTruthy();
    expect(launcher().getAttribute("aria-label")).toBe("開啟 OXM AI 對話");
    expect(screen.getByTestId("ctx").textContent).toBe("ready");
    // 初始 render 也不能插入指向 GlobalAiShell 的 modulepreload
    expect(document.querySelector('link[rel="modulepreload"][href*="GlobalAiShell"]')).toBeNull();
  });

  it("B：第一次點 launcher → import 恰好一次，載入中顯示 loading 回饋，之後面板出現", async () => {
    renderApp();
    await flush();
    fireEvent.click(launcher());
    expect(screen.getByRole("status").textContent).toContain("正在開啟 OXM AI");
    expect(await screen.findByRole("dialog", { name: "OXM AI 對話" })).toBeTruthy();
    expect(counters.importFactory).toBe(1);
    expect(counters.mounts).toBe(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("C／D：開 → 關 → 再開：import 仍是 1 次、元件沒有被卸載重建、輸入中的草稿保留", async () => {
    renderApp();
    fireEvent.click(launcher());
    const draft = await screen.findByLabelText("draft");
    fireEvent.change(draft, { target: { value: "想找螺絲工廠" } });

    fireEvent.click(launcher()); // close
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(counters.unmounts).toBe(0);

    fireEvent.click(launcher()); // reopen
    expect((await screen.findByLabelText("draft") as HTMLInputElement).value).toBe("想找螺絲工廠");
    expect(counters.importFactory).toBe(1);
    expect(counters.mounts).toBe(1);
    expect(counters.unmounts).toBe(0);
  });

  it("E：非 launcher 的外部 openShell（FAQ）也會觸發第一次掛載與下載", async () => {
    renderApp();
    await flush();
    expect(counters.importFactory).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "FAQ 問 AI" }));
    expect(await screen.findByRole("dialog", { name: "OXM AI 對話" })).toBeTruthy();
    expect(counters.importFactory).toBe(1);
    expect(launcher().getAttribute("aria-label")).toBe("關閉 OXM AI 對話");
  });

  it("排除路由（/admin）即使打開也不掛載、不下載", async () => {
    window.history.replaceState(null, "", "/admin");
    renderApp();
    fireEvent.click(launcher());
    await flush();
    expect(counters.importFactory).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("載入途中又關掉 → loading 回饋隨即消失，不殘留佔位", async () => {
    renderApp();
    fireEvent.click(launcher());
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(launcher());
    expect(screen.queryByRole("status")).toBeNull();
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("原始碼合約", () => {
  it("App.tsx 不再自己 render lazy GlobalAiShell，改用 AiShellGate；AiShellGate 在第一次打開前不 render", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const app = fs.readFileSync(path.resolve(import.meta.dirname, "../../App.tsx"), "utf-8");
    expect(app).not.toMatch(/import\(\s*["']@\/components\/ai\/GlobalAiShell["']\s*\)/);
    expect(app).toMatch(/import \{ AiShellGate \} from "@\/components\/ai\/AiShellGate"/);
    const gate = fs.readFileSync(path.resolve(import.meta.dirname, "AiShellGate.tsx"), "utf-8");
    expect(gate).toMatch(/if \(!isOpen && !hasEverOpened\) return null;/);
    expect(gate).not.toMatch(/requestIdleCallback|onMouseEnter|onPointerEnter|prefetch/);
  });
});
