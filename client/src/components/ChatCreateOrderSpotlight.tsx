import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";

// 聊天室「建立訂單」入口 Spotlight 強提醒——單步驟版本，視覺風格參考
// OnboardingTour.tsx（首頁新手導覽）：整頁加深色半透明遮罩、只留目標元素本身
// 亮著、旁邊放一張說明卡片。刻意不直接重用 OnboardingTour.tsx 本體——那支
// 元件是「多步驟、全站只顯示一次、與帳號 needsOnboarding 綁定、需要用
// CustomEvent 強制打開 Navbar 選單」的首頁專用導覽，耦合很深且經過多輪
// edge case 修復（見該檔案內註解：viewport resize、iOS Safari
// visualViewport、無窮迴圈防範…等），改動它去支援這裡的單步驟、
// per-conversation 用法風險大於直接寫一支更單純的版本。
//
// 這裡改用「呼叫端直接傳入 targetRef」而不是 data-attribute + DOM query +
// 重試輪詢：Spotlight 跟目標按鈕本來就在同一個 ChatPage 元件樹裡、同一次
// render 就會掛載完成，不像 OnboardingTour 的目標在另一個 lazy load 元件
// （Navbar）裡、需要輪詢等待掛載完成。若目標暫時量不到 rect（例如尚未
// mount），一律不渲染任何遮罩——不會出現「遮罩已打開但看不到 highlight」
// 的狀態。
//
// 刻意「不」在 highlight 區域上方疊一層攔截點擊的透明層（OnboardingTour 的
// SpotlightMask 有這一層，因為它要強制使用者照著步驟走）：這裡的規格明確要
// 求「允許點擊被凸顯的建立訂單入口後直接關閉導覽並進入功能」，所以 highlight
// 區域刻意保持完全可以正常點擊，真正呼叫 onDismiss() 的時機交給呼叫端在目標
// 按鈕自己的 onClick 裡處理。

const OVERLAY_COLOR = "rgba(0, 0, 0, 0.55)";
const TARGET_PADDING = 8;
const CARD_WIDTH = 320;
const MARGIN = 16;
const MOBILE_BREAKPOINT = 768;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(el: HTMLElement): TargetRect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export interface ChatCreateOrderSpotlightProps {
  targetRef: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  ctaLabel: string;
  onDismiss: () => void;
}

export function ChatCreateOrderSpotlight({ targetRef, title, description, ctaLabel, onDismiss }: ChatCreateOrderSpotlightProps) {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // 找不到 target 時完全不渲染（見檔案開頭說明），不會有「遮罩開了但沒有
  // highlight」的中間狀態；有限次數重試只是為了涵蓋極少數 ref 還沒 attach
  // 的第一個 render tick，不是常態。
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;
    const tryMeasure = () => {
      if (cancelled) return;
      const el = targetRef.current;
      if (el && el.offsetParent !== null) {
        setRect(measure(el));
        return;
      }
      attempts += 1;
      if (attempts >= 20) return; // 安全 fallback：放棄，維持不渲染
      timeoutId = window.setTimeout(tryMeasure, 100);
    };
    tryMeasure();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [targetRef]);

  // resize／scroll／keyboard 開關（visualViewport resize）都要重新量測。
  useEffect(() => {
    let frame: number | null = null;
    const remeasure = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const el = targetRef.current;
        if (el) setRect(measure(el));
      });
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    window.visualViewport?.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
      window.visualViewport?.removeEventListener("resize", remeasure);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [targetRef]);

  // 導覽開啟期間鎖住背景捲動位置，做法與 OnboardingTour.tsx 完全相同（body
  // position:fixed + 負值 top，離開時還原並跳回原本 scrollY）。
  useEffect(() => {
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    ctaRef.current?.focus();
  }, [rect != null]);

  if (!rect) return null;

  const top = Math.max(rect.top - TARGET_PADDING, 0);
  const left = Math.max(rect.left - TARGET_PADDING, 0);
  const width = rect.width + TARGET_PADDING * 2;
  const height = rect.height + TARGET_PADDING * 2;

  const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 400;
  const viewportH = typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 800;

  let cardStyle: React.CSSProperties;
  let cardClassName: string;
  if (isMobile) {
    const spaceBelow = viewportH - (top + height);
    const spaceAbove = top;
    const placeAbove = spaceBelow < spaceAbove;
    cardClassName = "fixed inset-x-4";
    cardStyle = placeAbove
      ? { bottom: `calc(${Math.max(viewportH - top + MARGIN, 20)}px + env(safe-area-inset-bottom, 0px))` }
      : { top: `${top + height + MARGIN}px` };
  } else {
    const spaceBelow = viewportH - (top + height);
    const placeAbove = spaceBelow < 200;
    let cardLeft = left + width / 2 - CARD_WIDTH / 2;
    cardLeft = Math.max(MARGIN, Math.min(cardLeft, viewportW - CARD_WIDTH - MARGIN));
    cardClassName = "fixed";
    cardStyle = placeAbove
      ? { left: cardLeft, bottom: Math.max(viewportH - top + MARGIN, MARGIN), width: CARD_WIDTH }
      : { left: cardLeft, top: top + height + MARGIN, width: CARD_WIDTH };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="建立訂單功能提示">
      {/* 四塊實心背板圍住 target（不是 box-shadow 挖洞）：背景真的無法被點擊，
          target 區域本身完全不覆蓋任何東西，維持原本可點擊。 */}
      <div className="fixed left-0 right-0 top-0" style={{ height: top, background: OVERLAY_COLOR }} />
      <div className="fixed left-0 right-0 bottom-0" style={{ top: top + height, background: OVERLAY_COLOR }} />
      <div className="fixed" style={{ top, left: 0, width: left, height, background: OVERLAY_COLOR }} />
      <div className="fixed" style={{ top, left: left + width, right: 0, height, background: OVERLAY_COLOR }} />
      <div
        className="fixed rounded-lg pointer-events-none ring-2 ring-orange-400"
        style={{ top, left, width, height, boxShadow: "0 0 0 4px rgba(249,115,22,0.15)" }}
      />

      <div className={cardClassName} style={cardStyle}>
        <div className="bg-background border rounded-lg shadow-lg p-4 space-y-3 w-full">
          <p className="text-sm font-semibold text-foreground whitespace-pre-line">{title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{description}</p>
          <div className="flex justify-end">
            <Button ref={ctaRef} size="sm" onClick={onDismiss}>{ctaLabel}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
