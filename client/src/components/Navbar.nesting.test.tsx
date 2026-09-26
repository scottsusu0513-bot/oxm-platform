// @vitest-environment jsdom
/**
 * Navbar 互動元素巢狀 regression（見對話「Navbar <a><button>」）：導頁項目
 * 原本是 <Link><button>…</button></Link>，render 成不合法的 <a><button>。
 * 改成單一 <a>（hub pill 直接用 Link；其他用 Button asChild），UI 動作仍是
 * 單一 <button>。這裡真正 render Navbar（jsdom 不套 CSS，所以桌機與手機版
 * 的元素都會出現在 DOM 裡），不是比對原始碼字串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const authState = vi.hoisted(() => ({
  value: {
    user: null as null | Record<string, unknown>,
    isAuthenticated: false,
    logout: () => {},
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => authState.value }));
vi.mock("@/components/LoginDialog", () => ({ default: () => null }));
vi.mock("@/components/UnverifiedEmailHint", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => {
  const query = { data: undefined, isLoading: false, refetch: () => {} };
  const leaf: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "useQuery") return () => query;
      if (prop === "useMutation") return () => ({ mutate: () => {}, isPending: false });
      if (prop === "useUtils") return () => leaf;
      return leaf;
    },
    apply: () => leaf,
  });
  return { trpc: leaf };
});

import Navbar from "./Navbar";

const LOGGED_IN_ADMIN = {
  user: { id: 1, name: "測試使用者", email: "t@example.test", role: "admin", isFactoryOwner: true, primaryEmailVerifiedAt: new Date() },
  isAuthenticated: true,
  logout: () => {},
};
const LOGGED_OUT = { user: null, isAuthenticated: false, logout: () => {} };

function expectNoInteractiveNesting() {
  expect(document.querySelectorAll("a a, a button, button a, button button").length).toBe(0);
}

function desktopHub(label: string): HTMLElement {
  const nav = document.querySelector('nav[data-onboarding="services-nav"]')!;
  return Array.from(nav.querySelectorAll<HTMLElement>("a, button")).find((el) => el.textContent?.trim() === label)!;
}

function openMobileMenu() {
  fireEvent.click(document.querySelector('[data-onboarding="services-menu"]')!);
}

let pushState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.history.replaceState(null, "", "/search");
  pushState = vi.spyOn(window.history, "pushState");
});
afterEach(() => {
  pushState.mockRestore();
  cleanup();
});

describe("Navbar — no nested interactive elements", () => {
  it("logged in (desktop + mobile header + opened mobile menu)", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    expectNoInteractiveNesting();
    act(() => openMobileMenu());
    expectNoInteractiveNesting();
  });

  it("logged out (desktop + opened mobile menu)", () => {
    authState.value = LOGGED_OUT;
    render(<Navbar />);
    expectNoInteractiveNesting();
    act(() => openMobileMenu());
    expectNoInteractiveNesting();
  });
});

describe("Navbar — navigation links", () => {
  it("desktop hub pills with their own page are single links with the dropdown ARIA kept", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    // 找工廠：有 href、刻意沒有下拉子項（dropdownItems: []）→ 純連結、沒有 popup ARIA
    const hub = desktopHub("找工廠");
    expect(hub.tagName).toBe("A");
    expect(hub.getAttribute("href")).toBe("/search");
    expect(hub.hasAttribute("aria-haspopup")).toBe(false);
    // 找資源／找形象：有 href 且有下拉 → 連結上保留 aria-haspopup／expanded／controls
    for (const [label, href, key] of [["找資源", "/resources", "resource"], ["找形象", "/brand", "brand"]]) {
      const el = desktopHub(label);
      expect(el.tagName).toBe("A");
      expect(el.getAttribute("href")).toBe(href);
      expect(el.getAttribute("aria-haspopup")).toBe("menu");
      expect(el.getAttribute("aria-expanded")).toBe("false");
      expect(el.getAttribute("aria-controls")).toBe(`hub-dropdown-${key}`);
    }
    fireEvent.click(hub);
    expect(String(pushState.mock.calls.at(-1)?.[2])).toBe("/search");
  });

  it("hover opens the hub dropdown; Escape closes it and returns focus to the link", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    const hub = desktopHub("找資源");
    fireEvent.mouseEnter(hub.parentElement!);
    expect(hub.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("hub-dropdown-resource")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hub.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(hub);
  });

  it("hubs without their own page stay dropdown-trigger buttons", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    const trigger = screen.getAllByRole("button").find((b) => b.textContent?.trim() === "找消息")!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("messages / notifications icons are links (desktop and mobile header) keeping their titles", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    const messages = document.querySelectorAll('a[href="/messages"]');
    const notifications = document.querySelectorAll('a[href="/notifications"]');
    expect(messages.length).toBe(2);
    expect(notifications.length).toBe(2);
    expect(document.querySelector('a[href="/messages"][title="我的訊息"]')).toBeTruthy();
    expect(document.querySelector('a[href="/notifications"][title="通知中心"]')).toBeTruthy();
    fireEvent.click(messages[0]);
    expect(String(pushState.mock.calls.at(-1)?.[2])).toBe("/messages");
  });

  it("mobile menu account items are links; logout stays a button", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    act(() => openMobileMenu());
    const dashboard = document.querySelector('a[data-onboarding="factory-dashboard-mobile-item"]');
    expect(dashboard?.getAttribute("href")).toBe("/dashboard");
    expect(document.querySelector('a[href="/admin"]')?.textContent).toContain("管理員");
    const member = Array.from(document.querySelectorAll('a[href="/member"]')).find((a) => a.textContent?.includes("會員中心"));
    expect(member).toBeTruthy();
    const logout = screen.getAllByRole("button").find((b) => b.textContent?.trim() === "登出");
    expect(logout?.tagName).toBe("BUTTON");
    fireEvent.click(member!);
    expect(String(pushState.mock.calls.at(-1)?.[2])).toBe("/member");
  });

  it("logged out: register-factory is a link (desktop + mobile menu), login / register-user stay buttons", () => {
    authState.value = LOGGED_OUT;
    render(<Navbar />);
    act(() => openMobileMenu());
    expect(document.querySelectorAll('a[href="/register-factory"]').length).toBe(2);
    const loginButtons = screen.getAllByRole("button").filter((b) => b.textContent?.trim() === "登入");
    expect(loginButtons.length).toBeGreaterThan(0);
    for (const b of loginButtons) expect(b.tagName).toBe("BUTTON");
  });

  it("keyboard: links are focusable anchors with href (Enter activates natively)", () => {
    authState.value = LOGGED_IN_ADMIN;
    render(<Navbar />);
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/messages"], a[href="/search"]'))) {
      expect(a.hasAttribute("href")).toBe(true);
      expect(a.tabIndex).toBe(0);
      a.focus();
      expect(document.activeElement).toBe(a);
    }
  });
});
