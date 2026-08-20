import { describe, expect, it } from "vitest";
import { shouldShowReservationSlot } from "./FloatingActionStack";
import { isAiShellExcludedPath } from "@/lib/aiShellRoutes";

/**
 * Phase 7.4（見對話中「十七、Testing」）：FloatingActionStack 本身是否
 * render、DOM 順序是否正確，已經用真實瀏覽器驗證過（見報告 D／P 節：
 * document.querySelectorAll('button').map(b => b.getAttribute('aria-label'))
 * 實測結果剛好是 ["線上預約","平台公告","開啟 OXM AI 對話"]）——flex-col
 * 天生的「缺席就自動收攏」行為（F2）是 CSS 本身的性質，不是這裡自己寫的
 * 邏輯，不需要另外模擬 DOM 測試。這裡只驗證元件實際依賴的兩個原子決策
 * 函式（F1／F2 的判斷依據）。
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

describe("FloatingActionStack 兩個 slot 的組合（F1/F2：某一個 conditional hidden 時剩餘的正常顯示）", () => {
  it("首頁：兩個 slot 都應該顯示", () => {
    const pathname = "/";
    expect(shouldShowReservationSlot(pathname)).toBe(true);
    expect(isAiShellExcludedPath(pathname)).toBe(false); // AI 顯示
  });

  it("一般頁面（如 /search）：只有 AI slot 顯示，線上預約／平台公告不顯示", () => {
    const pathname = "/search";
    expect(shouldShowReservationSlot(pathname)).toBe(false);
    expect(isAiShellExcludedPath(pathname)).toBe(false); // AI 仍顯示
  });

  it("AI 排除路由（如 /admin）：只有可能的線上預約／平台公告（本身也不在首頁，所以也不顯示）—— 兩個都不顯示", () => {
    const pathname = "/admin";
    expect(shouldShowReservationSlot(pathname)).toBe(false);
    expect(isAiShellExcludedPath(pathname)).toBe(true); // AI 不顯示
  });
});
