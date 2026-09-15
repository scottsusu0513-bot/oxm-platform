// @vitest-environment jsdom
/**
 * LoginPopupModal 的「每個本地日曆日最多自動顯示一次」regression test。
 *
 * 背景：訪客版（未登入）toShow 查詢刻意不做任何後端持久化（見
 * server/db.ts 的 getLoginPopupsToShowForGuest()），每次呼叫都直接回傳目前
 * 啟用中的消息；因此訪客的「今天是否已顯示過」只能由前端 localStorage 記錄
 * （見元件內的 GUEST_POPUP_LS_KEY／getLocalDateKey／hasGuestSeenToday／
 * markGuestSeenToday）。這裡驗證的正是這一層：換頁再回首頁、重新整理、
 * 重新 mount 都會讓這個元件整個重新建立（React state 全部歸零），只有
 * localStorage 能撐過這些情境。
 *
 * 會員版（已登入）本來就由後端 (userId, twDateStr()) 唯一索引控制「今天是否
 * 已顯示過」，不受這次改動影響——下面用「已登入時不觸碰 localStorage」的
 * 測試只是確認沒有動到既有行為。
 *
 * mock 模式比照 client/src/components/OnboardingTour.test.tsx：mock
 * @/_core/hooks/useAuth、@/lib/trpc、wouter，避免真的打 tRPC 或載入路由。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const GUEST_POPUP_LS_KEY = "oxm_home_popup_last_shown_date";

let mockIsAuthenticated = false;
let mockAuthLoading = false;
let mockItems: Array<{ id: number; title: string; summary: string; announcementId: number }> = [];
const mockMarkViewedMutate = vi.fn();
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    loading: mockAuthLoading,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    loginPopup: {
      toShow: {
        useQuery: () => ({ data: { items: mockItems } }),
      },
      markViewed: {
        useMutation: () => ({ mutate: mockMarkViewedMutate }),
      },
    },
    useUtils: () => ({ loginPopup: { toShow: { invalidate: mockInvalidate } } }),
  },
}));

import LoginPopupModal from "./LoginPopupModal";

function oneItem(id = 1) {
  return [{ id, title: `公告 ${id}`, summary: "摘要內容", announcementId: id }];
}

function isDialogOpen() {
  return screen.queryByText("最新消息通知") !== null;
}

beforeEach(() => {
  mockIsAuthenticated = false;
  mockAuthLoading = false;
  mockItems = [];
  mockMarkViewedMutate.mockReset();
  mockInvalidate.mockClear();
  localStorage.removeItem(GUEST_POPUP_LS_KEY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.removeItem(GUEST_POPUP_LS_KEY);
});

describe("LoginPopupModal — 訪客一天一次 regression", () => {
  it("(1) 今天第一次進首頁 → 顯示", () => {
    mockItems = oneItem();
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
  });

  it("(2) 同一天離開首頁再回來（元件重新 mount）→ 不顯示", () => {
    mockItems = oneItem();
    const { unmount } = render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
    unmount();

    // 模擬「離開首頁再回來」：全新的元件實例，React state 從零開始，
    // 後端（訪客）還是回傳同一批啟用中的消息。
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(false);
  });

  it("(3) 同一天重新整理（模擬整頁重新 mount）→ 不顯示", () => {
    mockItems = oneItem();
    const { unmount } = render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
    unmount();
    cleanup();

    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(false);
  });

  it("(4) 同一天重新 mount Home → 不顯示", () => {
    mockItems = oneItem();
    const { unmount } = render(<LoginPopupModal />);
    unmount();
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(false);
  });

  it("(5) localStorage 是昨天日期 → 今天顯示", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, "0");
    const d = String(yesterday.getDate()).padStart(2, "0");
    localStorage.setItem(GUEST_POPUP_LS_KEY, `${y}-${m}-${d}`);

    mockItems = oneItem();
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
  });

  it("(6) 今天顯示後正確寫入今天的本地日期", () => {
    mockItems = oneItem();
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);

    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localStorage.getItem(GUEST_POPUP_LS_KEY)).toBe(expected);
  });

  it("(7) 台灣本地跨日後可以重新顯示", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 23, 0, 0)); // 2026-09-15 23:00 本地時間

    mockItems = oneItem();
    const { unmount } = render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
    unmount();

    // 換頁再回來，同一天（23:30）：不應再顯示。
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(false);
    cleanup();

    // 跨過本地日曆日午夜，來到 2026-09-16：應該可以再次顯示。
    vi.setSystemTime(new Date(2026, 8, 16, 0, 30, 0));
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
  });

  it("(8) popup data refetch（相同 id、新的陣列參照）不得造成第二次自動開啟", () => {
    mockItems = oneItem();
    const { rerender } = render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);

    // 使用者關閉面板後，同一批消息重新 refetch（id 相同、陣列參照不同）。
    fireEvent.click(screen.getByRole("button", { name: "我知道了" }));
    expect(isDialogOpen()).toBe(false);

    mockItems = [{ ...oneItem()[0] }]; // 新的陣列/物件參照，id 不變
    rerender(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(false);
  });

  it("已登入會員：不受訪客 localStorage 影響，後端回傳的消息一律自動顯示，並呼叫 markViewed 而非寫入 localStorage", () => {
    mockIsAuthenticated = true;
    mockItems = oneItem();
    render(<LoginPopupModal />);
    expect(isDialogOpen()).toBe(true);
    expect(mockMarkViewedMutate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(GUEST_POPUP_LS_KEY)).toBeNull();
  });
});
