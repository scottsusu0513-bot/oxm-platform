// @vitest-environment jsdom
/**
 * 產業看板點不進去的正式站回歸測試（見對話「臺灣傳產論壇看板點不進去」
 * 第二輪 Audit，取代舊版只鎖定 DRAG_THRESHOLD_PX 的測試）。
 *
 * 真正 root cause：舊版自製 pointer-capture drag-to-scroll 邏輯裡的
 * justDraggedRef 旗標，只有在下一次 click 事件真的進到容器的 onClickCapture
 * 才會被重置——但 pointer capture 不影響瀏覽器原生 click 的目標判定，只要
 * 一次拖曳放開滑鼠的位置剛好在容器範圍之外，對應的 click 根本不會進到這個
 * capture handler，旗標就會永遠卡在 true，導致「之後不管點幾次任何一個 tab，
 * 第一次真正進到 capture handler 的 click 都會被誤判成拖曳而整個吃掉」——
 * 這跟門檻設多少完全無關（上一輪 5px→15px 已證實無效，正式站人工複測仍能
 * 重現，且症狀明確是 focus/hover 樣式有出現但 onClick 沒有執行）。
 *
 * 修法：整個移除這套自製攔截機制，改成完全依賴瀏覽器原生 overflow-x-auto
 * 捲動（含原生 scrollbar 可直接拖曳）。這裡的測試因此不是「驗證某個攔截
 * 邏輯的門檻抓得夠準」，而是反過來鎖定「元件本身完全沒有任何邏輯會攔截或
 * 延遲 click」這個更強的保證——不論 click 之前有沒有伴隨任何 pointer 事件
 * 序列（零位移、小位移、對角位移、真正拖曳、pointercancel），onClick 都必須
 * 100% 正常觸發，且任何一次互動都不會在後續互動裡留下殘留狀態。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

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

function getTab(name: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(name) });
}

// Fires a pointerdown → pointermove(dx, dy) → pointerup → click sequence on
// `tab`, mirroring a real click (jsdom doesn't synthesize click from pointer
// events on its own, so the click is fired explicitly, same as before).
function fireClickWithMovement(tab: HTMLElement, dx: number, dy: number = 0) {
  const startX = 200;
  const startY = 100;
  fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: startX, clientY: startY, pointerId: 1 });
  fireEvent.pointerMove(tab, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: 1 });
  fireEvent.pointerUp(tab, { pointerType: "mouse", clientX: startX + dx, clientY: startY + dy, pointerId: 1 });
  fireEvent.click(tab);
}

describe("CommunityIndustryTabs — 一般點擊在任何情況下都必須 100% 觸發 navigate", () => {
  it("零位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("紡織"), 0, 0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("textile"));
  });

  it("3px 位移點擊：navigate（正常手震範圍）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("金屬加工"), 3);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("metal-processing"));
  });

  it("7px 位移點擊：navigate（上一輪回報過的實際失效位移量）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("電子零件"), 7);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("electronics"));
  });

  it("10px 位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("塑膠"), 10);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("plastic"));
  });

  it("小幅對角位移點擊：navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("木工"), 6, 5);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("woodworking"));
  });

  it("真正水平拖曳（100px+，且放開滑鼠時已經不在任何 tab 按鈕上）：不會誤觸發任何 navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = screen.getByRole("tablist");
    // 模擬放開滑鼠時位置已經在 tablist 容器之外——這正是舊版 bug 的觸發
    // 條件。元件本身現在完全沒有 pointer handler，這裡只確認：光是這串
    // pointer 事件序列本身（不含任何 click）不會憑空觸發 navigate。
    fireEvent.pointerDown(list, { pointerType: "mouse", clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 80, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(document.body, { pointerType: "mouse", clientX: 80, clientY: 100, pointerId: 1 });
    // 真實瀏覽器在 mousedown/mouseup 目標不同時完全不會合成 click 事件，
    // 這裡不手動觸發 click，等同於重現「放開位置在容器外」的真實結果。
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("拖曳序列之後，下一次一般點擊仍必須正常 navigate（不會被前一次拖曳留下任何殘留狀態影響）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const list = screen.getByRole("tablist");
    fireEvent.pointerDown(list, { pointerType: "mouse", clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(list, { pointerType: "mouse", clientX: 80, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(document.body, { pointerType: "mouse", clientX: 80, clientY: 100, pointerId: 1 });

    fireClickWithMovement(getTab("包裝"), 2);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("packaging"));
  });

  it("pointercancel 之後，下一次一般點擊仍必須正常 navigate", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const tab = getTab("食品");
    fireEvent.pointerDown(tab, { pointerType: "mouse", clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(tab, { pointerType: "mouse", clientX: 250, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(tab, { pointerType: "mouse", pointerId: 1 });

    fireClickWithMovement(tab, 0);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("food"));
  });

  it("touch pointer 的一般點擊也正常 navigate（本來就沒有任何自製攔截邏輯）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    const tab = getTab("印刷");
    fireEvent.pointerDown(tab, { pointerType: "touch", clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(tab, { pointerType: "touch", clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(tab, { pointerType: "touch", clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.click(tab);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining("printing"));
  });

  it("連續多次點擊不同 tab：每一次都必須各自正常 navigate（狂點也不能有任何一次被吃掉）", () => {
    render(<CommunityIndustryTabs activeSpaceCode="cross-industry" />);
    fireClickWithMovement(getTab("紡織"), 4);
    fireClickWithMovement(getTab("塑膠"), 8);
    fireClickWithMovement(getTab("跨產業交流"), 0);
    expect(mockNavigate).toHaveBeenNthCalledWith(1, expect.stringContaining("textile"));
    expect(mockNavigate).toHaveBeenNthCalledWith(2, expect.stringContaining("plastic"));
    expect(mockNavigate).toHaveBeenNthCalledWith(3, expect.stringContaining("cross-industry"));
    expect(mockNavigate).toHaveBeenCalledTimes(3);
  });
});

describe("CommunityIndustryTabs — 容器不再攔截／延遲任何 click（原始碼層級鎖定）", () => {
  it("沒有 onClickCapture、setPointerCapture 或任何拖曳狀態旗標", () => {
    const raw = fs.readFileSync(path.resolve(import.meta.dirname, "./CommunityIndustryTabs.tsx"), "utf-8");
    // 去掉註解區塊再比對——檔案開頭的說明性註解本來就會提到這些被移除的
    // identifier 名稱來解釋根因與修法，只鎖定「實際程式碼」不再使用它們。
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/onClickCapture/);
    expect(code).not.toMatch(/setPointerCapture/);
    expect(code).not.toMatch(/justDraggedRef/);
    expect(code).not.toMatch(/onPointerDown|onPointerMove|onPointerUp|onPointerCancel/);
  });
});
