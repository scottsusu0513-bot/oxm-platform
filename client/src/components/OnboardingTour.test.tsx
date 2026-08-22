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
// jsdom 沒有真的實作 window.scrollTo，預設呼叫會印出 "Not implemented" 噪音
// （導覽結束時的 lock effect cleanup 一律會呼叫一次）；個別測試需要驗證
// 呼叫參數時會自行覆寫成 spy 並在 finally 還原。
window.scrollTo = (() => {}) as typeof window.scrollTo;

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

type Rect = { top: number; left: number; width: number; height: number };
const DEFAULT_RECT: Rect = { top: 120, left: 40, width: 200, height: 44 };

function mountTarget(key: string, visibility: Visibility, rect: Rect = DEFAULT_RECT) {
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
    value: () => ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }),
    configurable: true,
  });
  const scrollIntoViewSpy = vi.fn();
  Object.defineProperty(el, "scrollIntoView", { value: scrollIntoViewSpy, configurable: true });
  injectedEls.push(el);
  return el;
}

function mountDefaultTargets(overrides: Partial<Record<string, Visibility>> = {}) {
  const defaults: Record<string, Visibility> = {
    "factory-dashboard-desktop-item": "visible",
    "factory-dashboard-mobile-item": "hidden",
    "search-panel": "visible",
    "services-nav": "visible",
    "services-hub-mobile": "hidden",
    "reservation-button": "visible",
    "reservation-qr": "visible",
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
    expect(screen.queryByText("先從工廠後台開始")).toBeNull();
  });

  it("(11) 非首頁不顯示導覽", () => {
    mockPathname = "/search";
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.queryByText("先從工廠後台開始")).toBeNull();
  });

  it("needsOnboarding 為 false 時不顯示導覽", () => {
    mockUser = { id: 1, needsConsent: false, needsOnboarding: false };
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.queryByText("先從工廠後台開始")).toBeNull();
  });

  it("(1) Step 1 文案與 target：標示右上角帳號選單（工廠後台入口），顯示標題、說明與 1/4 進度", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(screen.getByText("先從工廠後台開始")).toBeTruthy();
    expect(screen.getByText(/點擊右上角帳號選單，進入工廠後台/)).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    // 第一步不應該有「上一步」
    expect(screen.queryByRole("button", { name: "上一步" })).toBeNull();
  });

  it("(1b) Step 1 mobile：desktop item 不存在、mobile item 可見時仍能解析出 target 並顯示 spotlight（不是只 highlight 漢堡按鈕，也不是置中 fallback）", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({ "factory-dashboard-desktop-item": "absent", "factory-dashboard-mobile-item": "visible" });
    render(<OnboardingTour />);
    expect(screen.getByText("先從工廠後台開始")).toBeTruthy();
    expect(document.querySelector(".ring-orange-400")).toBeTruthy();
  });

  it("(2) 下一步：從 Step 1 前進到 Step 2（整個搜尋區塊）", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
    expect(screen.getByText(/在這個搜尋區塊中設定產業、地區與關鍵字條件/)).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it("(3) 上一步：從 Step 2 返回 Step 1", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
    clickButton("上一步");
    expect(screen.getByText("先從工廠後台開始")).toBeTruthy();
  });

  it("(4) Step 3 desktop：spotlight 對準 services-nav（桌機頂列，永遠可見，不需要打開任何選單）", () => {
    mountDefaultTargets({ "services-nav": "visible", "services-hub-mobile": "hidden" });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("探索 OXM 的六大主要服務")).toBeTruthy();
    expect(document.querySelector(".ring-orange-400")).toBeTruthy();
  });

  it("(5) Step 3 mobile：services-nav 隱藏、六大入口區塊（services-hub-mobile）可見時，target 是整個入口區塊本身，不是漢堡按鈕", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({ "services-nav": "hidden", "services-hub-mobile": "visible" });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("探索 OXM 的六大主要服務")).toBeTruthy();
    expect(document.querySelector(".ring-orange-400")).toBeTruthy();
  });

  it("(6) Step 4 spotlight 對準線上預約按鈕，輕量提及 LINE（不再以 QR 圖片為主），按鈕改為「完成導覽」", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步");
    expect(screen.getByText("需要協助，直接找 OXM")).toBeTruthy();
    expect(screen.getByText(/可直接使用右下角的線上預約/)).toBeTruthy();
    // 不再以 QR code 圖片作為主要展示內容
    expect(screen.queryByAltText("OXM 官方 LINE QR Code")).toBeNull();
    const link = screen.getByRole("link", { name: "LINE" }) as HTMLAnchorElement;
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
    expect(screen.getByText("先從工廠後台開始")).toBeTruthy();
  });

  it("(12) target 找不到時不 crash，改為置中顯示該步驟說明卡，仍可操作", () => {
    mountDefaultTargets({ "factory-dashboard-desktop-item": "absent", "factory-dashboard-mobile-item": "absent" });
    expect(() => render(<OnboardingTour />)).not.toThrow();
    expect(screen.getByText("先從工廠後台開始")).toBeTruthy();
    expect(screen.getByText(/點擊右上角帳號選單，進入工廠後台/)).toBeTruthy();
    // 仍可以正常前進到下一步
    clickButton("下一步");
    expect(screen.getByText("尋找新的合作夥伴")).toBeTruthy();
  });

  it("(13) 開啟導覽期間用 body position:fixed 鎖住背景捲動（不只 overflow:hidden）", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
  });

  it("(14) 導覽結束（needsOnboarding 變 false）後恢復原本的捲動狀態", () => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    document.body.style.position = "static";
    mountDefaultTargets();
    const { rerender } = render(<OnboardingTour />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    mockUser = { id: 1, needsConsent: false, needsOnboarding: false };
    rerender(<OnboardingTour />);
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.position).toBe("static");
  });

  it("(14b) 結束導覽時用 window.scrollTo 精準恢復到開啟前的 scrollY", () => {
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true, writable: true });
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
    try {
      mountDefaultTargets();
      const { rerender } = render(<OnboardingTour />);
      mockUser = { id: 1, needsConsent: false, needsOnboarding: false };
      rerender(<OnboardingTour />);
      expect(scrollToSpy).toHaveBeenCalledWith(0, 300);
    } finally {
      window.scrollTo = originalScrollTo;
    }
  });

  it("(15) 進入最後一步時展開線上預約說明卡、離開該步驟後收回", () => {
    mountDefaultTargets();
    const showSpy = vi.fn();
    const hideSpy = vi.fn();
    window.addEventListener("oxm:onboarding-show-reservation", showSpy);
    window.addEventListener("oxm:onboarding-hide-reservation", hideSpy);
    try {
      render(<OnboardingTour />);
      expect(showSpy).not.toHaveBeenCalled();
      clickButton("下一步");
      clickButton("下一步");
      clickButton("下一步");
      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(hideSpy).not.toHaveBeenCalled();
      clickButton("上一步");
      expect(hideSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("oxm:onboarding-show-reservation", showSpy);
      window.removeEventListener("oxm:onboarding-hide-reservation", hideSpy);
    }
  });

  it("(16) Step 1 desktop：進入時 dispatch 打開帳號下拉選單事件、離開後 dispatch 收合，且沒有 dispatch 手機版選單事件", () => {
    mountDefaultTargets();
    const openDesktop = vi.fn();
    const closeDesktop = vi.fn();
    const openMobile = vi.fn();
    window.addEventListener("oxm:onboarding-open-factory-menu-desktop", openDesktop);
    window.addEventListener("oxm:onboarding-close-factory-menu-desktop", closeDesktop);
    window.addEventListener("oxm:onboarding-open-mobile-menu", openMobile);
    try {
      render(<OnboardingTour />);
      expect(openDesktop).toHaveBeenCalledTimes(1);
      expect(openMobile).not.toHaveBeenCalled();
      expect(closeDesktop).not.toHaveBeenCalled();
      clickButton("下一步");
      expect(closeDesktop).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("oxm:onboarding-open-factory-menu-desktop", openDesktop);
      window.removeEventListener("oxm:onboarding-close-factory-menu-desktop", closeDesktop);
      window.removeEventListener("oxm:onboarding-open-mobile-menu", openMobile);
    }
  });

  it("(17) Step 1 mobile：進入時 dispatch 打開漢堡選單事件、離開後 dispatch 收合，且沒有 dispatch 桌機版事件", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({ "factory-dashboard-desktop-item": "hidden", "factory-dashboard-mobile-item": "visible" });
    const openMobile = vi.fn();
    const closeMobile = vi.fn();
    const openDesktop = vi.fn();
    window.addEventListener("oxm:onboarding-open-mobile-menu", openMobile);
    window.addEventListener("oxm:onboarding-close-mobile-menu", closeMobile);
    window.addEventListener("oxm:onboarding-open-factory-menu-desktop", openDesktop);
    try {
      render(<OnboardingTour />);
      expect(openMobile).toHaveBeenCalledTimes(1);
      expect(openDesktop).not.toHaveBeenCalled();
      clickButton("下一步");
      expect(closeMobile).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("oxm:onboarding-open-mobile-menu", openMobile);
      window.removeEventListener("oxm:onboarding-close-mobile-menu", closeMobile);
      window.removeEventListener("oxm:onboarding-open-factory-menu-desktop", openDesktop);
    }
  });

  it("(17b) Step 3 mobile：進入時同樣 dispatch 打開漢堡選單事件（六大入口區塊也在選單裡）、離開後收合", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "services-nav": "hidden",
      "services-hub-mobile": "visible",
    });
    const openMobile = vi.fn();
    const closeMobile = vi.fn();
    window.addEventListener("oxm:onboarding-open-mobile-menu", openMobile);
    window.addEventListener("oxm:onboarding-close-mobile-menu", closeMobile);
    try {
      render(<OnboardingTour />);
      openMobile.mockClear(); // Step 1 進入時也會 dispatch 一次，先清掉只看 Step 3 這次
      clickButton("下一步"); // → Step 2
      clickButton("下一步"); // → Step 3
      expect(openMobile).toHaveBeenCalled();
      clickButton("下一步"); // → Step 4，離開 Step 3
      expect(closeMobile).toHaveBeenCalled();
    } finally {
      window.removeEventListener("oxm:onboarding-open-mobile-menu", openMobile);
      window.removeEventListener("oxm:onboarding-close-mobile-menu", closeMobile);
    }
  });

  it("(18) Desktop：不呼叫 scrollIntoView，切換 step 不會嘗試把背景捲到 target", () => {
    const scrollIntoViewSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    try {
      mountDefaultTargets();
      render(<OnboardingTour />);
      clickButton("下一步");
      clickButton("下一步");
      clickButton("下一步");
      clickButton("上一步");
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("(19) Desktop：Step 1→2→3→4→上一步 全程 window.scrollY 維持不變（已驗收行為，不受這輪 mobile 調整影響）", () => {
    Object.defineProperty(window, "scrollY", { value: 240, configurable: true, writable: true });
    mountDefaultTargets();
    render(<OnboardingTour />);
    const initialScrollY = window.scrollY;
    clickButton("下一步");
    expect(window.scrollY).toBe(initialScrollY);
    clickButton("下一步");
    expect(window.scrollY).toBe(initialScrollY);
    clickButton("下一步");
    expect(window.scrollY).toBe(initialScrollY);
    clickButton("上一步");
    expect(window.scrollY).toBe(initialScrollY);
  });

  it("(20) Mobile Step 1：target 位於漢堡選單自己的捲動容器裡，會呼叫 scrollIntoView 把它捲進畫面（不影響外層背景，見上面 (19) 桌機規則不變）", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({ "factory-dashboard-desktop-item": "hidden", "factory-dashboard-mobile-item": "visible" });
    render(<OnboardingTour />);
    const item = document.querySelector('[data-onboarding="factory-dashboard-mobile-item"]') as HTMLElement;
    expect(item.scrollIntoView).toHaveBeenCalled();
  });

  it("(21) Mobile Step 3：六大入口區塊也是用 scrollIntoView 定位，不是移動外層背景", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "services-nav": "hidden",
      "services-hub-mobile": "visible",
    });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    const hub = document.querySelector('[data-onboarding="services-hub-mobile"]') as HTMLElement;
    expect(hub.scrollIntoView).toHaveBeenCalled();
  });

  it("(22) Mobile Step 2：搜尋面板不在選單裡，改成直接調整鎖定中 body 的 top 位移量（而不是呼叫 scrollIntoView 或 window.scrollTo）", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
    try {
      mountDefaultTargets({ "factory-dashboard-desktop-item": "hidden", "factory-dashboard-mobile-item": "visible" });
      render(<OnboardingTour />);
      const topAfterLock = document.body.style.top; // 進入 Step 1 時鎖定 body 產生的初始 top
      clickButton("下一步"); // → Step 2（搜尋面板）
      const panel = document.querySelector('[data-onboarding="search-panel"]') as HTMLElement;
      // 搜尋面板的 target 不在選單容器裡，不應該呼叫 scrollIntoView。
      expect(panel.scrollIntoView).not.toHaveBeenCalled();
      // body.style.top 應該因為程式性定位而改變（從鎖定時的初始值調整過）。
      expect(document.body.style.top).not.toBe(topAfterLock);
      // 全程不能呼叫 window.scrollTo（那樣等於真的移動使用者能感知的捲動位置／
      // 會被誤認為解鎖），程式性定位只能透過調整鎖定中的 body.style.top 完成。
      expect(scrollToSpy).not.toHaveBeenCalled();
    } finally {
      window.scrollTo = originalScrollTo;
    }
  });

  it("(23) Mobile Step 4：手機版 target 改成 QR Code 圖片（reservation-qr），不是整個線上預約區塊（reservation-button），並用 scrollIntoView 確保 QR 在卡片自己的捲動容器裡可見", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "services-nav": "hidden",
      "services-hub-mobile": "visible",
    });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步"); // → Step 4
    const qr = document.querySelector('[data-onboarding="reservation-qr"]') as HTMLElement;
    const reservationWrapper = document.querySelector('[data-onboarding="reservation-button"]') as HTMLElement;
    expect(qr.scrollIntoView).toHaveBeenCalled();
    // target 真的換成 QR Code，不是整個線上預約 wrapper（wrapper 本身沒有被
    // 呼叫 scrollIntoView，因為它根本不是 resolveVisibleTarget 找到的元素）。
    expect(reservationWrapper.scrollIntoView).not.toHaveBeenCalled();
    // 手機版文案改成引導掃 QR Code，不再寫「使用右下角線上預約」。
    expect(screen.getByText(/掃描 QR Code，直接透過官方 LINE 與我們聯繫/)).toBeTruthy();
    expect(screen.queryByText(/可直接使用右下角的線上預約/)).toBeNull();
  });

  it("(23b) Mobile Step 4：spotlight 的 target 確定不是 reservation-button（桌機用的那個 key），避免手機版又框住整個展開卡片", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "services-nav": "hidden",
      "services-hub-mobile": "visible",
      // reservation-button 的 rect 故意設超大，如果 target 解析錯誤變回它，
      // spotlight 尺寸就會明顯不同於 QR 的 DEFAULT_RECT，方便測試分辨。
    });
    mountTarget("reservation-button", "visible", { top: 500, left: 20, width: 335, height: 300 });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步"); // → Step 4
    const ring = document.querySelector(".ring-orange-400") as HTMLElement;
    // 命中 reservation-qr 的 DEFAULT_RECT（width 200），而不是 reservation-button
    // 特意放大的 rect（width 335）。
    expect(ring.style.width).toBe(`${DEFAULT_RECT.width + 16}px`);
  });

  it("(24) Mobile Step 4 導覽卡一律用 bottom 錨定可視範圍下緣（不再用無邊界的 top 往下長），避免蓋住 QR Code、也避免被 Safari 工具列吃掉一角", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "services-nav": "hidden",
      "services-hub-mobile": "visible",
      "reservation-qr": "absent",
    });
    mountTarget("reservation-qr", "visible", { top: 700, left: 200, width: 130, height: 130 });
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步"); // → Step 4，QR 貼近畫面下緣（top=700, height=130, viewport 800）
    const cardContainer = screen.getByText("需要協助，直接找 OXM").closest("div[style]") as HTMLElement;
    // 一律用 bottom 錨定可視範圍下緣（不再是 top 往下長），保證卡片不會超出
    // 可視範圍下緣、也不會蓋住貼近下緣的 QR Code。
    expect(cardContainer.style.top).toBe("");
    expect(cardContainer.style.bottom).toContain("env(safe-area-inset-bottom");
  });

  it("(24b) Mobile Step 2 導覽卡即使放在 target 下方（below 分支），也一律用 bottom 錨定可視範圍下緣，不再用無邊界的 top 往下長（這次要修的 Step 2 溢出問題）", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    mountDefaultTargets({
      "factory-dashboard-desktop-item": "hidden",
      "factory-dashboard-mobile-item": "visible",
      "search-panel": "absent",
    });
    // 搜尋面板貼近畫面上半部：上方空間小、下方空間大 → 會走 below 分支。
    mountTarget("search-panel", "visible", { top: 100, left: 20, width: 335, height: 120 });
    render(<OnboardingTour />);
    clickButton("下一步"); // → Step 2
    const cardContainer = screen.getByText("尋找新的合作夥伴").closest("div[style]") as HTMLElement;
    expect(cardContainer.style.top).toBe("");
    // below 分支固定用 20px 安全間距錨定下緣（不再是 rect.bottom + MARGIN 往下長）。
    expect(cardContainer.style.bottom).toContain("20px");
    expect(cardContainer.style.bottom).toContain("env(safe-area-inset-bottom");
  });

  it("(24c) Mobile 導覽卡優先用 window.visualViewport.height 而不是 window.innerHeight 判斷上下剩餘空間（Safari 工具列讓兩者不同時，以 visualViewport 為準）", () => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    (window as any).visualViewport = { height: 650, offsetTop: 0 };
    try {
      mountDefaultTargets({
        "factory-dashboard-desktop-item": "hidden",
        "factory-dashboard-mobile-item": "visible",
        "search-panel": "absent",
      });
      // rect.top=300、height=100：用 innerHeight(800) 算，下方剩餘空間(400) >
      // 上方剩餘空間(300) → 應該放下方；但用 visualViewport.height(650) 算，
      // 下方剩餘空間只剩 250 < 上方 300 → 應該改放上方。藉此驗證真的優先用
      // visualViewport 而不是 innerHeight。
      mountTarget("search-panel", "visible", { top: 300, left: 20, width: 335, height: 100 });
      render(<OnboardingTour />);
      clickButton("下一步"); // → Step 2
      const cardContainer = screen.getByText("尋找新的合作夥伴").closest("div[style]") as HTMLElement;
      // 放上方分支的 bottom 數值＝viewportH(650) - rect.top(300) + MARGIN(16) = 366，
      // 如果誤用 innerHeight(800) 會走下方分支，bottom 會是常數 20，兩者可明確分辨。
      expect(cardContainer.style.bottom).toContain("366px");
    } finally {
      delete (window as any).visualViewport;
    }
  });

  it("(24d) Desktop 完全不受這次手機版調整影響：Step 4 target 仍是 reservation-button，文案仍是原本桌機版說明，不會出現手機版 QR Code 文案", () => {
    mountDefaultTargets();
    render(<OnboardingTour />);
    clickButton("下一步");
    clickButton("下一步");
    clickButton("下一步"); // → Step 4
    const reservationWrapper = document.querySelector('[data-onboarding="reservation-button"]') as HTMLElement;
    expect(reservationWrapper.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByText(/可直接使用右下角的線上預約/)).toBeTruthy();
    expect(screen.queryByText(/掃描 QR Code，直接透過官方 LINE 與我們聯繫/)).toBeNull();
  });
});
