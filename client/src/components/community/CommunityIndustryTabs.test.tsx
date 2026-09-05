// @vitest-environment jsdom
/**
 * Community 產業看板橫向列表 — 桌機滑鼠拖曳捲動 regression test。
 *
 * 需求：桌機使用者應該可以「按住滑鼠 → 左右拖曳 → 整條列表跟著移動」，但不能
 * 因此讓一般點擊（沒有明顯移動）誤判成拖曳、或讓拖曳放開滑鼠時誤觸 tab
 * navigation。這裡直接對真正的 CommunityIndustryTabs.tsx render + 觸發
 * pointer 事件，驗證：
 *   1. 小幅移動（< threshold）視為點擊，正常呼叫 navigate。
 *   2. 超過 threshold 的拖曳會改變容器的 scrollLeft，且放開滑鼠後不會呼叫
 *      navigate（不誤觸）。
 *
 * jsdom 沒有實作 Element.prototype.setPointerCapture／hasPointerCapture／
 * releasePointerCapture，這裡用最小 polyfill（no-op／回傳 false）補上，只是
 * 讓事件流程能在 jsdom 跑起來，不影響真正瀏覽器裡的 pointer capture 行為
 * （那部分需要在真瀏覽器手動驗證，見這次任務的 Browser Validation 段落）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

if (typeof (HTMLElement.prototype as any).setPointerCapture !== "function") {
  (HTMLElement.prototype as any).setPointerCapture = function () {};
  (HTMLElement.prototype as any).releasePointerCapture = function () {};
  (HTMLElement.prototype as any).hasPointerCapture = function () { return true; };
}
if (typeof (HTMLElement.prototype as any).scrollIntoView !== "function") {
  (HTMLElement.prototype as any).scrollIntoView = function () {};
}

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/community/cross-industry/discussions", mockNavigate],
}));

import CommunityIndustryTabs from "./CommunityIndustryTabs";

beforeEach(() => {
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
});

function getTablist(): HTMLElement {
  return screen.getByRole("tablist");
}

function getTab(name: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(name) });
}

describe("CommunityIndustryTabs — 桌機滑鼠拖曳捲動", () => {
  it("一般點擊（沒有移動）：正常觸發 tab navigation", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const tab = getTab("紡織");
    fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(tab, { pointerType: "mouse", clientX: 100, pointerId: 1 });
    fireEvent.click(tab);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("/discussions"));
  });

  it("拖曳超過 threshold：容器 scrollLeft 跟著改變", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireEvent.pointerDown(list, { pointerType: "mouse", clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 150, pointerId: 1 }); // 左拖 50px
    // 往左拖（clientX 變小）應該讓 scrollLeft 增加（往右捲，看到更右邊的內容）。
    expect(list.scrollLeft).toBeGreaterThan(0);
    fireEvent.pointerUp(list, { pointerType: "mouse", clientX: 150, pointerId: 1 });
  });

  it("拖曳超過 threshold 後放開滑鼠：不誤觸 tab navigation", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });
    const tab = getTab("金屬加工");

    fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 150, pointerId: 1 }); // 超過 threshold
    fireEvent.pointerUp(tab, { pointerType: "mouse", clientX: 150, pointerId: 1 });
    // 拖曳放開滑鼠後瀏覽器會連帶觸發一次 click——在 capture 階段應該被擋下。
    fireEvent.click(tab);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("小幅移動（未超過 threshold）仍視為點擊，不當成拖曳", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });
    const tab = getTab("塑膠");

    fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 198, pointerId: 1 }); // 只移動 2px，小於 threshold
    fireEvent.pointerUp(tab, { pointerType: "mouse", clientX: 198, pointerId: 1 });
    fireEvent.click(tab);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("/discussions"));
    expect(list.scrollLeft).toBe(0);
  });

  it("BUG 5 回歸：真實滑鼠點擊常見的 7px 手震位移，仍必須視為點擊、正常切換看板（舊 threshold=5 時這裡會失敗——這正是「看板點不進去」回報的根因，而非路由或資料層問題）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });
    const tab = getTab("電子零件");

    fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 193, pointerId: 1 }); // 7px 手震，真實滑鼠點擊常見範圍
    fireEvent.pointerUp(tab, { pointerType: "mouse", clientX: 193, pointerId: 1 });
    fireEvent.click(tab);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("/discussions"));
  });

  it("touch pointer 完全不觸發自訂拖曳邏輯，維持瀏覽器原生 touch-scroll", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireEvent.pointerDown(list, { pointerType: "touch", clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "touch", clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(list, { pointerType: "touch", clientX: 100, pointerId: 1 });
    // 不接手 touch：scrollLeft 不應該被這裡的程式碼改動（真實瀏覽器上是靠
    // 原生 touch-scroll 處理，jsdom 沒有真的版面/捲動物理效果可測）。
    expect(list.scrollLeft).toBe(0);
  });
});
