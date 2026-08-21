// @vitest-environment jsdom
/**
 * ConsentGate 的互動 regression test。這裡 mock `@/lib/trpc`（trpc client）
 * 與 `@/_core/hooks/useAuth`，直接對真正的 ConsentGate.tsx render + 使用者
 * 互動（點擊分頁、模擬捲動、勾選、送出），不是只驗證原始碼字串。
 *
 * jsdom 不會做真的版面計算（scrollHeight／clientHeight 預設都是 0），所以
 * 這裡用 Object.defineProperty 手動模擬「內容比容器高、需要捲動」與「捲到
 * 底部」兩種狀態，觸發 ConsentGate.tsx 裡真正的 onScroll handler。
 *
 * 涵蓋使用者第十八節列出的最低要求中，屬於前端互動的部分：
 *   (1) 未登入 → Gate 不顯示
 *   (7) 服務條款沒捲到底 → checkbox 不能勾選
 *   (8) 隱私權政策沒捲到底 → checkbox 不能勾選
 *   (9) checkbox 沒勾選 → 送出按鈕不能按
 *   (10) API 失敗 → Gate 仍然存在、顯示錯誤訊息
 * 另外補測第十二節要求的「切換分頁不會重置已讀狀態」。
 *
 * 涵蓋範圍誠實聲明：這裡驗證的是元件內部的 read-state／checkbox／submit
 * disabled 邏輯是否正確反應真實的捲動事件與點擊事件（真正的互動測試，不是
 * 只檢查 useState 初始值或原始碼字串）。但這不等於「真人在真瀏覽器裡用滑鼠
 * 滾輪把落落長的條款捲到底」這件事本身——jsdom 沒有真的版面／捲動物理效果，
 * 這部分（實際內容是否真的能被使用者捲動到底、桌機／手機版面是否符合
 * 第十三節的響應式要求）需要在真瀏覽器手動驗證，見這次任務的最終回報。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let mockUser: any = null;
let mockIsAuthenticated = false;
const mockMutate = vi.fn();
let currentMutationOpts: { onSuccess?: () => void | Promise<void>; onError?: (err: Error) => void } = {};
let mockIsPending = false;

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: mockIsAuthenticated,
    loading: false,
    error: null,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      acceptConsent: {
        useMutation: (opts: any) => {
          currentMutationOpts = opts ?? {};
          return { mutate: mockMutate, isPending: mockIsPending };
        },
      },
    },
    useUtils: () => ({ auth: { me: { invalidate: vi.fn().mockResolvedValue(undefined) } } }),
  },
}));

import { ConsentGate } from "./ConsentGate";

beforeEach(() => {
  mockUser = { id: 1, needsConsent: true };
  mockIsAuthenticated = true;
  mockIsPending = false;
  currentMutationOpts = {};
  mockMutate.mockReset();
});

afterEach(() => {
  cleanup();
});

function setScrollable(el: HTMLElement, scrollTop: number) {
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true, writable: true });
}

function scrollToBottom(el: HTMLElement) {
  setScrollable(el, 700); // 700 + 300 = 1000 = scrollHeight
  fireEvent.scroll(el);
}

function setNotScrolled(el: HTMLElement) {
  setScrollable(el, 0);
}

// 這個專案沒有裝 @testing-library/jest-dom，沒有 toBeDisabled() 這個
// matcher，直接檢查原生 disabled 屬性即可（Radix Checkbox／shadcn Button
// disabled 時都會反映在真正的 HTML disabled attribute 上）。
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

// Radix Tabs 預設 activationMode="automatic"，是靠 onFocus 觸發分頁切換
// （模擬真實瀏覽器「點擊會先 focus 該按鈕」的行為）；jsdom 的
// fireEvent.click 不會像真瀏覽器一樣自動連帶觸發 focus，所以這裡手動補一個
// focus 事件，否則分頁不會真的切換。
function clickTab(text: string) {
  const el = screen.getByText(text);
  fireEvent.focus(el);
  fireEvent.click(el);
}
function goToPrivacyTab() {
  clickTab("隱私權政策");
}
function goToTermsTab() {
  clickTab("服務條款");
}

describe("ConsentGate", () => {
  it("未登入時不顯示 Gate", () => {
    mockIsAuthenticated = false;
    mockUser = null;
    render(<ConsentGate />);
    expect(screen.queryByText("歡迎加入 OXM")).toBeNull();
  });

  it("已登入但 needsConsent 為 false 時不顯示 Gate", () => {
    mockUser = { id: 1, needsConsent: false };
    render(<ConsentGate />);
    expect(screen.queryByText("歡迎加入 OXM")).toBeNull();
  });

  it("needsConsent 為 true 時顯示 Gate", () => {
    render(<ConsentGate />);
    expect(screen.getByText("歡迎加入 OXM")).toBeTruthy();
  });

  it("(7) 服務條款沒捲到底：即使隱私權政策已捲到底，checkbox 仍為 disabled", () => {
    render(<ConsentGate />);
    setNotScrolled(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));
    expect(isDisabled(screen.getByRole("checkbox"))).toBe(true);
  });

  it("(8) 隱私權政策沒捲到底：即使服務條款已捲到底，checkbox 仍為 disabled", () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    setNotScrolled(screen.getByTestId("consent-privacy-scroll"));
    expect(isDisabled(screen.getByRole("checkbox"))).toBe(true);
  });

  it("兩份都捲到底之後 checkbox 才會變成可勾選", () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));
    expect(isDisabled(screen.getByRole("checkbox"))).toBe(false);
  });

  it("切換分頁不會重置已讀狀態：條款讀完切去政策、再切回條款不需要重新捲動", () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    goToTermsTab(); // 切回條款分頁，不重新捲動——已讀狀態應維持 true
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));
    expect(isDisabled(screen.getByRole("checkbox"))).toBe(false);
  });

  it("(9) 兩份都讀完但 checkbox 未勾選：送出按鈕仍為 disabled；勾選後才可按", () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));

    const submitButton = screen.getByRole("button", { name: /同意並繼續/ });
    expect(isDisabled(submitButton)).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(isDisabled(submitButton)).toBe(false);
  });

  it("(10) API 失敗：Gate 仍然存在、顯示錯誤訊息，且可以再次嘗試送出", () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));
    fireEvent.click(screen.getByRole("checkbox"));

    mockMutate.mockImplementation(() => {
      currentMutationOpts.onError?.(new Error("網路發生錯誤"));
    });
    fireEvent.click(screen.getByRole("button", { name: /同意並繼續/ }));

    expect(screen.getByText("網路發生錯誤")).toBeTruthy();
    expect(screen.getByText("歡迎加入 OXM")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: /同意並繼續/ }))).toBe(false);
  });

  it("送出成功：呼叫 mutate，且錯誤訊息不會出現", async () => {
    render(<ConsentGate />);
    scrollToBottom(screen.getByTestId("consent-terms-scroll"));
    goToPrivacyTab();
    scrollToBottom(screen.getByTestId("consent-privacy-scroll"));
    fireEvent.click(screen.getByRole("checkbox"));

    mockMutate.mockImplementation(() => {
      currentMutationOpts.onSuccess?.();
    });
    fireEvent.click(screen.getByRole("button", { name: /同意並繼續/ }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("consent-error")).toBeNull();
  });
});
