import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import FloatingAnnouncementButton from "@/components/FloatingAnnouncementButton";
import { AiLauncherButton } from "@/components/ai/AiLauncherButton";

const isNativePlatform = Capacitor.isNativePlatform();

// 見 FloatingAnnouncementButton.tsx 原本就有的避讓邏輯（Phase 7.4 把它提升
// 到這個共用 stack container，不是重新發明）：native app 有 AppBottomNav
// （56px 高 + safe-area-inset-bottom，見 AppBottomNav.tsx），加上去避免浮動
// 按鈕貼著／疊在下方導覽列上；safe-area-inset-bottom 本身則是任何情境
// （native／web、有沒有 bottom nav）都需要，避免最下面的 AI 按鈕貼住
// iPhone Home Indicator。桌機／平板（AppBottomNav 只在 isNative 才顯示、
// safe-area 在無瀏海裝置上是 0px）套用同一條公式會自然退化成單純的
// 1.5rem，不需要另外用 breakpoint 分支。
const bottomOffset = isNativePlatform
  ? "calc(56px + 1.5rem + env(safe-area-inset-bottom, 0px))"
  : "calc(1.5rem + env(safe-area-inset-bottom, 0px))";

/**
 * Phase 7.4（見對話中「Floating UI Stack Consolidation」）：右下角浮動功能
 * 堆疊的唯一 positioning source of truth。三個入口（線上預約／平台通知／
 * OXM AI）過去各自用不同的 fixed／bottom／right／z-index（AI 是
 * GlobalAiShell.tsx 自己的 bottom-5/sm:bottom-7；線上預約＋平台通知是
 * FloatingAnnouncementButton.tsx 自己的 portal + fixed div），在兩者同時
 * 顯示的頁面（目前只有首頁）會彼此重疊。這個元件只負責 position／spacing／
 * order／responsive／z-index 這幾件事本身，三個入口各自的 state／互動／
 * 資料完全不變，仍是各自獨立的元件（見對話中「三、最小架構」）。
 *
 * DOM 順序＝視覺順序，由上到下：線上預約／平台通知 → OXM AI。AI 是
 * flex-col 裡最後一個子元素，天生離 bottom 錨點最近，不需要另外計算它的
 * offset，也不能用 CSS order 反轉 DOM（見「五、排序」）。
 *
 * 線上預約／平台通知目前只有首頁會顯示——這不是這次新增的規則，是
 * FloatingAnnouncementButton 過去只被 Home.tsx 引用這個既有事實（見對話中
 * 「不要強迫三個一起全顯示／全隱藏」）；AI launcher 按鈕（見「OXM 第 5 項」）
 * 現在也改成只有首頁顯示（shouldShowAiLauncher），兩者剛好一致，但這是
 * 兩條各自獨立維護的規則，不是共用同一個判斷式。**只有「按鈕是否顯示」是
 * 首頁限定**——AI 面板本身能不能在該 route 被 programmatically 開啟，仍由
 * client/src/lib/aiShellRoutes.ts 的 isAiShellExcludedPath（在 App.tsx 的
 * AiShellGate 使用）決定，這裡完全不碰，FAQ 頁的 askQuestion() 因此不受
 * 影響（見 client/src/pages/FAQ.tsx）。某一個 slot 不該出現時就不 render
 * 那個 child，flex-col 本身的天然行為就會讓剩下的自動靠攏，不需要額外程式碼。
 *
 * z-index＝40：低於 GlobalAiShell 開啟後的面板（z-50）與 AiHandoffModal
 * 這類 Radix Dialog（見對話中「八、Z-index」）——launcher 本身不需要蓋過任何
 * 已開啟的 overlay／panel。
 */
/**
 * 線上預約／平台公告目前只有首頁會顯示——沿用 FloatingAnnouncementButton
 * 過去只被 Home.tsx 引用的既有範圍，不是這次新增或擴大的規則。抽成具名
 * export 方便寫 deterministic test（見 FloatingActionStack.test.ts）。
 */
export function shouldShowReservationSlot(pathname: string): boolean {
  return pathname === "/";
}

/**
 * OXM 第 5 項（見對話中「AI Launcher 僅首頁顯示」）：AI 浮動按鈕本身改成
 * 只有首頁顯示，跟 isAiShellExcludedPath 的黑名單邏輯完全脫鉤——那份規則
 * 繼續只負責「面板能不能在該 route 被打開」（AiShellGate／FAQ 的
 * askQuestion() 都還在用它），不是「按鈕在哪裡顯示」。這裡刻意用獨立的白
 * 名單規則（只有 "/"），不從 isAiShellExcludedPath 反推，避免兩份語意不同
 * 的規則被誤以為是同一件事。
 */
export function shouldShowAiLauncher(pathname: string): boolean {
  return pathname === "/";
}

export function FloatingActionStack() {
  const [pathname] = useLocation();
  const showAnnouncementSlot = shouldShowReservationSlot(pathname);
  const showAiLauncher = shouldShowAiLauncher(pathname);

  if (!showAnnouncementSlot && !showAiLauncher) return null;

  return createPortal(
    <div
      className="fixed right-5 z-40 flex flex-col items-end gap-2"
      style={{ bottom: bottomOffset }}
    >
      {showAnnouncementSlot && <FloatingAnnouncementButton />}
      {showAiLauncher && <AiLauncherButton />}
    </div>,
    document.body
  );
}
