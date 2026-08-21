import { describe, expect, it } from "vitest";
import { shouldShowReservationSlot, shouldShowAiLauncher } from "./FloatingActionStack";

/**
 * Phase 7.4（見對話中「十七、Testing」）：FloatingActionStack 本身是否
 * render、DOM 順序是否正確，已經用真實瀏覽器驗證過（見報告 D／P 節：
 * document.querySelectorAll('button').map(b => b.getAttribute('aria-label'))
 * 實測結果剛好是 ["線上預約","平台公告","開啟 OXM AI 對話"]）——flex-col
 * 天生的「缺席就自動收攏」行為（F2）是 CSS 本身的性質，不是這裡自己寫的
 * 邏輯，不需要另外模擬 DOM 測試。這裡只驗證元件實際依賴的兩個原子決策
 * 函式（F1／F2 的判斷依據）。
 *
 * OXM 第 5 項（見對話中「AI Launcher 僅首頁顯示」）：AI launcher 按鈕改成
 * 獨立的 shouldShowAiLauncher（只有 "/"），不再從 isAiShellExcludedPath
 * 反推——那份規則只負責「面板能不能在該 route 被打開」（AiShellGate／FAQ
 * 的 askQuestion() 還在用），跟這裡的「按鈕在哪裡顯示」是兩件事，所以這個
 * 測試檔不再 import isAiShellExcludedPath。
 */
describe("shouldShowReservationSlot (Phase 7.4 F1/F2：線上預約／平台公告只在首頁顯示)", () => {
  it("首頁顯示", () => {
    expect(shouldShowReservationSlot("/")).toBe(true);
  });

  it("非首頁不顯示（不是這次新規則，沿用 FloatingAnnouncementButton 原本只掛在 Home.tsx 的範圍）", () => {
    expect(shouldShowReservationSlot("/search")).toBe(false);
    expect(shouldShowReservationSlot("/factory/123")).toBe(false);
    expect(shouldShowReservationSlot("/member")).toBe(false);
  });
});

describe("shouldShowAiLauncher（OXM 第 5 項：AI launcher 按鈕只在首頁顯示）", () => {
  it("/ → true", () => {
    expect(shouldShowAiLauncher("/")).toBe(true);
  });

  it("/search → false", () => {
    expect(shouldShowAiLauncher("/search")).toBe(false);
  });

  it("/news → false", () => {
    expect(shouldShowAiLauncher("/news")).toBe(false);
  });

  it("/factory/123 → false", () => {
    expect(shouldShowAiLauncher("/factory/123")).toBe(false);
  });

  it("/faq → false（按鈕不顯示，但面板本身是否能打開由 isAiShellExcludedPath／AiShellGate 另外決定，見 FloatingActionStack.tsx 頂部說明與 FAQ regression 手動驗證）", () => {
    expect(shouldShowAiLauncher("/faq")).toBe(false);
  });

  it("/dashboard → false", () => {
    expect(shouldShowAiLauncher("/dashboard")).toBe(false);
  });

  it("/admin → false", () => {
    expect(shouldShowAiLauncher("/admin")).toBe(false);
  });

  it("/consultant-center → false", () => {
    expect(shouldShowAiLauncher("/consultant-center")).toBe(false);
  });
});

describe("FloatingActionStack 兩個 slot 的組合（F1/F2：某一個 conditional hidden 時剩餘的正常顯示）", () => {
  it("首頁：兩個 slot 都應該顯示", () => {
    const pathname = "/";
    expect(shouldShowReservationSlot(pathname)).toBe(true);
    expect(shouldShowAiLauncher(pathname)).toBe(true);
  });

  it("一般頁面（如 /search）：兩個 slot 都不顯示（AI launcher 改成首頁限定後，非首頁兩者皆不顯示）", () => {
    const pathname = "/search";
    expect(shouldShowReservationSlot(pathname)).toBe(false);
    expect(shouldShowAiLauncher(pathname)).toBe(false);
  });

  it("/admin：兩個 slot 都不顯示", () => {
    const pathname = "/admin";
    expect(shouldShowReservationSlot(pathname)).toBe(false);
    expect(shouldShowAiLauncher(pathname)).toBe(false);
  });
});
