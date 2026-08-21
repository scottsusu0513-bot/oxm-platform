// @vitest-environment jsdom
/**
 * OnboardingTour 的互動 regression test。架構比照
 * client/src/components/ConsentGate.test.tsx 已驗證過的模式：mock
 * `@/_core/hooks/useAuth`（登入狀態）、`@/lib/trpc`（mutation）、
 * `wouter`（目前 route）、`@/components/FloatingAnnouncementButton`（避免
 * 載入整個公告元件模組，那支檔案在 import 當下會呼叫真實的
 * Capacitor.isNativePlatform()，跟這裡要測的東西無關）。
 *
 * 涵蓋對話「二十七」列出的 12 項最低要求。target 元素直接用
 * document.body 上手動建立的 DOM 節點模擬（data-onboarding 屬性 +
 * offsetParent／getBoundingClientRect 手動控制可見性與位置），因為 jsdom
 * 不會真的套用 Tailwind 的 hidden/lg:flex 之類的 responsive class。
 *
 * 涵蓋範圍誠實聲明：這裡驗證的是元件內部的 step 切換／target 解析／
 * mutation 呼叫／錯誤處理等真實邏輯（render + fireEvent 互動），不是原始
 * 碼字串比對。但 spotlight 遮罩的實際視覺效果（四塊背板是否真的完全對齊
 * 目標、桌機解說卡定位是否真的不超出 viewport）需要真瀏覽器手動驗證，見
 * 這次任務的最終回報。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

let mockUser: any = null;
let mockIsAuthenticated = false;
let mockPathname = "/";
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

vi.mock("wouter", () => ({
  useLocation: () => [mockPathname, vi.fn()],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      completeOnboarding: {
        useMutation: (opts: any) => {
          currentMutationOpts = opts ?? {};
          return { mutate: mockMutate, isPending: mockIsPending };
        },
      },
    },
    useUtils: () => ({ auth: { me: { invalidate: vi.fn().mockResolvedValue(undefined) } } }),
  },
}));

vi.mock("@/components/FloatingAnnouncementButton", () => ({
  OXM_LINE_URL: "https://page.line.me/785bsmsr",
}));

import { OnboardingTour } from "./OnboardingTour";

type Visibility = "visible" | "hidden" | "absent";

let injectedEls: HTMLElement[] = [];

function mountTarget(key: string, visibility: Visibility) {
  if (visibility === "absent") return;
  const el = document.createElement("button");
  el.setAttribute("data-onboarding", key);
  el.textContent = key;
  document.body.appendChild(el);
  Object.defineProperty(el, "offsetParent", {
    value: visibility === "visible" ? document.body : null,
    configurable: true,
  });
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ top: 120, left: 40, width: 200, height: 44, right: 240, bottom: 164, x: 40, y: 120, toJSON() {} }),
    configurable: true,
  });
  injectedEls.push(el);
}

function mountDefaultTargets(overrides: Partial<Record<string, Visibility>> = {}) {
  const defaults: Record<string, Visibility> = {
    "create-factory": "visible",
    "search-factory": "visible",
    "services-nav": "visible",
    "services-menu": "hidden",
  };
  const merged = { ...defaults, ...overrides } as Record<string, Visibility>;
  for (const [key, vis] of Object.entries(merged)) {
    mountTarget(key, vis);
  }
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  mockUser = { id: 1, needsConsent: false, needsOnboarding: true };
  mockIsAuthenticated = true;
  mockPathname = "/";
  mockIsPending = false;
  currentMutationOpts = {};
  mockMutate.mockReset();
  injectedEls = [];
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

afterEach(() => {
  cleanup();
  for (const el of injectedEls) el.remove();
  injectedEls = [];
});

describe("OnboardingTour", () => {
  it("(10) needsConsent 為 true 時不顯示導覽", () => {
    mockUser = { id: 1, needsConsent: true, needsOnboarding: true };
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.queryByText("先建立你的工廠")).toBeNull();
  });

  it("(11) 非首頁不顯示導覽", () => {
    mockPathname = "/search";
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.queryByText("先建立你的工廠")).toBeNull();
  });

  it("needsOnboarding 為 false 時不顯示導覽", () => {
    mockUser = { id: 1, needsConsent: false, needsOnboarding: false };
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.queryByText("先建立你的工廠")).toBeNull();
  });

  it("(1) Step 1 文案與 target：顯示標題、說明與 1/4 進度", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.getByText("先建立你的工廠")).toBeTruthy();
    expect(screen.getByText(/完成工廠資料後/)).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    // 第一步不應該有「上一步」
    expect(screen.queryByRole("button", { name: "上一步" })).toBeNull();
  });

  it("(2) 下一步：從 Step 1 前進到 Step 2", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it("(3) 上一步：從 Step 2 返回 Step 1", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
    clickButton("上一步");
    expect(screen.getByText("先建立你的工廠")).toBeTruthy();
  });

  it("(4) Step 3 desktop target：services-nav 可見時不顯示 mobile 補充說明", () => {
    mountDefaultTargets({ "services-nav": "visible", "services-menu": "hidden" });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("探索 OXM 的產業服務")).toBeTruthy();
    expect(screen.queryByText(/點擊右上角選單/)).toBeNull();
  });

  it("(5) Step 3 mobile fallback target：services-nav 隱藏、services-menu 可見時改用並顯示補充說明", () => {
    mountDefaultTargets({ "services-nav": "hidden", "services-menu": "visible" });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("探索 OXM 的產業服務")).toBeTruthy();
    expect(screen.getByText(/點擊右上角選單/)).toBeTruthy();
  });

  it("(6) Step 4 顯示 LINE QR code 與加入連結，按鈕改為「完成導覽」", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("需要協助，直接找 OXM")).toBeTruthy();
    const img = screen.getByAltText("OXM 官方 LINE QR Code") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/images/oxm-line-qr.png");
    const link = screen.getByRole("link", { name: "加入 OXM LINE" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://page.line.me/785bsmsr");
    expect(screen.getByRole("button", { name: /完成導覽/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  });

  it("(7) 略過導覽：呼叫 completion API", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("略過導覽");
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("(8) 完成導覽：Step 4 呼叫 completion API", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步");
    clickButton("完成導覽");
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("(9) mutation 失敗：導覽不關閉，顯示錯誤訊息", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    mockMutate.mockImplementation(() => {
      currentMutationOpts.onError?.(new Error("網路錯誤"));
    });
    clickButton("略過導覽");
    expect(screen.getByText("網路錯誤")).toBeTruthy();
    // 導覽仍然存在（第一步標題仍在畫面上）
    expect(screen.getByText("先建立你的工廠")).toBeTruthy();
  });

  it("(12) target 找不到時不 crash，改為置中顯示該步驟說明卡，仍可操作", () => {
    mountDefaultTargets({ "create-factory": "absent" });
    expect(() => render(<OnboardingTour />)).not.toThrow();
    expect(screen.getByText("先建立你的工廠")).toBeTruthy();
    expect(screen.getByText(/完成工廠資料後/)).toBeTruthy();
    // 仍可以正常前進到下一步
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
  });
});
