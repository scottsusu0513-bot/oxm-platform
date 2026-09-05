// @vitest-environment jsdom
/**
 * 桌機滑鼠拖曳橫向捲動 — 第三輪重新加入的 regression test（見對話「重新
 * 加入桌機拖曳」）。
 *
 * 這一版刻意避開上一版（已被移除）那種「掛在容器上、靠 justDraggedRef
 * 旗標被動等下一次 click 消費」的攔截式設計——那個設計的 bug 是：只要放開
 * 滑鼠的位置剛好在容器範圍之外，對應的 click 事件根本不會進到容器的
 * onClickCapture，旗標就會永遠卡在 true，導致之後所有點擊的第一次都被
 * 誤判成拖曳而整個吃掉，且跟門檻設多少完全無關。
 *
 * 新設計改成：判斷拖曳的 pointermove／pointerup／pointercancel 監聽器全部
 * 掛在 document／window 上（不用 setPointerCapture），不論放開滑鼠的實際
 * 位置在哪裡都一定收得到；只有真的判定為拖曳時，才會在 pointerup 當下
 * 「臨時」掛一個 document 層級、capture 階段、一次性（fire 一次就立刻自己
 * 移除，並有逾時保底）的 click 抑制器，只吃掉這次拖曳自己緊接在後的那一次
 * click，不存在任何可能永久卡住的旗標。這裡的測試因此同時涵蓋兩件事：
 * 一般點擊在任何位移量下都必須 100% 觸發 navigate；真正的水平拖曳（含
 * 放開位置在容器外）能正確捲動且不誤觸 navigate，且拖曳結束後下一次點擊
 * 立刻恢復正常。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/community/cross-industry/discussions", mockNavigate],
}));

if (typeof (HTMLElement.prototype as any).scrollIntoView !== "function") {
  (HTMLElement.prototype as any).scrollIntoView = function () {};
}

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

let pointerId = 0;
function nextPointerId() {
  pointerId += 1;
  return pointerId;
}

// 完整重現一次「pointerdown on tab → pointermove(dx, dy) → pointerup →
// 瀏覽器原生緊接觸發的 click」序列——jsdom 不會自動從 pointer 事件合成
// click，這裡跟真實瀏覽器行為一樣手動補上最後一步。
function fireClickWithMovement(tab: HTMLElement, dx: number, dy: number = 0) {
  const id = nextPointerId();
  const startX = 200;
  const startY = 100;
  fireEvent.pointerDown(tab, { pointerType: "mouse", button: 0, clientX: startX, clientY: startY, pointerId: id });
  fireEvent.pointerMove(document, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: id });
  fireEvent.pointerUp(document, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: id });
  fireEvent.click(tab);
}

// 完整重現一次真正的水平拖曳，並允許在指定（可能在容器外）的座標放開滑鼠。
function fireDrag(startEl: HTMLElement, dx: number, dy: number, releaseOutside = false) {
  const id = nextPointerId();
  const startX = 200;
  const startY = 100;
  fireEvent.pointerDown(startEl, { pointerType: "mouse", button: 0, clientX: startX, clientY: startY, pointerId: id });
  fireEvent.pointerMove(document, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: id });
  const releaseTarget = releaseOutside ? document.body : startEl;
  fireEvent.pointerUp(releaseTarget, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: id });
  // 真實瀏覽器在放開滑鼠後會緊接合成一次 click；抑制器要負責擋下它。
  fireEvent.click(releaseTarget === document.body ? document.body : startEl);
}

describe("CommunityIndustryTabs — 一般點擊在任何位移量下都必須 100% 觸發 navigate", () => {
  it("零位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("紡織"), 0, 0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("textile"));
  });

  it("3px 位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("金屬加工"), 3);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("metal-processing"));
  });

  it("7px 位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("電子零件"), 7);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("electronics"));
  });

  it("10px 位移點擊：navigate（門檻是「大於」10px 才算拖曳，剛好 10px 仍是點擊）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("塑膠"), 10);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("plastic"));
  });

  it("小幅對角位移點擊：navigate（水平位移沒有明顯主導於垂直位移，不算拖曳）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("木工"), 8, 8);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("woodworking"));
  });
});

describe("CommunityIndustryTabs — 真正水平拖曳會捲動、不會誤觸 navigate，且不留殘留狀態", () => {
  it("100px 水平拖曳：容器 scrollLeft 改變，且不觸發 navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireDrag(getTab("電子零件"), -100, 0);

    expect(list.scrollLeft).toBeGreaterThan(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("拖曳放開滑鼠的位置在容器範圍之外：抑制仍然正常運作，且沒有留下任何殘留狀態", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireDrag(getTab("塑膠"), -100, 0, /* releaseOutside */ true);

    expect(mockNavigate).not.toHaveBeenCalled();

    // 這正是上一版的根本 bug 場景：放開滑鼠在容器外之後，下一次完全獨立、
    // 正常的點擊必須立刻恢復可用，不能被上一次拖曳留下的任何狀態誤傷。
    fireClickWithMovement(getTab("跨產業交流"), 0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("cross-industry"));
  });

  it("拖曳結束後，緊接著的下一次一般點擊必須正常 navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireDrag(getTab("包裝"), 100, 0);
    expect(mockNavigate).not.toHaveBeenCalled();

    fireClickWithMovement(getTab("食品"), 2);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("food"));
  });

  it("pointercancel 之後，下一次一般點擊必須正常 navigate（pointercancel 不會、也不應該掛任何 click 抑制器）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const tab = getTab("印刷");
    const id = nextPointerId();
    fireEvent.pointerDown(tab, { pointerType: "mouse", button: 0, clientX: 200, clientY: 100, pointerId: id });
    fireEvent.pointerMove(document, { pointerType: "mouse", clientX: 260, clientY: 100, pointerId: id });
    fireEvent.pointerCancel(document, { pointerType: "mouse", pointerId: id });

    fireClickWithMovement(tab, 0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("printing"));
  });

  it("touch pointer 完全不觸發自製拖曳邏輯，一般點擊正常 navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });
    const tab = getTab("永續材料");

    const id = nextPointerId();
    fireEvent.pointerDown(tab, { pointerType: "touch", clientX: 200, clientY: 100, pointerId: id });
    fireEvent.pointerMove(document, { pointerType: "touch", clientX: 100, clientY: 100, pointerId: id });
    fireEvent.pointerUp(tab, { pointerType: "touch", clientX: 100, clientY: 100, pointerId: id });
    fireEvent.click(tab);

    expect(list.scrollLeft).toBe(0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("sustainable-materials"));
  });

  it("連續多次「拖曳→點擊」交替：每一次點擊都必須各自正確 navigate，拖曳不會互相污染", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = getTablist();
    Object.defineProperty(list, "scrollLeft", { value: 0, writable: true, configurable: true });

    fireDrag(getTab("紡織"), 100, 0, true);
    fireClickWithMovement(getTab("塑膠"), 3);
    fireDrag(getTab("木工"), -100, 0);
    fireClickWithMovement(getTab("跨產業交流"), 0);

    expect(mockNavigate).toHaveBeenNthCalledWith(1, expect.stringContaining("plastic"));
    expect(mockNavigate).toHaveBeenNthCalledWith(2, expect.stringContaining("cross-industry"));
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });
});
