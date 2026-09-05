import { useRef, useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Factory, Network } from "lucide-react";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { cn } from "@/lib/utils";

interface Props {
  activeSpaceCode: string;
}

const TABS: Array<{ name: string; slug: string }> = [
  { name: COMMUNITY_CROSS_INDUSTRY_NAME, slug: COMMUNITY_CROSS_INDUSTRY_SLUG },
  ...Array.from(INDUSTRY_OPTIONS)
    .map(name => ({ name, slug: INDUSTRY_SLUGS[name] ?? "" }))
    .filter(t => t.slug !== ""),
];

// 桌機滑鼠按住拖曳橫向捲動 — 第三輪重新加入（見對話「重新加入桌機拖曳」）。
//
// 上一版（已移除）的 bug：justDraggedRef 這個旗標只在「下一次 click 事件
// 真的進到容器自己的 onClickCapture」時才會被重置，但 setPointerCapture
// 只影響後續的 pointermove／pointerup 要導去哪裡，完全不影響瀏覽器原生
// click 事件的目標判定——click 永遠是照放開滑鼠當下「底下真正是什麼元素」
// 決定要不要觸發、觸發在哪裡。只要放開滑鼠的位置剛好在容器範圍之外，
// 對應的 click 根本不會進到容器的 capture handler，旗標就會永遠卡在
// true，導致之後所有點擊的第一次都被誤判成拖曳而整個吃掉。
//
// 這一版刻意避開同一種「掛在容器上、靠旗標被動等下一次 click 消費」的
// 攔截式設計，改成兩個關鍵差異：
//   1. 判斷拖曳／清除拖曳狀態的 pointermove／pointerup／pointercancel
//      監聽器全部掛在 document／window 上（不用 setPointerCapture），
//      不論放開滑鼠的實際位置在哪裡都一定收得到，不存在「容器範圍外收不
//      到」這件事。
//   2. 只有真的判定為拖曳時，才會在 pointerup 當下「臨時」掛一個
//      document 層級、capture 階段、一次性（fire 一次就立刻自己移除，
//      並且有逾時保底自動移除）的 click 抑制器，只吃掉這次拖曳自己緊接
//      在後的那一次 click；沒有殘留旗標可以卡住，下一次真正無關的點擊
//      在它自己的 click 事件上完全不受影響，一定正常觸發。
//
// 判斷「這是不是真的橫向拖曳」也不是單一 deltaX 門檻：除了水平位移要超過
// DRAG_DISTANCE_PX，還要求水平位移明顯主導於垂直位移（DRAG_DIRECTION_RATIO
// 倍），避免點擊時常見的小幅對角手震被誤判成拖曳。
const DRAG_DISTANCE_PX = 10;
const DRAG_DIRECTION_RATIO = 1.5;
// 拖曳放開滑鼠後，理論上瀏覽器會在同一輪事件序列裡幾乎同步觸發對應的
// click；這個逾時只是保底，避免任何極端情況下真的沒有 click 跟上來時，
// 一次性抑制器還留在 document 上等不到目標。
const SUPPRESS_CLICK_TIMEOUT_MS = 400;

export default function CommunityIndustryTabs({ activeSpaceCode }: Props) {
  const [, navigate] = useLocation();
  const activeRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSpaceCode]);

  const suppressNextClick = useCallback(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    };
    const timeoutId = window.setTimeout(cleanup, SUPPRESS_CLICK_TIMEOUT_MS);
    function cleanup() {
      document.removeEventListener("click", handler, true);
      window.clearTimeout(timeoutId);
    }
    document.addEventListener("click", handler, true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 只有滑鼠左鍵、只有滑鼠（觸控維持瀏覽器原生 touch-scroll，完全不
    // 介入；滾輪／trackpad 水平捲動本來就是靠 overflow-x-auto 原生處理）。
    const dragRef: {
      current: null | { pointerId: number; startX: number; startY: number; startScrollLeft: number; dragging: boolean };
    } = { current: null };

    function handlePointerMove(e: PointerEvent) {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;
      if (!state.dragging) {
        const isHorizontalDrag =
          Math.abs(deltaX) > DRAG_DISTANCE_PX &&
          Math.abs(deltaX) > Math.abs(deltaY) * DRAG_DIRECTION_RATIO;
        if (!isHorizontalDrag) return;
        state.dragging = true;
        setIsDragging(true);
      }
      container!.scrollLeft = state.startScrollLeft - deltaX;
    }

    function endDrag(wasDragging: boolean) {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancelDoc);
      window.removeEventListener("blur", handleBlur);
      dragRef.current = null;
      setIsDragging(false);
      // 只抑制這次拖曳自己產生的那一次 click；pointercancel／視窗失焦
      // 這兩種情況本來就不會有對應的 click 跟上來，不需要（也不應該）
      // 掛抑制器，避免留下一個永遠等不到目標的 listener。
      if (wasDragging) suppressNextClick();
    }

    function handlePointerUp(e: PointerEvent) {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      endDrag(state.dragging);
    }

    function handlePointerCancelDoc(e: PointerEvent) {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      endDrag(false);
    }

    function handleBlur() {
      if (dragRef.current) endDrag(false);
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: container!.scrollLeft,
        dragging: false,
      };
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", handlePointerCancelDoc);
      window.addEventListener("blur", handleBlur);
    }

    container.addEventListener("pointerdown", handlePointerDown);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancelDoc);
      window.removeEventListener("blur", handleBlur);
    };
  }, [suppressNextClick]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex gap-1 overflow-x-auto overflow-y-hidden rounded-xl border border-purple-100/80 bg-white/90 p-1.5 shadow-sm dark:border-purple-900/40 dark:bg-card [&::-webkit-scrollbar]:hidden",
        "cursor-grab",
        isDragging && "cursor-grabbing select-none",
      )}
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="選擇產業看板"
    >
      {TABS.map(tab => {
        const isActive = tab.slug === activeSpaceCode;
        const Icon = tab.slug === COMMUNITY_CROSS_INDUSTRY_SLUG ? Network : Factory;
        return (
          <button
            key={tab.slug}
            ref={isActive ? activeRef : undefined}
            role="tab"
            aria-selected={isActive}
            onClick={() => navigate(`/community/${tab.slug}/discussions`)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
              isActive
                ? "bg-purple-600 text-white shadow-sm"
                : "text-muted-foreground hover:-translate-y-px hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950/30 dark:hover:text-purple-300"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-orange-200")} aria-hidden="true" />
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
