// @vitest-environment jsdom
/**
 * AiShellGate＋真正的 GlobalAiShell（只 mock trpc／auth／LoginDialog，以及 streamdown——
 * streamdown 會從 node_modules import KaTeX 的 .css，jsdom／vitest 無法直接載入；
 * 本輪完全沒有改 Streamdown，真正的 Markdown 渲染在 production build 的瀏覽器
 * 驗證）——Batch 3.3 延後掛載之後，第一次打開仍然正常運作：
 *   G. 未登入第一次打開 → 載入後顯示登入引導，點擊可開登入對話框
 *   功能：開啟／關閉／重開、送出訊息、AI 回覆交給 Markdown 渲染器、關閉再開對話仍在
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  isAuthenticated: false,
  entitlement: { kind: "guest" } as Record<string, unknown>,
  chatCalls: [] as unknown[],
  loginDialogOpen: false,
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: state.isAuthenticated, user: null, loading: false }) }));
vi.mock("@/components/LoginDialog", () => ({
  default: ({ open }: { open: boolean }) => { state.loginDialogOpen = open; return open ? <div role="dialog" aria-label="登入" /> : null; },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn(), setData: vi.fn(), fetch: vi.fn() }) }) }),
    ai: {
      chat: {
        useMutation: () => ({
          isPending: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(async (input: unknown) => {
            state.chatCalls.push(input);
            return {
              conversationId: 1,
              reply: "## 推薦\n\n**螺絲**工廠如下：\n\n```ts\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```",
            };
          }),
        }),
      },
      createHandoff: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      entitlementStatus: { useQuery: () => ({ data: state.entitlement, refetch: vi.fn() }) },
      releaseMode: { useQuery: () => ({ data: { mode: "live" } }) },
    },
  },
}));

import { AiShellProvider } from "@/contexts/AiShellContext";
import { AiLauncherButton } from "./AiLauncherButton";
import { AiShellGate } from "./AiShellGate";

function renderApp() {
  return render(
    <AiShellProvider>
      <AiLauncherButton />
      <AiShellGate />
    </AiShellProvider>,
  );
}
const launcher = () => screen.getByRole("button", { name: /OXM AI 對話/ });

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  state.chatCalls.length = 0;
  state.loginDialogOpen = false;
  // jsdom 沒有這些 API；GlobalAiShell 的 focus／scroll 行為會用到
  window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});
afterEach(() => cleanup());

describe("真正的 GlobalAiShell 延後掛載後仍正常", () => {
  it("G：未登入第一次打開 → 面板載入後顯示登入引導，點擊開啟登入對話框", async () => {
    state.isAuthenticated = false;
    state.entitlement = { kind: "guest" };
    renderApp();
    fireEvent.click(launcher());
    const panel = await screen.findByRole("dialog", { name: "OXM AI 對話" }, { timeout: 10000 });
    fireEvent.click(within(panel).getByRole("button", { name: "登入 / 註冊" }));
    expect(state.loginDialogOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: "登入" })).toBeTruthy();
  }, 20000);

  it("開啟 → 送出訊息 → AI 回覆（含程式碼／mermaid 區塊）交給 Markdown 渲染器；關閉再開對話仍在", async () => {
    state.isAuthenticated = true;
    state.entitlement = { kind: "factory_member", quota: { used: 1, limit: 20 } };
    renderApp();
    const launcherBtn = launcher(); // 面板自己也有「關閉」按鈕，先固定拿浮動按鈕本身
    fireEvent.click(launcherBtn);
    const panel = await screen.findByRole("dialog", { name: "OXM AI 對話" }, { timeout: 10000 });
    const box = within(panel).getByRole("textbox");
    fireEvent.change(box, { target: { value: "想找螺絲工廠" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const md = await within(panel).findByTestId("markdown", {}, { timeout: 10000 });
    expect(md.textContent).toContain("## 推薦");
    expect(md.textContent).toContain("const x = 1;");
    expect(md.textContent).toContain("graph TD; A-->B;");
    expect(state.chatCalls).toHaveLength(1);

    fireEvent.click(launcherBtn); // close
    expect(screen.queryByRole("dialog", { name: "OXM AI 對話" })).toBeNull();
    fireEvent.click(launcherBtn); // reopen：同一份對話立即回來
    const again = screen.getByRole("dialog", { name: "OXM AI 對話" });
    expect(within(again).getByText("想找螺絲工廠")).toBeTruthy();
    expect(within(again).getByTestId("markdown").textContent).toContain("## 推薦");
  }, 30000);
});
